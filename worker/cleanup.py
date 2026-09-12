"""保留策略执行。对应后端需求文档 §4.11、主文档 §8.2。

    L1  keywords / runs / digests / items 元数据与摘要   永久保留，不参与清理
    L2  全文归档对象 + 它名下的全部配图                  保留 retention_days 天，同时清理
    L3  导出文件                                       过期即删
    豁免 digests.is_starred 或 items.is_starred          永久保留

清理任务本身出错【不得】影响 run 的成功状态。
"""

from __future__ import annotations

import logging

from . import config, db, store

log = logging.getLogger(__name__)


def run() -> dict:
    """返回统计。任何异常都在内部吞掉并记日志。"""
    stats = {"fulltext_purged": 0, "images_deleted": 0, "exports_deleted": 0}
    try:
        stats["fulltext_purged"], stats["images_deleted"] = _purge_expired_fulltext()
    except Exception as e:
        log.error("全文清理失败（不影响采集结果）: %s", e, exc_info=True)
    try:
        stats["exports_deleted"] = _purge_expired_exports()
    except Exception as e:
        log.error("导出清理失败（不影响采集结果）: %s", e, exc_info=True)

    log.info(
        "[清理] 全文 purged=%d，配图 deleted=%d，导出 deleted=%d",
        stats["fulltext_purged"], stats["images_deleted"], stats["exports_deleted"],
    )
    return stats


def _purge_expired_fulltext() -> tuple[int, int]:
    """文字和图片同一个保留期、同一次动作 —— 一个 item 过期，它的全文和配图一起删。"""
    total_items = total_images = 0

    while True:
        rows = db.expired_items(limit=1000)
        if not rows:
            break

        fulltext_keys = [r["fulltext_key"] for r in rows if r.get("fulltext_key")]
        image_keys: list[str] = []
        for r in rows:
            for img in r.get("images") or []:
                if img.get("key"):
                    image_keys.append(img["key"])

        if fulltext_keys:
            store.get_store().delete(config.BUCKET_FULLTEXT, fulltext_keys)
        if image_keys:
            store.get_store().delete(config.BUCKET_IMAGES, image_keys)

        db.mark_items_purged([r["id"] for r in rows])

        total_items += len(rows)
        total_images += len(image_keys)

        if len(rows) < 1000:
            break

    return total_items, total_images


def _purge_expired_exports() -> int:
    total = 0
    while True:
        rows = db.expired_exports(limit=1000)
        if not rows:
            break
        keys = [r["storage_key"] for r in rows if r.get("storage_key")]
        if keys:
            store.get_store().delete(config.BUCKET_EXPORTS, keys)
        db.delete_exports([r["id"] for r in rows])
        total += len(rows)
        if len(rows) < 1000:
            break
    return total
