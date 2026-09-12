"""正文提取：HTML → Markdown。对应后端需求文档 §4.8。

产出必须去掉导航、页脚、广告、评论区 —— 这一步同时是配图的免费过滤器：
images.py 只在「已提取的正文 HTML」里找 <img>，天然避开导航头像和广告位。

策略：trafilatura 优先（正文识别质量好），拿不到再退 readability-lxml。
配图的【下载】不依赖 trafilatura 的 include_images —— 该开关在社区反馈里不总可靠
（主文档 §16 引用的 issue），改为自己从正文 HTML 解析 <img>，更可控。

但 markdown 与 html 两条提取路径都必须开 include_images，否则会出现一种静默失败：
html 里有 <img>（图照常下载、上传、写库、计入 images_ok），markdown 里却没有
![](...) 链接，于是 images.py 的占位符替换无目标可替、什么都不做也不报错——
图片进了存储桶却永远不会显示。2026-09-12 首次云端运行即踩到此坑。
"""

from __future__ import annotations

import logging
import re

log = logging.getLogger(__name__)


def to_markdown(html: str, base_url: str) -> tuple[str, str]:
    """返回 (markdown, content_html)。

    content_html 是「只含正文」的 HTML，交给 images.py 找图用。
    两者都拿不到时返回 ("", "")，调用方据此判定该档位失败。
    """
    markdown = _try_trafilatura_markdown(html, base_url)
    content_html = _try_trafilatura_html(html, base_url)

    if not content_html:
        content_html = _try_readability(html)

    if not markdown and content_html:
        markdown = _html_to_markdown(content_html)

    return (markdown or "").strip(), content_html or ""


def _try_trafilatura_markdown(html: str, base_url: str) -> str:
    try:
        import trafilatura

        out = trafilatura.extract(
            html,
            url=base_url,
            output_format="markdown",
            include_comments=False,
            include_tables=True,
            include_images=True,     # 必须与 _try_trafilatura_html 保持一致，见模块 docstring
            favor_precision=True,
        )
        return out or ""
    except Exception as e:
        log.debug("trafilatura markdown 提取失败: %s", e)
        return ""


def _try_trafilatura_html(html: str, base_url: str) -> str:
    """拿只含正文的 HTML（保留 <img>，供配图抓取）。"""
    try:
        import trafilatura

        out = trafilatura.extract(
            html,
            url=base_url,
            output_format="html",
            include_comments=False,
            include_tables=True,
            include_images=True,     # 仅为保住 <img> 标签，不依赖它下载图片
            favor_precision=True,
        )
        return out or ""
    except Exception as e:
        log.debug("trafilatura html 提取失败: %s", e)
        return ""


def _try_readability(html: str) -> str:
    try:
        from readability import Document

        return Document(html).summary(html_partial=True) or ""
    except ImportError:
        return ""
    except Exception as e:
        log.debug("readability 提取失败: %s", e)
        return ""


def _html_to_markdown(content_html: str) -> str:
    try:
        from markdownify import markdownify

        return markdownify(content_html, heading_style="ATX", strip=["script", "style"])
    except ImportError:
        # 最后兜底：剥标签，至少保住文字
        text = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", content_html, flags=re.S | re.I)
        text = re.sub(r"<[^>]+>", " ", text)
        return re.sub(r"[ \t]{2,}", " ", text)


def to_search_text(markdown: str, limit: int) -> str:
    """items.search_text：全文前 N 字，压成单行。

    §4.10 要求取「占位符替换前」的可读文本 —— 所以调用方必须在
    images 替换占位符之前调用本函数。
    """
    flat = re.sub(r"\s+", " ", markdown).strip()
    return flat[:limit]
