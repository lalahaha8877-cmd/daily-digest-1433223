"""全文抓取：三级火箭降级。对应后端需求文档 §4.8。

    fetcher  纯 HTTP，带 TLS 指纹伪装        覆盖约 90% 站点，最快
    dynamic  Playwright + Chromium          需要 JS 渲染才有正文的站点
    stealthy Camoufox + solve_cloudflare     遇到反爬挑战时的最后一档

三条硬性约束：
  · 必须用异步 session 复用浏览器实例 —— 每个 URL 开一个浏览器，50 个页面直接超时
  · 同域名串行且间隔 ≥ 2 秒（§12 合规要求）
  · 抓取前查 robots.txt，Disallow 则 skipped，**不升级到 stealthy**
"""

from __future__ import annotations

import asyncio
import logging
import time
import urllib.robotparser
from urllib.parse import urlsplit

from . import config, extract
from .models import Candidate, FetchResult

log = logging.getLogger(__name__)


def domain_of(url: str) -> str:
    return (urlsplit(url).hostname or "").lower()


# ── 同域名限速 ───────────────────────────────────────────
class DomainLimiter:
    """每个域名一把锁 + 上次请求时间戳，保证同域串行且间隔足够。"""

    def __init__(self, interval: float):
        self._interval = interval
        self._locks: dict[str, asyncio.Lock] = {}
        self._last: dict[str, float] = {}

    def _lock(self, domain: str) -> asyncio.Lock:
        if domain not in self._locks:
            self._locks[domain] = asyncio.Lock()
        return self._locks[domain]

    async def __aenter__(self):
        return self

    async def acquire(self, domain: str) -> asyncio.Lock:
        lock = self._lock(domain)
        await lock.acquire()
        elapsed = time.monotonic() - self._last.get(domain, 0.0)
        if elapsed < self._interval:
            await asyncio.sleep(self._interval - elapsed)
        return lock

    def release(self, domain: str, lock: asyncio.Lock) -> None:
        self._last[domain] = time.monotonic()
        lock.release()


# ── robots.txt ───────────────────────────────────────────
_robots_cache: dict[str, urllib.robotparser.RobotFileParser | None] = {}


def _robots_allows(url: str) -> bool:
    """拿不到 robots.txt 时按「允许」处理 —— 不能因为对方没有这个文件就不抓。"""
    parts = urlsplit(url)
    host = f"{parts.scheme}://{parts.netloc}"

    if host not in _robots_cache:
        rp = urllib.robotparser.RobotFileParser()
        rp.set_url(f"{host}/robots.txt")
        try:
            rp.read()
            _robots_cache[host] = rp
        except Exception as e:
            log.debug("robots.txt 读取失败 %s: %s", host, e)
            _robots_cache[host] = None

    rp = _robots_cache[host]
    if rp is None:
        return True
    try:
        return rp.can_fetch(config.USER_AGENT, url)
    except Exception:
        return True


# ── 三个档位 ─────────────────────────────────────────────
async def _try_fetcher(url: str, timeout: int, sessions: dict) -> str:
    from scrapling.fetchers import AsyncFetcher

    page = await AsyncFetcher.get(url, timeout=timeout * 1000, stealthy_headers=True)
    return getattr(page, "html_content", "") or str(page)


async def _try_dynamic(url: str, timeout: int, sessions: dict) -> str:
    session = sessions.get("dynamic")
    if session is None:
        raise RuntimeError("dynamic session 未初始化")
    page = await session.fetch(url, timeout=timeout * 1000)
    return getattr(page, "html_content", "") or str(page)


async def _try_stealthy(url: str, timeout: int, sessions: dict) -> str:
    session = sessions.get("stealthy")
    if session is None:
        raise RuntimeError("stealthy session 未初始化")
    page = await session.fetch(url, timeout=timeout * 1000, solve_cloudflare=True)
    return getattr(page, "html_content", "") or str(page)


TIERS = (
    ("fetcher", _try_fetcher),
    ("dynamic", _try_dynamic),
    ("stealthy", _try_stealthy),
)


async def fetch_one(
    cand: Candidate, limiter: DomainLimiter, sessions: dict
) -> tuple[FetchResult, str]:
    """返回 (FetchResult, content_html)。content_html 交给 images.py 找图。"""
    if not cand.allow_fulltext:
        return FetchResult(status="skipped", error="源配置 allow_fulltext=false"), ""

    if not _robots_allows(cand.url):
        # robots 禁止 → 直接 skipped，不升级档位（§4.8 硬性要求）
        log.info("robots.txt 禁止抓取，跳过 %s", cand.url[:90])
        return FetchResult(status="skipped", error="robots.txt 禁止"), ""

    domain = domain_of(cand.url)
    lock = await limiter.acquire(domain)
    try:
        for tier, runner in TIERS:
            try:
                html = await runner(cand.url, config.FETCH_TIMEOUT[tier], sessions)
                if not html:
                    continue
                markdown, content_html = extract.to_markdown(html, base_url=cand.url)
                if len(markdown) >= config.MIN_BODY_CHARS:
                    return (
                        FetchResult(
                            status="ok",
                            tier=tier,
                            markdown=markdown,
                            search_text=extract.to_search_text(
                                markdown, config.SEARCH_TEXT_CHARS
                            ),
                        ),
                        content_html,
                    )
                log.debug(
                    "%s tier=%s 正文仅 %d 字，不足 %d，升级",
                    cand.url[:70], tier, len(markdown), config.MIN_BODY_CHARS,
                )
            except Exception as e:
                log.warning("fetch %s tier=%s 失败: %s", cand.url[:70], tier, e)
    finally:
        limiter.release(domain, lock)

    return FetchResult(status="failed", error="三档全部失败或正文过短"), ""


async def fetch_many(candidates: list[Candidate]) -> list[tuple[Candidate, FetchResult, str]]:
    """整个 run 只开一次浏览器；结束时关闭。"""
    limiter = DomainLimiter(config.PER_DOMAIN_INTERVAL)
    semaphore = asyncio.Semaphore(config.GLOBAL_FETCH_CONCURRENCY)
    capped = candidates[: config.MAX_FETCH_PER_RUN]
    if len(candidates) > config.MAX_FETCH_PER_RUN:
        log.warning(
            "候选 %d 条超过单次抓取上限 %d，截断",
            len(candidates), config.MAX_FETCH_PER_RUN,
        )

    sessions: dict = {}
    try:
        sessions = await _open_sessions()

        async def one(cand: Candidate):
            async with semaphore:
                result, content_html = await fetch_one(cand, limiter, sessions)
                return cand, result, content_html

        return await asyncio.gather(*(one(c) for c in capped))
    finally:
        await _close_sessions(sessions)


async def _open_sessions() -> dict:
    """浏览器 session 开不起来不算致命：第一档纯 HTTP 仍然可用。"""
    sessions: dict = {}
    try:
        from scrapling.fetchers import AsyncDynamicSession

        sessions["dynamic"] = AsyncDynamicSession(headless=True)
        await sessions["dynamic"].__aenter__()
    except Exception as e:
        log.warning("dynamic session 初始化失败，该档位将不可用: %s", e)

    try:
        from scrapling.fetchers import AsyncStealthySession

        sessions["stealthy"] = AsyncStealthySession(headless=True)
        await sessions["stealthy"].__aenter__()
    except Exception as e:
        log.warning("stealthy session 初始化失败，该档位将不可用: %s", e)

    return sessions


async def _close_sessions(sessions: dict) -> None:
    for name, session in sessions.items():
        try:
            await session.__aexit__(None, None, None)
        except Exception as e:
            log.debug("关闭 %s session 失败: %s", name, e)
