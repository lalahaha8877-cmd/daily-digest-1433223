"""Supabase Postgres 读写。对应后端需求文档 §4.5、§4.10。

用 supabase-py（PostgREST）。service_role key 绕过 RLS。
写库顺序的硬性要求见 §4.10 —— pipeline 负责按序调用，本模块只提供原子操作。
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any

from . import config

log = logging.getLogger(__name__)

_client = None


def client():
    global _client
    if _client is None:
        from supabase import create_client

        _client = create_client(
            config.secrets.supabase_url, config.secrets.supabase_service_key
        )
    return _client


def _now() -> str:
    return datetime.now(config.USER_TZ).isoformat()


# ── keywords ─────────────────────────────────────────────
def list_keywords(enabled: bool = True, slugs: list[str] | None = None) -> list[dict]:
    q = client().table("keywords").select("*")
    if enabled:
        q = q.eq("enabled", True)
    if slugs:
        q = q.in_("slug", slugs)
    return q.order("created_at").execute().data or []


def get_keyword(slug: str) -> dict | None:
    rows = client().table("keywords").select("*").eq("slug", slug).limit(1).execute().data
    return rows[0] if rows else None


# ── runs ─────────────────────────────────────────────────
def claim_run(keyword_id: str, run_date: date, trigger: str = "schedule") -> dict | None:
    """一条 insert 完成「检查 + 占位」。

    依赖 runs_keyword_day_success 部分唯一索引：当天已有
    queued/running/ok/no_update 的记录时插入被吞掉，返回 None → 跳过。
    这样 cron 和手动触发撞车时不会跑两遍。
    """
    try:
        res = (
            client()
            .table("runs")
            .insert(
                {
                    "keyword_id": keyword_id,
                    "run_date": run_date.isoformat(),
                    "trigger": trigger,
                    "status": "running",
                    "started_at": _now(),
                },
                returning="representation",
            )
            .execute()
        )
        return res.data[0] if res.data else None
    except Exception as e:
        # 唯一索引冲突 = 今天已经跑过，这是正常路径不是错误
        if _is_unique_violation(e):
            return None
        raise


def _is_unique_violation(e: Exception) -> bool:
    text = str(e).lower()
    return "23505" in text or "duplicate key" in text or "conflict" in text


def supersede_today(keyword_id: str, run_date: date) -> int:
    """--force 用：把当天已有的非失败记录标成 failed(SUPERSEDED)，好让新的插进来。"""
    res = (
        client()
        .table("runs")
        .update(
            {
                "status": "failed",
                "error_code": "SUPERSEDED",
                "error_message": "被 --force 重跑覆盖",
                "finished_at": _now(),
            }
        )
        .eq("keyword_id", keyword_id)
        .eq("run_date", run_date.isoformat())
        .in_("status", ["queued", "running", "ok", "no_update"])
        .execute()
    )
    return len(res.data or [])


def take_over_run(run_id: str) -> dict | None:
    """手动触发路径：A 已建好 queued 的 run，Worker 直接把它改成 running。"""
    res = (
        client()
        .table("runs")
        .update({"status": "running", "started_at": _now()})
        .eq("id", run_id)
        .execute()
    )
    return res.data[0] if res.data else None


def update_run(run_id: str, **fields: Any) -> None:
    if "finished_at" not in fields and fields.get("status") in ("ok", "no_update", "failed"):
        fields["finished_at"] = _now()
    client().table("runs").update(fields).eq("id", run_id).execute()


# ── items ────────────────────────────────────────────────
def existing_url_hashes(keyword_id: str, hashes: list[str]) -> set[str]:
    """批量查已存在的 hash。§4.7 明确要求不要逐条查库。"""
    if not hashes:
        return set()
    found: set[str] = set()
    # PostgREST 的 URL 长度有限，分批查
    for i in range(0, len(hashes), 200):
        chunk = hashes[i : i + 200]
        rows = (
            client()
            .table("items")
            .select("url_hash")
            .eq("keyword_id", keyword_id)
            .in_("url_hash", chunk)
            .execute()
            .data
            or []
        )
        found.update(r["url_hash"] for r in rows)
    return found


def insert_items(rows: list[dict]) -> list[dict]:
    if not rows:
        return []
    return (
        client().table("items").insert(rows, returning="representation").execute().data or []
    )


def update_item(item_id: str, **fields: Any) -> None:
    client().table("items").update(fields).eq("id", item_id).execute()


def attach_items_to_digest(digest_id: str, item_ids: list[str]) -> None:
    if item_ids:
        client().table("items").update({"digest_id": digest_id}).in_("id", item_ids).execute()


# ── digests ──────────────────────────────────────────────
def insert_digest(
    keyword_id: str, digest_date: date, title: str, summary_md: str, bullets: list[dict]
) -> dict:
    res = (
        client()
        .table("digests")
        .upsert(
            {
                "keyword_id": keyword_id,
                "digest_date": digest_date.isoformat(),
                "title": title,
                "summary_md": summary_md,
                "bullets": bullets,
            },
            on_conflict="keyword_id,digest_date",
            returning="representation",
        )
        .execute()
    )
    return res.data[0]


# ── cleanup 用 ───────────────────────────────────────────
def expired_items(limit: int = 1000) -> list[dict]:
    """过期且未收藏的全文条目。收藏豁免一切清理（§8.2）。

    PostgREST 表达不了「join keywords 拿 retention_days 再比日期」，
    所以拉回来在 Python 里判断 —— 数据量在这个量级完全够用。
    """
    rows = (
        client()
        .table("items")
        .select("id,fulltext_key,images,discovered_at,is_starred,digest_id,keyword_id")
        .eq("fulltext_status", "ok")
        .eq("is_starred", False)
        .order("discovered_at")
        .limit(limit * 3)      # 留余量给后面的 starred digest / 保留期过滤
        .execute()
        .data
        or []
    )
    if not rows:
        return []

    retention = {k["id"]: k["retention_days"] for k in _all_keywords_retention()}
    starred_digests = _starred_digest_ids({r["digest_id"] for r in rows if r["digest_id"]})

    now = datetime.now(config.USER_TZ)
    out = []
    for r in rows:
        days = retention.get(r["keyword_id"])
        if days is None:
            continue
        if r["digest_id"] in starred_digests:
            continue                                    # 所属简报被收藏 → 豁免
        discovered = datetime.fromisoformat(r["discovered_at"])
        if (now - discovered).days >= days:
            out.append(r)
        if len(out) >= limit:
            break
    return out


def _all_keywords_retention() -> list[dict]:
    return client().table("keywords").select("id,retention_days").execute().data or []


def _starred_digest_ids(digest_ids: set[str]) -> set[str]:
    if not digest_ids:
        return set()
    rows = (
        client()
        .table("digests")
        .select("id")
        .in_("id", list(digest_ids))
        .eq("is_starred", True)
        .execute()
        .data
        or []
    )
    return {r["id"] for r in rows}


def mark_items_purged(item_ids: list[str]) -> None:
    if not item_ids:
        return
    client().table("items").update(
        {
            "fulltext_key": None,
            "fulltext_bytes": None,
            "fulltext_status": "purged",
            "images": [],
            # search_text / image_count / image_bytes 保留：
            # 前端仍要能说「这条曾有 N 张图，已清理」
        }
    ).in_("id", item_ids).execute()


def expired_exports(limit: int = 1000) -> list[dict]:
    return (
        client()
        .table("exports")
        .select("id,storage_key")
        .lt("expires_at", datetime.now(config.USER_TZ).isoformat())
        .limit(limit)
        .execute()
        .data
        or []
    )


def delete_exports(export_ids: list[str]) -> None:
    if export_ids:
        client().table("exports").delete().in_("id", export_ids).execute()
