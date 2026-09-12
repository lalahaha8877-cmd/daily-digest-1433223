"""单个关键词的完整流水线。对应后端需求文档 §4.3、§4.10。

写库顺序是硬性要求（§4.10），保证任何一步崩溃都不留脏数据：

    1. 先写 items（fulltext_status='pending', digest_id=null）
    2. 上传全文 → 更新 fulltext_key/bytes/status/tier/search_text
    3. 上传配图 → 更新 images/image_count/image_bytes
       （占位符替换后再压缩上传全文，图片和文字不分两次写全文对象）
    4. 写 digests
    5. update items set digest_id
    6. 更新 runs
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime
from urllib.parse import urlsplit

from . import config, db, dedupe, discovery, distill, fetcher, images, store
from .models import RunResult

log = logging.getLogger(__name__)


def process(keyword: dict, run: dict, today: date) -> RunResult:
    """同步入口；内部把抓取那段跑在 asyncio 里。"""
    slug = keyword["slug"]
    budget = distill.TokenBudget(config.MAX_TOKENS_PER_RUN)

    # ── 1. 发现 ─────────────────────────────────────────
    max_candidates = keyword["max_items_per_run"] * config.CANDIDATE_MULTIPLIER
    candidates = discovery.discover_all(keyword.get("sources") or [], today, max_candidates)
    log.info("[%s] discovery: %d 候选", slug, len(candidates))

    if not candidates:
        return RunResult(status="no_update", error_code="DISCOVERY_EMPTY")

    # ── 2. 去重 ─────────────────────────────────────────
    candidates = dedupe.dedupe_in_batch(candidates)
    hashes = [dedupe.url_hash(c.url) for c in candidates]
    known = db.existing_url_hashes(keyword["id"], hashes)
    fresh = [c for c, h in zip(candidates, hashes) if h not in known]
    log.info("[%s] dedupe: %d → %d 新条目", slug, len(candidates), len(fresh))

    if not fresh:
        return RunResult(status="no_update", items_found=len(candidates))

    fresh = fresh[: keyword["max_items_per_run"]]

    # ── 3. 先写 items（pending）──────────────────────────
    year_month = today.strftime("%Y-%m")
    rows = [
        {
            "keyword_id": keyword["id"],
            "url": c.url,
            "url_hash": dedupe.url_hash(c.url),
            "title": c.title[:500],
            "source_domain": (urlsplit(c.url).hostname or "").lower().removeprefix("www."),
            "published_at": c.published_at.isoformat() if c.published_at else None,
            "discovery_type": c.discovery_type,
            "rss_summary": c.summary,
            "fulltext_status": "pending",
        }
        for c in fresh
    ]
    inserted = db.insert_items(rows)
    by_url = {r["url"]: r for r in inserted}
    log.info("[%s] 已写入 %d 条 items（pending）", slug, len(inserted))

    # ── 4. 抓全文 + 配图 ────────────────────────────────
    fetched = asyncio.run(fetcher.fetch_many(fresh))

    fulltext_ok = fulltext_failed = images_ok = images_failed = 0
    enriched: list[dict] = []

    for cand, result, content_html in fetched:
        row = by_url.get(cand.url)
        if row is None:
            continue
        item_id = row["id"]

        if result.status != "ok":
            fulltext_failed += 1 if result.status == "failed" else 0
            db.update_item(
                item_id,
                fulltext_status=result.status,
                fetch_error=(result.error or "")[:1000] or None,
            )
            enriched.append({**row, "markdown": None})
            continue

        markdown = result.markdown or ""
        image_metas: list = []
        img_failed = 0

        if content_html:
            try:
                image_metas, markdown, img_failed = images.process(
                    content_html=content_html,
                    markdown=markdown,
                    article_url=cand.url,
                    keyword_slug=slug,
                    year_month=year_month,
                    item_id=item_id,
                )
            except Exception as e:
                # 配图整体失败也不能拖垮这条目的文字部分
                log.warning("[%s] 配图处理异常 %s: %s", slug, cand.url[:70], e)

        images_ok += len(image_metas)
        images_failed += img_failed

        # 全文对象：占位符替换后一次性写入（§4.10 第 3 步）
        try:
            key = store.fulltext_key(slug, year_month, item_id)
            size = store.put_fulltext(markdown, key)
            db.update_item(
                item_id,
                fulltext_key=key,
                fulltext_bytes=size,
                fulltext_status="ok",
                fetch_tier=result.tier,
                search_text=result.search_text,
                images=[m.as_dict() for m in image_metas],
                image_count=len(image_metas),
                image_bytes=sum(m.bytes for m in image_metas),
            )
            fulltext_ok += 1
        except Exception as e:
            log.error("[%s] 全文写入失败 %s: %s", slug, cand.url[:70], e)
            fulltext_failed += 1
            db.update_item(item_id, fulltext_status="failed", fetch_error=str(e)[:1000])
            enriched.append({**row, "markdown": None})
            continue

        enriched.append({**row, "markdown": markdown})

    log.info(
        "[%s] fetch: ok=%d failed=%d，配图 ok=%d failed=%d",
        slug, fulltext_ok, fulltext_failed, images_ok, images_failed,
    )

    # ── 5. 预筛 + 提炼 ──────────────────────────────────
    screened = [
        item
        for item in enriched
        if distill.screen(
            item["title"], item.get("markdown") or item.get("rss_summary") or "",
            keyword["name"], budget,
        )
    ]
    log.info("[%s] 预筛通过 %d / %d", slug, len(screened), len(enriched))

    draft = distill.distill(keyword, today, screened, budget)

    base = RunResult(
        items_found=len(candidates),
        items_new=len(inserted),
        fulltext_ok=fulltext_ok,
        fulltext_failed=fulltext_failed,
        images_ok=images_ok,
        images_failed=images_failed,
        tokens_in=budget.tokens_in,
        tokens_out=budget.tokens_out,
        status="ok",
    )

    if draft.status == "no_update":
        base.status = "no_update"
        log.info("[%s] done status=no_update", slug)
        return base

    # ── 6. 写 digest 并回填 digest_id ───────────────────
    digest = db.insert_digest(
        keyword_id=keyword["id"],
        digest_date=today,
        title=draft.title,
        summary_md=draft.summary_md,
        bullets=[{"text": b.text, "item_ids": b.item_ids} for b in draft.bullets],
    )
    cited = {i for b in draft.bullets for i in b.item_ids}
    db.attach_items_to_digest(digest["id"], sorted(cited))

    if budget.exceeded:
        base.error_code = "BUDGET_EXCEEDED"
        log.warning("[%s] token 预算超限（%d），已完成部分照常入库", slug, budget.total)

    log.info(
        "[%s] distill: %d 条要点，tokens in=%d out=%d",
        slug, len(draft.bullets), budget.tokens_in, budget.tokens_out,
    )
    log.info("[%s] done status=ok", slug)
    return base


def classify(e: Exception) -> str:
    """异常 → error_code。对应 §4.12。"""
    name = type(e).__name__
    text = str(e)

    if "AI_PARSE_ERROR" in text:
        return "AI_PARSE_ERROR"
    if name == "RateLimitError":
        return "AI_RATE_LIMIT"
    if name in ("APITimeoutError", "APIConnectionError"):
        return "AI_TIMEOUT"
    if "storage" in text.lower() or "bucket" in text.lower():
        return "STORAGE_ERROR"
    if "postgrest" in text.lower() or "duplicate key" in text.lower():
        return "DB_ERROR"
    return "UNKNOWN"
