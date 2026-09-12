"""对象存储适配层。对应后端需求文档 §3。

三个 bucket、两个后端：

    fulltext  → Supabase Storage   全文归档（gzip 后的 Markdown）
    exports   → Supabase Storage   导出文件
    images    → Cloudflare R2      文章配图（WebP）

图片单独放 R2 的原因：压缩后约 2.2GB/年，不到半年挤爆 Supabase 1GB 免费额度；
R2 免费 10GB 且下载流量不计费（前端渲染配图时浏览器直连 R2）。

**任何业务代码不得直接调用 Supabase Storage SDK 或 boto3，一律走 ObjectStore。**
"""

from __future__ import annotations

import gzip
import logging
from typing import Protocol

from . import config

log = logging.getLogger(__name__)


class ObjectStore(Protocol):
    def put(self, bucket: str, key: str, data: bytes, content_type: str) -> None: ...
    def get(self, bucket: str, key: str) -> bytes: ...
    def delete(self, bucket: str, keys: list[str]) -> None: ...
    def signed_url(self, bucket: str, key: str, ttl: int = 300) -> str: ...


# ── Supabase Storage ─────────────────────────────────────
class SupabaseStore:
    def __init__(self, client):
        self._client = client

    def put(self, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self._client.storage.from_(bucket).upload(
            path=key,
            file=data,
            file_options={"content-type": content_type, "upsert": "true"},
        )

    def get(self, bucket: str, key: str) -> bytes:
        return self._client.storage.from_(bucket).download(key)

    def delete(self, bucket: str, keys: list[str]) -> None:
        if keys:
            self._client.storage.from_(bucket).remove(keys)

    def signed_url(self, bucket: str, key: str, ttl: int = 300) -> str:
        res = self._client.storage.from_(bucket).create_signed_url(key, ttl)
        # supabase-py 不同版本返回 {'signedURL': ...} 或 {'signedUrl': ...}
        if isinstance(res, dict):
            for field in ("signedURL", "signedUrl", "signed_url"):
                if res.get(field):
                    return res[field]
        raise RuntimeError(f"无法从签名结果里取出 URL: {res!r}")


# ── Cloudflare R2（S3 兼容）───────────────────────────────
class R2Store:
    def __init__(self, client, bucket_override: str | None = None):
        self._client = client
        # R2 里的真实桶名可能和逻辑 bucket 名 "images" 不同
        self._bucket_override = bucket_override

    def _real(self, bucket: str) -> str:
        return self._bucket_override or bucket

    def put(self, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self._client.put_object(
            Bucket=self._real(bucket), Key=key, Body=data, ContentType=content_type
        )

    def get(self, bucket: str, key: str) -> bytes:
        return self._client.get_object(Bucket=self._real(bucket), Key=key)["Body"].read()

    def delete(self, bucket: str, keys: list[str]) -> None:
        if not keys:
            return
        real = self._real(bucket)
        # S3 的 delete_objects 单次上限 1000
        for i in range(0, len(keys), 1000):
            chunk = keys[i : i + 1000]
            self._client.delete_objects(
                Bucket=real, Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True}
            )

    def signed_url(self, bucket: str, key: str, ttl: int = 300) -> str:
        # presigned URL 是本地签名运算，不发网络请求
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._real(bucket), "Key": key},
            ExpiresIn=ttl,
        )


# ── 路由：按 bucket 名分发到对应后端 ───────────────────────
class RoutingStore:
    def __init__(self, routes: dict[str, ObjectStore]):
        self._routes = routes

    def _backend(self, bucket: str) -> ObjectStore:
        backend = self._routes.get(bucket)
        if backend is None:
            raise KeyError(f"未知的 bucket: {bucket!r}（已注册：{sorted(self._routes)}）")
        return backend

    def put(self, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self._backend(bucket).put(bucket, key, data, content_type)

    def get(self, bucket: str, key: str) -> bytes:
        return self._backend(bucket).get(bucket, key)

    def delete(self, bucket: str, keys: list[str]) -> None:
        self._backend(bucket).delete(bucket, keys)

    def signed_url(self, bucket: str, key: str, ttl: int = 300) -> str:
        return self._backend(bucket).signed_url(bucket, key, ttl)


_store: RoutingStore | None = None


def get_store() -> RoutingStore:
    """单例。首次调用时才建客户端 —— import 本模块不要求密钥齐全。

    配图后端由 config.IMAGES_BACKEND 决定；只有选 r2 时才要求 R2 那几个密钥。
    """
    global _store
    if _store is not None:
        return _store

    from supabase import create_client

    supabase = SupabaseStore(
        create_client(config.secrets.supabase_url, config.secrets.supabase_service_key)
    )

    if config.IMAGES_BACKEND == "r2":
        import boto3

        images_backend: ObjectStore = R2Store(
            boto3.client(
                "s3",
                endpoint_url=f"https://{config.secrets.r2_account_id}.r2.cloudflarestorage.com",
                aws_access_key_id=config.secrets.r2_access_key_id,
                aws_secret_access_key=config.secrets.r2_secret_access_key,
                region_name="auto",
            ),
            bucket_override=config.secrets.r2_bucket_images,
        )
        log.info("配图后端：Cloudflare R2")
    else:
        images_backend = supabase
        log.info("配图后端：Supabase Storage")

    _store = RoutingStore(
        {
            config.BUCKET_FULLTEXT: supabase,
            config.BUCKET_EXPORTS: supabase,
            config.BUCKET_IMAGES: images_backend,
        }
    )
    return _store


# ── 全文的 gzip 约定（§3：全文一律 gzip 后写入）────────────
def put_fulltext(markdown: str, key: str) -> int:
    """压缩写入全文，返回压缩后字节数。"""
    blob = gzip.compress(markdown.encode("utf-8"))
    get_store().put(config.BUCKET_FULLTEXT, key, blob, "application/gzip")
    return len(blob)


def get_fulltext(key: str) -> str:
    blob = get_store().get(config.BUCKET_FULLTEXT, key)
    return gzip.decompress(blob).decode("utf-8")


def fulltext_key(keyword_slug: str, year_month: str, item_id: str) -> str:
    return f"{keyword_slug}/{year_month}/{item_id}.md.gz"


def image_key(keyword_slug: str, year_month: str, item_id: str, index: int) -> str:
    return f"{keyword_slug}/{year_month}/{item_id}/{index}.webp"
