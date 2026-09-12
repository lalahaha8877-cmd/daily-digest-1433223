"""正文配图：下载 → 过滤 → 压缩 → 上传 → 占位符替换。对应后端需求文档 §4.8.1。

三层过滤噪音：
  1. 只在【已提取的正文 HTML】里找 <img> —— 结构性排除导航头像、广告位、页脚 logo
  2. 短边 < 150px 丢弃 —— 图标、头像、追踪像素
  3. 每篇最多 6 张 —— 控成本，也避免文章被十几张无关配图淹没

失败粒度是【单张】：5 张坏 2 张，另外 3 张照常保留，全文文字也不受影响。
"""

from __future__ import annotations

import io
import logging
import re
from urllib.parse import urljoin, urlsplit

from . import config, store
from .models import ImageMeta

log = logging.getLogger(__name__)

_IMG_TAG = re.compile(r"<img\b[^>]*>", re.I)
_ATTR = re.compile(r"""(\w[\w:-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))""")


def _parse_img_tags(content_html: str) -> list[dict]:
    """按出现顺序解析 <img>，同一 src 只留第一次。"""
    out: list[dict] = []
    seen: set[str] = set()

    for tag in _IMG_TAG.findall(content_html):
        attrs = {}
        for m in _ATTR.finditer(tag):
            attrs[m.group(1).lower()] = m.group(3) or m.group(4) or m.group(5) or ""

        # 懒加载的图片真实地址常在 data-src / data-original 上，src 是占位图
        src = (
            attrs.get("data-src")
            or attrs.get("data-original")
            or attrs.get("src")
            or ""
        ).strip()
        if not src or src.startswith("data:"):
            continue
        if src in seen:
            continue
        seen.add(src)
        out.append({"src": src, "alt": attrs.get("alt", "").strip(), "raw": tag})
    return out


def _download(url: str, referer: str, session) -> tuple[bytes, str] | None:
    """带 Referer 下载，绕过大多数站点的防盗链。超过体积上限直接放弃。"""
    resp = session.get(
        url,
        headers={"Referer": referer, "User-Agent": config.USER_AGENT},
        timeout=config.IMAGE_TIMEOUT,
        stream=True,
    )
    resp.raise_for_status()

    ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    if not ctype.startswith("image/"):
        log.debug("跳过非图片响应 %s (%s)", url[:80], ctype)
        return None

    buf = bytearray()
    for chunk in resp.iter_content(64 * 1024):
        buf.extend(chunk)
        if len(buf) > config.IMAGE_DOWNLOAD_CAP:
            log.debug("图片超过下载上限，放弃 %s", url[:80])
            return None
    return bytes(buf), ctype


def _compress(raw: bytes) -> tuple[bytes, int, int] | None:
    """缩放 + 逐档降质编码为 WebP。返回 (bytes, width, height)，不合格返回 None。"""
    from PIL import Image

    im = Image.open(io.BytesIO(raw))
    im.load()

    if min(im.width, im.height) < config.MIN_IMAGE_DIMENSION:
        return None                                  # 图标 / 头像 / 追踪像素

    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA" if "A" in im.mode else "RGB")

    if im.width > config.IMAGE_MAX_WIDTH:            # 只缩小，不放大
        ratio = config.IMAGE_MAX_WIDTH / im.width
        im = im.resize(
            (config.IMAGE_MAX_WIDTH, max(1, round(im.height * ratio))),
            Image.LANCZOS,
        )

    for quality in config.WEBP_QUALITY_LADDER:
        out = io.BytesIO()
        im.save(out, format="WEBP", quality=quality, method=4)
        data = out.getvalue()
        if len(data) <= config.MAX_IMAGE_BYTES:
            return data, im.width, im.height

    return None                                      # 降到最低档仍超限 → 放弃这张


def process(
    content_html: str,
    markdown: str,
    article_url: str,
    keyword_slug: str,
    year_month: str,
    item_id: str,
) -> tuple[list[ImageMeta], str, int]:
    """返回 (成功的图片元数据, 替换过占位符的 markdown, 失败张数)。

    Markdown 里写的是 `item-image://{index}` 占位符而不是真实 URL ——
    签名 URL 会过期，写死进存档过一阵子就打不开了。读取时由 API 层换成
    当次有效的签名 URL（后端文档 §6.3 第 13 条）。
    """
    candidates = _parse_img_tags(content_html)[: config.MAX_IMAGES_PER_ITEM]
    if not candidates:
        return [], markdown, 0

    try:
        import requests
    except ImportError:
        log.warning("缺少 requests，跳过配图抓取")
        return [], markdown, 0

    results: list[ImageMeta] = []
    failed = 0

    with requests.Session() as session:
        for index, img in enumerate(candidates):
            src = urljoin(article_url, img["src"])       # 相对路径补全
            try:
                downloaded = _download(src, article_url, session)
                if downloaded is None:
                    failed += 1
                    continue

                compressed = _compress(downloaded[0])
                if compressed is None:
                    failed += 1
                    continue

                data, width, height = compressed
                key = store.image_key(keyword_slug, year_month, item_id, index)
                store.get_store().put(config.BUCKET_IMAGES, key, data, "image/webp")

                results.append(
                    ImageMeta(
                        index=index,
                        key=key,
                        alt=img["alt"],
                        width=width,
                        height=height,
                        bytes=len(data),
                    )
                )
                markdown = _replace_src(markdown, img["src"], src, index)
            except Exception as e:
                # 单张失败不阻塞其他图，也不阻塞全文
                failed += 1
                log.warning("配图失败 %s: %s", src[:90], e)

    log.info("配图 ok=%d failed=%d", len(results), failed)
    return results, markdown, failed


def _replace_src(markdown: str, original_src: str, resolved_src: str, index: int) -> str:
    """把 Markdown 里指向这张图的链接换成占位符。

    原始 src 和补全后的绝对 URL 都要试 —— 取决于 markdown 是由哪条路径产出的。
    """
    placeholder = f"item-image://{index}"
    for src in (original_src, resolved_src):
        if not src:
            continue
        # ![alt](src) 与 ![alt](src "title") 两种写法
        pattern = re.compile(
            r"(!\[[^\]]*\]\()\s*" + re.escape(src) + r"(\s+[^)]*)?\)"
        )
        markdown = pattern.sub(lambda m: m.group(1) + placeholder + ")", markdown)
    return markdown


def resolve_placeholders(markdown: str, images: list[dict], ttl: int = 3600) -> str:
    """读取侧：把占位符换成当次有效的签名 URL。

    A（Next.js）也要做同样的事；这里提供 Python 侧实现，供导出 zip 等场景复用。
    """
    by_index = {img["index"]: img for img in images}

    def sub(m: re.Match) -> str:
        index = int(m.group(1))
        img = by_index.get(index)
        if img is None:
            return m.group(0)
        return store.get_store().signed_url(config.BUCKET_IMAGES, img["key"], ttl)

    return re.sub(r"item-image://(\d+)", sub, markdown)
