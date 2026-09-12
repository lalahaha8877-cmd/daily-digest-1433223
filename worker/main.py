"""采集 Worker 入口。对应后端需求文档 §4.2、§4.3。

    python -m worker.main run                          # 跑所有 enabled 关键词（cron）
    python -m worker.main run --keyword <slug>         # 只跑一个
    python -m worker.main run --run-id <uuid>          # 手动触发时由 A 传入
    python -m worker.main run --keyword <slug> --force # 忽略「今天已跑过」
    python -m worker.main cleanup                      # 只跑清理

退出码：0 全部成功或部分无更新 / 1 至少一个关键词 failed / 2 启动期致命错误
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime

from . import cleanup, config, db, logging_setup, pipeline

log = logging.getLogger("worker")

EXIT_OK, EXIT_FAILED, EXIT_FATAL = 0, 1, 2


def cmd_run(args: argparse.Namespace) -> int:
    # run_date / digest_date 按用户时区算 —— UTC 00:00 触发时
    # date.today() 会算成前一天（§4.4）
    today = datetime.now(config.USER_TZ).date()
    slugs = [args.keyword] if args.keyword else None

    try:
        keywords = db.list_keywords(enabled=True, slugs=slugs)
    except Exception as e:
        log.error("读取关键词失败：%s", e, exc_info=True)
        return EXIT_FATAL

    if not keywords:
        log.warning("没有匹配的启用中关键词（slugs=%s）", slugs)
        return EXIT_OK

    log.info("本次将处理 %d 个关键词，日期 %s", len(keywords), today)
    failed = 0

    for kw in keywords:
        slug = kw["slug"]
        run = None
        try:
            run = _claim(kw, today, args)
            if run is None:
                log.info("[%s] 跳过：今天已跑过", slug)
                continue

            result = pipeline.process(kw, run, today)
            db.update_run(run["id"], **result.as_run_fields())

        except Exception as e:
            # 任何一个关键词的异常都不得传播到循环外（§4.3 硬性要求）
            failed += 1
            log.exception("[%s] 失败", slug)
            if run is not None:
                try:
                    db.update_run(
                        run["id"],
                        status="failed",
                        error_code=pipeline.classify(e),
                        error_message=str(e)[:2000],
                    )
                except Exception as inner:
                    log.error("[%s] 连失败状态都没写进去：%s", slug, inner)

    # 清理失败不影响采集结果
    cleanup.run()

    return EXIT_FAILED if failed else EXIT_OK


def _claim(keyword: dict, today, args: argparse.Namespace) -> dict | None:
    """手动触发走 take_over（A 已建好 queued 的 run）；其余走 claim_run 抢占。"""
    if args.run_id:
        run = db.take_over_run(args.run_id)
        if run is None:
            log.warning("--run-id %s 对应的 run 不存在", args.run_id)
        return run

    if args.force:
        superseded = db.supersede_today(keyword["id"], today)
        if superseded:
            log.info("[%s] --force：已把 %d 条当天记录标为 SUPERSEDED", keyword["slug"], superseded)

    return db.claim_run(keyword["id"], today)


def cmd_cleanup(args: argparse.Namespace) -> int:
    try:
        cleanup.run()
        return EXIT_OK
    except Exception:
        log.exception("清理失败")
        return EXIT_FAILED


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="worker", description="每日消息 V2 采集 Worker")
    sub = parser.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", help="执行采集")
    p_run.add_argument("--keyword", help="只跑这一个关键词（slug）")
    p_run.add_argument("--run-id", dest="run_id", help="由 A 预建的 run 记录 id")
    p_run.add_argument("--force", action="store_true", help="忽略「今天已跑过」")
    p_run.set_defaults(func=cmd_run)

    p_cleanup = sub.add_parser("cleanup", help="只执行保留策略清理")
    p_cleanup.set_defaults(func=cmd_cleanup)

    return parser


def main(argv: list[str] | None = None) -> int:
    logging_setup.setup()
    args = build_parser().parse_args(argv)

    try:
        # 提前触碰一次密钥，缺失时以 EXIT_FATAL 退出而不是跑到一半才炸
        config.secrets.supabase_url
        config.secrets.supabase_service_key
        # 开了 AI 却没给 Key，原先要等抓完全文、跑到 distill 才炸，
        # 白花十几分钟还留下一半写好的数据。在这里就拦住。
        if config.AI_ENABLED:
            config.secrets.anthropic_api_key
    except RuntimeError as e:
        log.error("启动检查失败：%s", e)
        if "ANTHROPIC_API_KEY" in str(e):
            log.error("要么补上 ANTHROPIC_API_KEY，要么设 AI_ENABLED=false 走无 AI 模式")
        return EXIT_FATAL

    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
