"""URL 规范化与去重。对应后端需求文档 §4.7。

去重的主力是 items 表的 unique(keyword_id, url_hash)，本模块只负责把
「同一篇文章的不同写法」归一到同一个 hash。
"""

from __future__ import annotations

import hashlib
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# 追踪参数：前缀匹配
TRACKING_PREFIXES = ("utm_", "ref_")

# 追踪参数：精确匹配
TRACKING_KEYS = {
    "fbclid", "gclid", "mc_cid", "mc_eid", "spm", "share_token",
}


def normalize_url(u: str) -> str:
    """协议统一 https、域名小写去 www、剥追踪参数、查询串排序、去尾斜杠。"""
    p = urlsplit(u)
    host = (p.hostname or "").lower().removeprefix("www.")
    qs = [
        (k, v) for k, v in parse_qsl(p.query)
        if not k.lower().startswith(TRACKING_PREFIXES)
        and k.lower() not in TRACKING_KEYS
    ]
    path = p.path.rstrip("/") or "/"
    return urlunsplit(("https", host, path, urlencode(sorted(qs)), ""))


def url_hash(u: str) -> str:
    return hashlib.sha256(normalize_url(u).encode()).hexdigest()


def dedupe_in_batch(candidates: list) -> list:
    """本批内去重：同一个规范化 URL 只留第一个（发现顺序即优先级）。

    跨批次（与库里已有条目）的去重由调用方一次性批量查库完成，
    不要逐条查 —— 见 §4.7「不要逐条查库」。
    """
    seen: set[str] = set()
    out = []
    for c in candidates:
        h = url_hash(c.url)
        if h in seen:
            continue
        seen.add(h)
        out.append(c)
    return out
