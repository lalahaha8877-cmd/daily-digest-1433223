"""环境变量与全局常量。对应后端需求文档 §4.1、§9。

所有可调参数集中在这里，业务模块不要各自读 os.environ。
"""

from __future__ import annotations

import os
from zoneinfo import ZoneInfo


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        raise RuntimeError(f"环境变量 {name} 必须是整数，实际是 {raw!r}")


def _require(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        raise RuntimeError(f"缺少必需的环境变量 {name}")
    return val


# ── 时区 ─────────────────────────────────────────────────
# 数据库全用 timestamptz(UTC)，但 run_date / digest_date 是 date，
# 必须按用户时区算 —— 否则 UTC 00:00 触发时会算成前一天（§4.4）。
USER_TZ = ZoneInfo(os.environ.get("USER_TZ", "Asia/Kuala_Lumpur"))

# ── 模型 ─────────────────────────────────────────────────
MODEL_SCREEN = os.environ.get("MODEL_SCREEN", "claude-haiku-4-5-20251001")
MODEL_DISTILL = os.environ.get("MODEL_DISTILL", "claude-sonnet-5")

# ── 抓取 ─────────────────────────────────────────────────
MIN_BODY_CHARS = 500              # 低于此视为抓取失败，升级下一档
PER_DOMAIN_INTERVAL = 2.0         # 同域名两次请求最小间隔（秒），§12 合规要求
MAX_FETCH_PER_RUN = _int_env("MAX_FETCH_PER_RUN", 100)
GLOBAL_FETCH_CONCURRENCY = 5
FETCH_TIMEOUT = {"fetcher": 20, "dynamic": 45, "stealthy": 90}
USER_AGENT = "Mozilla/5.0 (compatible; DailyDigestBot/2.0)"

# ── 配图（§4.8.1）─────────────────────────────────────────
MAX_IMAGES_PER_ITEM = _int_env("MAX_IMAGES_PER_ITEM", 6)
MIN_IMAGE_DIMENSION = 150         # px，短边小于此视为图标/头像/追踪像素
IMAGE_MAX_WIDTH = 1600            # px，只缩小不放大
MAX_IMAGE_BYTES = _int_env("MAX_IMAGE_BYTES", 400_000)
IMAGE_DOWNLOAD_CAP = 8_000_000    # 原始下载体积上限，防异常大文件拖垮任务
IMAGE_TIMEOUT = 15                # 秒/张
WEBP_QUALITY_LADDER = (85, 70, 55, 40)

# ── AI 提炼（§4.9）────────────────────────────────────────
MAX_CHARS_PER_ITEM = 6000         # 单篇喂给提炼模型的正文截断长度
MAX_TOKENS_PER_RUN = _int_env("MAX_TOKENS_PER_RUN", 400_000)
SCREEN_TIMEOUT = 30               # 预筛单条超时（秒），超时默认放行

# ── 其他 ─────────────────────────────────────────────────
SEARCH_TEXT_CHARS = 2000          # items.search_text 取全文前 N 字
CANDIDATE_MULTIPLIER = 4          # 候选截断到 max_items_per_run * 此值

# ── Bucket 名 ────────────────────────────────────────────
BUCKET_FULLTEXT = "fulltext"
BUCKET_EXPORTS = "exports"
BUCKET_IMAGES = "images"

# 配图存哪个后端："supabase" 或 "r2"。
#
# 默认 supabase —— 后端文档 §3 原本指定 R2，理由是「压缩后约 2.2GB/年，
# 不到半年挤爆 Supabase 1GB 免费额度」。但那是**年累计**数字，而 §8.2 L2 又
# 规定配图与全文同期清理（默认 retention_days=90）。按 90 天保留算稳态：
#
#     1 个关键词  →  约 53 MB       10 个关键词 → 约 527 MB
#
# 都在 1GB 以内。所以起步阶段不需要第二个存储账号（R2 还要绑支付卡）。
#
# 什么时候该切到 r2：关键词数上到两位数、把 retention_days 调很长、
# 或者大量使用收藏（收藏豁免清理、会一直累积）。切换只需改这个环境变量，
# 业务代码一行不动。切换后旧图仍在 Supabase，需要的话得自行搬迁。
IMAGES_BACKEND = os.environ.get("IMAGES_BACKEND", "supabase").strip().lower()
if IMAGES_BACKEND not in ("supabase", "r2"):
    raise RuntimeError(f"IMAGES_BACKEND 只能是 supabase 或 r2，实际是 {IMAGES_BACKEND!r}")


class Secrets:
    """延迟读取：import 本模块时不要求密钥齐全，方便跑单元测试。"""

    @property
    def anthropic_api_key(self) -> str:
        return _require("ANTHROPIC_API_KEY")

    @property
    def supabase_url(self) -> str:
        return _require("SUPABASE_URL")

    @property
    def supabase_service_key(self) -> str:
        return _require("SUPABASE_SERVICE_KEY")

    @property
    def r2_account_id(self) -> str:
        return _require("R2_ACCOUNT_ID")

    @property
    def r2_access_key_id(self) -> str:
        return _require("R2_ACCESS_KEY_ID")

    @property
    def r2_secret_access_key(self) -> str:
        return _require("R2_SECRET_ACCESS_KEY")

    @property
    def r2_bucket_images(self) -> str:
        return os.environ.get("R2_BUCKET_IMAGES", BUCKET_IMAGES)


secrets = Secrets()
