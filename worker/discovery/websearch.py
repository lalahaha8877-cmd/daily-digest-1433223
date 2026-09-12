"""Claude 内置 web_search 发现源（兜底，按次计费）。对应后端需求文档 §4.6。

这是唯一按次计费的发现源（约 $0.01/次搜索），所以只在 schedule 匹配当天时执行：
daily / weekly(周一) / monthly(1号)。默认 weekly。

用途限定在两种场景：新关键词冷启动建立基线、每周一次的补充扫描。
**不要每天每个关键词都用** —— 那是主要成本来源。
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from .. import config
from ..models import Candidate

log = logging.getLogger(__name__)

MAX_SEARCH_USES = 3
SEARCH_SYSTEM = (
    "你是一个资讯检索助手。联网搜索用户给出的关键词的最新消息，"
    "然后严格只输出 JSON，不要有任何 JSON 之外的文字：\n"
    '{"results": [{"url": "完整URL", "title": "标题", "published": "YYYY-MM-DD 或 null"}]}\n'
    "只列出真实搜索到的结果，不要编造 URL。最多 10 条，优先最近发布的。"
)


def should_run_today(source: dict, today: date) -> bool:
    schedule = source.get("schedule", "weekly")
    if schedule == "daily":
        return True
    if schedule == "weekly":
        return today.weekday() == 0      # 周一
    if schedule == "monthly":
        return today.day == 1
    log.warning("未知的 websearch schedule: %r，按 weekly 处理", schedule)
    return today.weekday() == 0


def _parse_date(raw) -> datetime | None:
    if not raw or not isinstance(raw, str):
        return None
    try:
        return datetime.fromisoformat(raw).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def discover(source: dict) -> list[Candidate]:
    """source: {"type":"websearch","schedule":"weekly","query":...,"allow_fulltext":bool}"""
    import anthropic

    from ..distill import extract_json

    query = (source.get("query") or "").strip()
    if not query:
        log.warning("websearch 源缺少 query，已跳过")
        return []

    client = anthropic.Anthropic(api_key=config.secrets.anthropic_api_key)

    # 服务端工具：搜索在 Anthropic 侧执行，结果直接回到同一次响应里，
    # 不需要我们自己跑 agentic loop
    resp = client.messages.create(
        model=config.MODEL_DISTILL,
        max_tokens=2000,
        system=SEARCH_SYSTEM,
        tools=[{"type": "web_search_20260209", "name": "web_search", "max_uses": MAX_SEARCH_USES}],
        messages=[{"role": "user", "content": f"搜索这个主题的最新消息：{query}"}],
    )

    text = "".join(b.text for b in resp.content if b.type == "text")
    searches = getattr(getattr(resp.usage, "server_tool_use", None), "web_search_requests", 0)

    try:
        data = extract_json(text)
    except Exception as e:
        log.warning("websearch 输出解析失败：%s", e)
        return []

    allow_fulltext = bool(source.get("allow_fulltext", True))
    candidates: list[Candidate] = []

    for row in data.get("results") or []:
        url = (row.get("url") or "").strip()
        title = (row.get("title") or "").strip()
        if not url.startswith(("http://", "https://")) or not title:
            continue
        candidates.append(
            Candidate(
                url=url,
                title=title[:500],
                published_at=_parse_date(row.get("published")),
                summary=None,
                discovery_type="websearch",
                allow_fulltext=allow_fulltext,
            )
        )

    log.info("websearch q=%r → %d 候选（本次 %d 次搜索，计费项）", query, len(candidates), searches)
    return candidates
