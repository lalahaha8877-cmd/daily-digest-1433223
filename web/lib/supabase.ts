import { createClient, SupabaseClient } from '@supabase/supabase-js'

/**
 * 服务端专用的 Supabase 客户端。
 *
 * 用 service_role key 绕过 RLS（数据库对 5 张表都开了 RLS 且没写任何策略，
 * 所以 anon key 是零权限）。
 *
 * 【绝不能在客户端组件里 import 本模块】—— service_role 权限极大，
 * 一旦进了浏览器包就等于把数据库交出去了。所有数据访问都走 app/api/* 的
 * Route Handler 或 Server Component。
 */
let cached: SupabaseClient | null = null

export function db(): SupabaseClient {
  if (cached) return cached

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    throw new Error('缺少 SUPABASE_URL / SUPABASE_SERVICE_KEY 环境变量')
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}

export const BUCKET_FULLTEXT = 'fulltext'
export const BUCKET_EXPORTS = 'exports'
export const BUCKET_IMAGES = 'images'

/** 签名 URL：下载类 300 秒；图片 3600 秒（阅读页可能停留较久）。 */
export async function signedUrl(
  bucket: string,
  key: string,
  ttl = 300,
): Promise<string | null> {
  const { data, error } = await db().storage.from(bucket).createSignedUrl(key, ttl)
  if (error || !data) return null
  return data.signedUrl
}

/** 读取并解压全文归档（Worker 侧一律 gzip 后写入）。 */
export async function readFulltext(key: string): Promise<string | null> {
  const { data, error } = await db().storage.from(BUCKET_FULLTEXT).download(key)
  if (error || !data) return null

  const stream = data.stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).text()
}

/**
 * 把正文里的 `item-image://{index}` 占位符换成当次有效的签名 URL。
 *
 * 存档里写的是占位符而不是真实 URL —— 签名 URL 会过期，写死进存档
 * 过一阵子就打不开了。
 */
export async function resolveImagePlaceholders(
  markdown: string,
  images: Array<{ index: number; key: string }>,
): Promise<string> {
  if (!markdown.includes('item-image://')) return markdown

  const urls = new Map<number, string>()
  await Promise.all(
    images.map(async (img) => {
      const url = await signedUrl(BUCKET_IMAGES, img.key, 3600)
      if (url) urls.set(img.index, url)
    }),
  )

  return markdown.replace(/item-image:\/\/(\d+)/g, (whole, n) => {
    return urls.get(Number(n)) ?? whole
  })
}
