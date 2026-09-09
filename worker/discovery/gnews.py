"""Google News RSS 发现源。

本模块的三段核心逻辑沿用自 V1（每日要点）的实战验证结果，不是新写的：

1. `resolve_real_url` —— Google News RSS 的 link 是 `news.google.com/rss/articles/CBMi...`
   跳转 token，靠客户端 JS 跳转，普通 HTTP 客户端跟随重定向只会停在 Google 的中转页
   （实测 title 是 "Google News"，正文提取为空）。必须用 googlenewsdecoder 解码出
   真实发布方 URL。对应后端文档 §4.6「必须先跟随重定向解析真实 URL 再进入去重」。

2. `derive_query` —— 中文检索词里的「最新动态 / 相关新闻 / 最新进展」这类填充后缀会
   严重稀释相关性。V1 实测：带后缀 1 条结果，剥掉后 103 条。

3. 按 pubDate 过滤 —— V1 最初用 Google 的 `when:1d` 搜索算符，实测该算符会被静默限流：
   服务端开始把整个 "AI when:1d" 当字面短语搜索，返回 0 条却仍是 HTTP 200，导致误判为
   「今日无更新」。改为不带算符抓取、在本地按 RSS 的 pubDate 过滤，不依赖未公开行为。
   对应后端文档 §4.6「gnews 来源的候选额外过滤 published_at 早于 14 天的」。
"""

from __future__ import annotations

import logging
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote

from googlenewsdecoder import gnewsdecoder

from ..models import Candidate

log = logging.getLogger(__name__)

# Google News RSS 时效性差（2026-07 实测中位文章年龄约 6.6 天），
# 用它做「今天有什么新消息」会拿到一堆旧闻，所以额外设一个上限。
GNEWS_MAX_AGE_DAYS = 14

# 解跳转的实测成本：**每条约 4.5 秒**（2026-09-09 实测，非文档假设的 1 秒——
# gnewsdecoder 的 interval 参数只是额外 sleep，解码本身要多次往返 Google）。
# 一个 feed 约 100 条，全解要 7 分多钟，会吃掉 GitHub Actions 40 分钟上限的一大块。
# V2 主文档 §7.1 已明确 gnews 是「广度补充，不要当主力」，所以这里单独压一个低上限，
# 主力候选交给 RSS 源。要调高的话，记得按 4.5 秒/条重新核算整个 run 的耗时。
GNEWS_DECODE_LIMIT = 10
RSS_TIMEOUT = 20
USER_AGENT = "Mozilla/5.0 (compatible; DailyDigestBot/2.0)"

# 中文检索词里常见的填充后缀，作为搜索关键词毫无区分度，反而稀释相关性。
FILLER_SUFFIXES = (
    "最新动态", "最新进展", "最新消息", "最新新闻", "相关新闻",
    "相关动态", "相关消息", "近期动态", "近期进展", "行业动态", "动态", "新闻",
)


def derive_query(query: str) -> str:
    """剥掉中文检索词尾部的填充词，返回真正有区分度的部分。"""
    q = query.strip()
    for suffix in FILLER_SUFFIXES:
        if q.endswith(suffix) and len(q) > len(suffix):
            return q[: -len(suffix)].strip()
    return q


def resolve_real_url(google_link: str) -> str | None:
    """把 Google News 跳转链接解成真实发布方 URL；解不出返回 None（调用方丢弃该候选）。"""
    try:
        result = gnewsdecoder(google_link, interval=1)
        if result and result.get("status") and result.get("decoded_url"):
            return result["decoded_url"]
        log.warning("gnews decode 返回无效结果: %s", str(result)[:200])
    except Exception as e:
        log.warning("gnews decode 失败 %s: %s", google_link[:80], e)
    return None


def _parse_pub_date(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def discover(source: dict, limit: int = 25) -> list[Candidate]:
    """source: {"type":"gnews","query":...,"hl":...,"gl":...,"ceid":...,"allow_fulltext":bool}

    `limit` 是**解码上限**，不只是返回上限：gnewsdecoder 每条要发一次网络请求且
    自带 1 秒间隔，一个 feed 有约 100 条，全解要 100+ 秒。所以必须先按 pubDate
    排序截断、再解码，否则单个源就能把整个 run 拖垮。
    """
    query = derive_query(source.get("query", ""))
    if not query:
        return []

    hl = source.get("hl", "zh-CN")
    gl = source.get("gl", "CN")
    ceid = source.get("ceid", "CN:zh")
    url = (
        f"https://news.google.com/rss/search?q={quote(query)}"
        f"&hl={hl}&gl={gl}&ceid={ceid}"
    )

    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=RSS_TIMEOUT) as resp:
        raw = resp.read()

    root = ET.fromstring(raw)
    cutoff = datetime.now(timezone.utc) - timedelta(days=GNEWS_MAX_AGE_DAYS)
    allow_fulltext = bool(source.get("allow_fulltext", True))

    # 第一遍：只解析元数据、按时效过滤，不碰解码（便宜）
    entries: list[tuple[str, str, datetime | None]] = []
    dropped_stale = 0

    for item in root.findall("./channel/item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        if not (title and link):
            continue

        published_at = _parse_pub_date(item.findtext("pubDate"))
        if published_at is not None and published_at < cutoff:
            dropped_stale += 1
            continue

        entries.append((title, link, published_at))

    # 先按新鲜度排序再截断 —— 解码很贵，只解我们真正要的那些
    entries.sort(key=lambda e: (e[2] is not None, e[2]), reverse=True)
    entries = entries[: min(limit, GNEWS_DECODE_LIMIT)]

    # 第二遍：只对截断后的条目解跳转（每条约 1 秒）
    candidates: list[Candidate] = []
    dropped_undecodable = 0

    for title, link, published_at in entries:
        real_url = resolve_real_url(link)
        if real_url is None:
            dropped_undecodable += 1
            continue
        candidates.append(
            Candidate(
                url=real_url,
                title=title,
                published_at=published_at,
                summary=None,          # Google News 的 description 只是重复链接，没有实质摘要
                discovery_type="gnews",
                allow_fulltext=allow_fulltext,
            )
        )

    log.info(
        "gnews q=%r → %d 候选（过期丢弃 %d，超出 limit 未解码 %d，解跳转失败 %d）",
        query, len(candidates), dropped_stale,
        max(0, len(root.findall("./channel/item")) - dropped_stale - len(entries)),
        dropped_undecodable,
    )
    return candidates
