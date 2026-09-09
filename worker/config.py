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
BUCKET_FULLTEXT = "fulltext"      # Supabase Storage
BUCKET_EXPORTS = "exports"        # Supabase Storage
BUCKET_IMAGES = "images"          # Cloudflare R2


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
