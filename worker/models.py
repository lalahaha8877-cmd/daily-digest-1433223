"""Worker 内部数据结构。对应后端需求文档 §4.1。

注意：这些是 Worker 进程内流转的中间结构，不是 API 契约。
前后端契约在 shared/types.ts（后端文档 §7），两者不要混用。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

DiscoveryType = Literal["rss", "gnews", "listing", "websearch"]
FetchTier = Literal["fetcher", "dynamic", "stealthy"]
FulltextStatus = Literal["pending", "ok", "failed", "skipped", "purged"]
RunStatus = Literal["queued", "running", "ok", "no_update", "failed"]


@dataclass
class Candidate:
    """发现层产出的候选链接（尚未去重、未抓正文）。"""
    url: str
    title: str
    published_at: datetime | None
    summary: str | None            # 源自带摘要，抓取失败时作为兜底写入 items.rss_summary
    discovery_type: DiscoveryType
    allow_fulltext: bool


@dataclass
class ImageMeta:
    """一张已下载、压缩、上传完成的正文配图。对应 items.images 数组的一项。"""
    index: int
    key: str                       # images bucket 里的 key
    alt: str
    width: int
    height: int
    bytes: int

    def as_dict(self) -> dict:
        return {
            "index": self.index, "key": self.key, "alt": self.alt,
            "width": self.width, "height": self.height, "bytes": self.bytes,
        }


@dataclass
class FetchResult:
    """单条目的全文抓取结果。三档全失败时 status='failed'，不抛异常。"""
    status: FulltextStatus
    tier: FetchTier | None = None
    markdown: str | None = None        # 图片占位符已替换为 item-image://{index}
    search_text: str | None = None     # 占位符替换【前】的可读文本前 2000 字
    images: list[ImageMeta] = field(default_factory=list)
    error: str | None = None


@dataclass
class Bullet:
    text: str
    item_ids: list[str]


@dataclass
class DigestDraft:
    """AI 提炼产出，写库前的形态。"""
    status: Literal["ok", "no_update"]
    title: str = ""
    summary_md: str = ""
    bullets: list[Bullet] = field(default_factory=list)


@dataclass
class RunResult:
    """一个关键词跑完后要写回 runs 表的字段。"""
    status: RunStatus
    items_found: int = 0
    items_new: int = 0
    fulltext_ok: int = 0
    fulltext_failed: int = 0
    images_ok: int = 0
    images_failed: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    error_code: str | None = None
    error_message: str | None = None

    def as_run_fields(self) -> dict:
        return {
            "status": self.status,
            "items_found": self.items_found,
            "items_new": self.items_new,
            "fulltext_ok": self.fulltext_ok,
            "fulltext_failed": self.fulltext_failed,
            "images_ok": self.images_ok,
            "images_failed": self.images_failed,
            "tokens_in": self.tokens_in,
            "tokens_out": self.tokens_out,
            "error_code": self.error_code,
            "error_message": self.error_message,
        }
