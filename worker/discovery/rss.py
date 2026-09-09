"""RSS / Atom 发现源（主力）。对应后端需求文档 §4.6。

相比 gnews：链接就是真实 URL（不需要解跳转）、时效性好、无反爬。
V2 主文档 §7.1 把它列为主力，gnews 只作广度补充。
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import feedparser

from ..models import Candidate

log = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (compatible; DailyDigestBot/2.0)"


def _entry_datetime(entry) -> datetime | None:
    """feedparser 把时间解析成 struct_time；统一转成 UTC-aware datetime。

    必须是 aware 的：discover_all 会把多个源的候选放在一起排序，
    naive 和 aware 混排会抛 TypeError。
    """
    for attr in ("published_parsed", "updated_parsed"):
        parsed = getattr(entry, attr, None)
        if parsed:
            try:
                return datetime(*parsed[:6], tzinfo=timezone.utc)
            except (TypeError, ValueError):
                continue
    return None


def _entry_summary(entry) -> str | None:
    for attr in ("summary", "description"):
        val = getattr(entry, attr, None)
        if val and isinstance(val, str) and val.strip():
            return val.strip()[:2000]
    return None


def discover(source: dict) -> list[Candidate]:
    """source: {"type":"rss","url":...,"allow_fulltext":bool}"""
    url = source.get("url")
    if not url:
        log.warning("rss 源缺少 url，已跳过")
        return []

    feed = feedparser.parse(url, agent=USER_AGENT)

    # feedparser 不抛异常，出错时把异常放在 .bozo_exception。
    # 但即使 bozo=1（比如 XML 里有非法字符）也常常仍能解析出条目，
    # 所以只记日志、不直接放弃。
    if getattr(feed, "bozo", 0) and not feed.entries:
        raise RuntimeError(f"RSS 解析失败且无条目: {getattr(feed, 'bozo_exception', 'unknown')}")

    allow_fulltext = bool(source.get("allow_fulltext", True))
    candidates: list[Candidate] = []

    for entry in feed.entries:
        link = (getattr(entry, "link", "") or "").strip()
        title = (getattr(entry, "title", "") or "").strip()
        if not (link and title):
            continue
        candidates.append(
            Candidate(
                url=link,
                title=title,
                published_at=_entry_datetime(entry),
                summary=_entry_summary(entry),
                discovery_type="rss",
                allow_fulltext=allow_fulltext,
            )
        )

    log.info("rss %s → %d 候选", url, len(candidates))
    return candidates
