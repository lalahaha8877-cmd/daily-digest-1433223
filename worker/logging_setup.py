"""日志配置。对应后端需求文档 §4.13。

输出到 stdout（GitHub Actions 里就是运行日志）。格式带关键词 slug，
便于在多关键词混跑的日志里定位。

硬性要求：日志里禁止出现任何 API key。
"""

from __future__ import annotations

import logging
import re
import sys

# 兜底掩码：即便某处不小心把密钥拼进了日志，也在输出前打码。
# 这是最后一道防线，不是许可证 —— 代码里仍然不许主动记录密钥。
_SECRET_PATTERNS = [
    re.compile(r"sk-ant-[A-Za-z0-9_\-]{10,}"),          # Anthropic
    re.compile(r"eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"),  # JWT(Supabase)
    re.compile(r"(?i)(api[_-]?key|secret|token|password)[\"'\s:=]+([A-Za-z0-9_\-]{16,})"),
]


class _RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:
            return True
        redacted = msg
        for pat in _SECRET_PATTERNS:
            redacted = pat.sub(lambda m: m.group(0)[:6] + "…REDACTED", redacted)
        if redacted != msg:
            record.msg = redacted
            record.args = ()
        return True


class _KeywordAdapter(logging.LoggerAdapter):
    """给日志行加 [slug] 前缀。"""

    def process(self, msg, kwargs):
        slug = self.extra.get("slug") if self.extra else None
        return (f"[{slug}] {msg}" if slug else msg), kwargs


def setup(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s %(levelname)-5s %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S%z",
        )
    )
    handler.addFilter(_RedactFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # 第三方库默认太吵
    for noisy in ("httpx", "httpcore", "urllib3", "boto3", "botocore", "s3transfer"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def for_keyword(logger: logging.Logger, slug: str) -> logging.LoggerAdapter:
    return _KeywordAdapter(logger, {"slug": slug})
