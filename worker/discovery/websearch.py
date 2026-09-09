"""Claude 内置 web_search 发现源（兜底，按次计费）。对应后端需求文档 §4.6。

这是唯一按次计费的发现源（约 $0.01/次搜索），只在 schedule 匹配当天时执行：
daily / weekly(周一) / monthly(1号)。默认建议 weekly。

未实现：需要 Anthropic SDK 接入。
"""

from __future__ import annotations

import logging
from datetime import date

from ..models import Candidate

log = logging.getLogger(__name__)


def should_run_today(source: dict, today: date) -> bool:
    """schedule 匹配判断 —— 这一段与是否实现 discover 无关，先做好。"""
    schedule = source.get("schedule", "weekly")
    if schedule == "daily":
        return True
    if schedule == "weekly":
        return today.weekday() == 0      # 周一
    if schedule == "monthly":
        return today.day == 1
    log.warning("未知的 websearch schedule: %r，按 weekly 处理", schedule)
    return today.weekday() == 0


def discover(source: dict) -> list[Candidate]:
    raise NotImplementedError(
        "websearch 发现源尚未实现（依赖 Anthropic SDK 与 web_search 工具接入）"
    )
