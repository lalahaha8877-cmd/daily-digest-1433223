"""AI 提炼：预筛 + 提炼两段式。对应后端需求文档 §4.9。

第一段 预筛（Haiku 级）：逐条判断是否真的相关、有实质信息，淘汰营销稿和标题党。
                        失败默认放行 —— 宁可多花一点 token 也不漏内容。
第二段 提炼（Sonnet 级）：把通过预筛的正文拼成一次请求，产出当日简报。
                        **不开 web_search** —— 已经有全文了。
"""

from __future__ import annotations

import json
import logging
import re
import time

from . import config
from .models import Bullet, DigestDraft

log = logging.getLogger(__name__)

_client = None


def client():
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic(api_key=config.secrets.anthropic_api_key)
    return _client


SCREEN_SYSTEM = (
    "你是一个资讯预筛器。判断给定文章是否与订阅关键词真正相关、且含有实质信息。"
    "营销稿、纯转载、标题党、与关键词无关的内容判为不相关。"
    '严格只输出 JSON：{"relevant": true/false, "reason": "简短理由"}'
)

DISTILL_SYSTEM = """你是一名资讯编辑。用户订阅了一个关键词，下面给你今天为这个关键词抓到的若干篇文章正文。

1) 判断这些内容里是否有关于该关键词的实质性新进展；
2) 如果有，产出一条当日简报：一句话标题 + 3-8 条要点，每条要点不超过 60 字；
3) 讲同一件事的多篇文章合并成一条要点，item_ids 列出全部相关来源；
4) 每条要点必须标注它来自哪个 item_id，不允许出现无出处的要点；
5) 不要逐字复制原文，用自己的话概括；
6) 如果几篇文章说法互相矛盾，在要点里明确写出"存在不同说法"，不要挑一个当定论，也不要编造；
7) 如果今天这些内容里没有实质性新进展（都是旧闻、营销稿、重复报道），把 status 设为 "no_update"，其余字段留空，不要为了凑数硬编内容；
8) summary_md 是 2-4 句话的导语，Markdown 纯文本，不要标题层级；
9) 严格只输出下面的 JSON，不要有任何 JSON 之外的文字：
   {"status": "ok" | "no_update",
    "title": "...",
    "summary_md": "...",
    "bullets": [{"text": "...", "item_ids": ["..."]}]}"""


class TokenBudget:
    """整个 run 的 token 预算。超了停止后续调用，已完成部分照常入库。"""

    def __init__(self, limit: int):
        self.limit = limit
        self.tokens_in = 0
        self.tokens_out = 0
        self.exceeded = False

    def add(self, usage) -> None:
        self.tokens_in += getattr(usage, "input_tokens", 0)
        self.tokens_out += getattr(usage, "output_tokens", 0)
        if self.tokens_in + self.tokens_out > self.limit:
            self.exceeded = True

    @property
    def total(self) -> int:
        return self.tokens_in + self.tokens_out


def extract_json(text: str) -> dict:
    """兜底：模型夹带了 JSON 之外的文字时，截取第一个 { 到最后一个 }。"""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("响应中未找到 JSON 结构")
    return json.loads(text[start : end + 1])


# ── 第一段：预筛 ─────────────────────────────────────────
def screen(title: str, body: str, keyword_name: str, budget: TokenBudget) -> bool:
    """返回是否放行。任何失败都放行 —— 宁可多花一点也不要漏内容。"""
    if not config.AI_ENABLED:
        return True                      # 无 AI 模式：不筛，全留
    if budget.exceeded:
        return True

    prompt = (
        f"订阅关键词：{keyword_name}\n\n"
        f"标题：{title}\n\n"
        f"正文前 1000 字：\n{body[:1000]}"
    )
    try:
        resp = client().messages.create(
            model=config.MODEL_SCREEN,
            max_tokens=200,
            system=SCREEN_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
            timeout=config.SCREEN_TIMEOUT,
        )
        budget.add(resp.usage)
        text = "".join(b.text for b in resp.content if b.type == "text")
        verdict = extract_json(text)
        relevant = bool(verdict.get("relevant", True))
        if not relevant:
            log.info("预筛淘汰《%s》：%s", title[:40], str(verdict.get("reason", ""))[:60])
        return relevant
    except Exception as e:
        log.warning("预筛失败，默认放行《%s》：%s", title[:40], e)
        return True


# ── 第二段：提炼 ─────────────────────────────────────────
def _build_prompt(keyword: dict, digest_date, items: list[dict]) -> str:
    parts = [
        f"关键词：{keyword['name']}",
        f"检索词：{keyword['query']}",
        f"日期：{digest_date}",
        "",
    ]
    for item in items:
        body = (item.get("markdown") or item.get("rss_summary") or "")[
            : config.MAX_CHARS_PER_ITEM
        ]
        parts += [
            f"--- item_id: {item['id']} ---",
            f"标题：{item['title']}",
            f"来源：{item['source_domain']}",
            f"发布时间：{item.get('published_at') or '未知'}",
            "正文：",
            body,
            "",
        ]
    return "\n".join(parts)


def mechanical_digest(keyword: dict, items: list[dict]) -> DigestDraft:
    """无 AI 模式的简报：机械地按文章标题列出，不做提炼也不做合并。

    质量约等于 V1（标题列表），但数据结构是完整的 V2 —— 每条要点仍然绑定
    item_id，前端的「点要点跳到出处」照常可用。全文也照常归档，
    以后开了 AI 可以拿存档重新生成。
    """
    bullets = [
        Bullet(text=item["title"][:200], item_ids=[item["id"]])
        for item in items
        if item.get("title")
    ]
    if not bullets:
        return DigestDraft(status="no_update")

    return DigestDraft(
        status="ok",
        title=f"{keyword['name']}：{len(bullets)} 篇新内容",
        summary_md=(
            f"今天为「{keyword['name']}」收录了 {len(bullets)} 篇新内容。"
            "本条简报未经 AI 提炼，要点即文章标题原文。"
        ),
        bullets=bullets,
    )


def distill(keyword: dict, digest_date, items: list[dict], budget: TokenBudget) -> DigestDraft:
    """产出当日简报。解析失败重试一次，仍失败抛异常 → 本关键词 failed。"""
    if not items:
        return DigestDraft(status="no_update")

    if not config.AI_ENABLED:
        log.info("AI 已关闭，按标题机械生成简报")
        return mechanical_digest(keyword, items)

    if budget.exceeded:
        log.warning("token 预算已超，跳过提炼")
        return DigestDraft(status="no_update")

    prompt = _build_prompt(keyword, digest_date, items)
    valid_ids = {item["id"] for item in items}
    last_error: Exception | None = None

    for attempt in (1, 2):
        try:
            resp = client().messages.create(
                model=config.MODEL_DISTILL,
                max_tokens=4000,
                system=DISTILL_SYSTEM,
                messages=[{"role": "user", "content": prompt}],
                # 第二次重试时略微提高随机性，避开上次那条走不通的路径
                temperature=0.0 if attempt == 1 else 0.4,
            )
            budget.add(resp.usage)
            text = "".join(b.text for b in resp.content if b.type == "text")
            data = extract_json(text)
            return _validate(data, valid_ids)
        except json.JSONDecodeError as e:
            last_error = e
            log.warning("提炼输出解析失败（第 %d 次）：%s", attempt, e)
        except Exception as e:
            last_error = e
            if _is_retryable(e) and attempt == 1:
                delay = 5
                log.warning("提炼调用失败，%d 秒后重试：%s", delay, e)
                time.sleep(delay)
            else:
                raise

    raise RuntimeError(f"AI_PARSE_ERROR: {last_error}")


def _is_retryable(e: Exception) -> bool:
    name = type(e).__name__
    return name in ("RateLimitError", "APITimeoutError", "APIConnectionError", "InternalServerError")


def _validate(data: dict, valid_ids: set[str]) -> DigestDraft:
    """剔除引用了不存在 item_id 的要点。全被剔除则视为 no_update。"""
    if data.get("status") == "no_update":
        return DigestDraft(status="no_update")

    bullets: list[Bullet] = []
    for raw in data.get("bullets") or []:
        text = (raw.get("text") or "").strip()
        ids = [i for i in (raw.get("item_ids") or []) if i in valid_ids]
        dropped = len(raw.get("item_ids") or []) - len(ids)
        if dropped:
            log.warning("要点引用了 %d 个不存在的 item_id，已剔除", dropped)
        if text and ids:
            bullets.append(Bullet(text=text, item_ids=ids))

    if not bullets:
        log.warning("所有要点都被剔除，按 no_update 处理")
        return DigestDraft(status="no_update")

    return DigestDraft(
        status="ok",
        title=(data.get("title") or "").strip() or "当日简报",
        summary_md=(data.get("summary_md") or "").strip(),
        bullets=bullets,
    )
