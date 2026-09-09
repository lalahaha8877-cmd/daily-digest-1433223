"""列表页抓取发现源（可选）。对应后端需求文档 §4.6。

用 Scrapling 抓没有 RSS 的重要站点的文章列表页。Scrapling 的自适应元素追踪
正好用在这里 —— 站点改版后不会立刻全线失效。

未实现：需要 Scrapling 抓取层（fetcher.py）先就位。
"""

from __future__ import annotations

import logging

from ..models import Candidate

log = logging.getLogger(__name__)


def discover(source: dict) -> list[Candidate]:
    raise NotImplementedError(
        "listing 发现源尚未实现（依赖 fetcher.py 的 Scrapling 抓取层）"
    )
