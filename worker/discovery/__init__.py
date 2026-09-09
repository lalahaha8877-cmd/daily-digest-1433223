"""发现层工厂。对应后端需求文档 §4.6。

约束：任一 source 抛异常只记日志并跳过该 source，不影响同关键词的其他 source。
"""

from __future__ import annotations

import logging
from datetime import date

from ..models import Candidate

log = logging.getLogger(__name__)


def _discover_one(source: dict, today: date, limit: int) -> list[Candidate]:
    stype = source.get("type")

    if stype == "rss":
        from . import rss
        return rss.discover(source)
    if stype == "gnews":
        # gnews 必须拿到 limit：解跳转每条一次网络请求 + 1 秒间隔，
        # 不限量会让单个源耗时上百秒（见 gnews.discover 的说明）。
        from . import gnews
        return gnews.discover(source, limit=limit)
    if stype == "listing":
        from . import listing
        return listing.discover(source)
    if stype == "websearch":
        from . import websearch
        if not websearch.should_run_today(source, today):
            log.info("websearch 源今日不执行（schedule=%s）", source.get("schedule"))
            return []
        return websearch.discover(source)

    log.warning("未知的 source type: %r，已跳过", stype)
    return []


def discover_all(sources: list[dict], today: date, max_candidates: int) -> list[Candidate]:
    """跑完所有 source，合并、按发布时间倒序、截断。"""
    all_candidates: list[Candidate] = []

    for source in sources:
        try:
            found = _discover_one(source, today, limit=max_candidates)
            all_candidates.extend(found)
        except Exception as e:
            # 单个 source 失败不影响其他 source —— §4.6 硬性要求
            log.warning("source %r 失败已跳过: %s", source.get("type"), e, exc_info=True)

    # published_at 为 None 的排最后（无从判断新旧，优先级最低）
    all_candidates.sort(
        key=lambda c: (c.published_at is not None, c.published_at),
        reverse=True,
    )
    return all_candidates[:max_candidates]
