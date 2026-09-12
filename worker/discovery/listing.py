"""列表页抓取发现源。对应后端需求文档 §4.6。

给没有 RSS 的重要站点用：抓它的文章列表页，解析出链接。

`selector_hint` 是可选的 CSS 选择器（如 "article h2 a"）。给了就按它选，
没给就用一组启发式规则兜底。Scrapling 的自适应元素追踪正好用在这里 ——
站点改版后不会立刻全线失效。
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit

from ..models import Candidate

log = logging.getLogger(__name__)

FETCH_TIMEOUT = 20

# 没有 selector_hint 时的兜底：文章链接常见的容器
FALLBACK_SELECTORS = (
    "article h2 a",
    "article h3 a",
    "h2 a",
    "h3 a",
    ".post-title a",
    ".entry-title a",
)

# 明显不是文章的链接
_SKIP_PATTERNS = re.compile(
    r"/(tag|tags|category|categories|author|page|search|login|signup|about|contact)(/|$)",
    re.I,
)


def _looks_like_article(url: str, base_host: str) -> bool:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        return False
    if (parts.hostname or "").lower().removeprefix("www.") != base_host:
        return False                      # 只要同站链接，滤掉外链和社交分享
    if _SKIP_PATTERNS.search(parts.path):
        return False
    return len(parts.path.strip("/")) > 0  # 排除首页本身


def discover(source: dict) -> list[Candidate]:
    """source: {"type":"listing","url":...,"selector_hint":"...","allow_fulltext":bool}"""
    url = source.get("url")
    if not url:
        log.warning("listing 源缺少 url，已跳过")
        return []

    from scrapling.fetchers import Fetcher

    page = Fetcher.get(url, timeout=FETCH_TIMEOUT * 1000, stealthy_headers=True)

    selectors = [source["selector_hint"]] if source.get("selector_hint") else list(FALLBACK_SELECTORS)
    base_host = (urlsplit(url).hostname or "").lower().removeprefix("www.")
    allow_fulltext = bool(source.get("allow_fulltext", False))

    seen: set[str] = set()
    candidates: list[Candidate] = []

    for selector in selectors:
        try:
            elements = page.css(selector)
        except Exception as e:
            log.debug("选择器 %r 无效: %s", selector, e)
            continue

        for el in elements:
            href = (el.attrib.get("href") or "").strip()
            title = (el.text or "").strip()
            if not href or not title:
                continue

            absolute = urljoin(url, href)
            if absolute in seen or not _looks_like_article(absolute, base_host):
                continue
            seen.add(absolute)

            candidates.append(
                Candidate(
                    url=absolute,
                    title=title[:500],
                    # 列表页一般拿不到可靠的发布时间，留空由抓取后再补
                    published_at=None,
                    summary=None,
                    discovery_type="listing",
                    allow_fulltext=allow_fulltext,
                )
            )

        if candidates:
            log.info("listing %s 用选择器 %r 命中 %d 条", url, selector, len(candidates))
            break                          # 第一个有结果的选择器就够了

    if not candidates:
        log.warning("listing %s 未命中任何链接（试过 %d 个选择器）", url, len(selectors))

    return candidates
