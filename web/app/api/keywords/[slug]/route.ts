import { db, BUCKET_EXPORTS, BUCKET_FULLTEXT, BUCKET_IMAGES } from '@/lib/supabase'
import { apiError, guard, ok, readJson } from '@/lib/http'
import { getKeywordDetail } from '@/lib/queries'
import { ValidationError, validatePatch } from '@/lib/validate'

export const dynamic = 'force-dynamic'

/** 5. GET /api/keywords/:slug —— 关键词详情（含 sources）。 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return guard(async () => {
    const { slug } = await params
    const detail = await getKeywordDetail(slug)
    if (!detail) return apiError('NOT_FOUND', '关键词不存在')
    return ok(detail)
  })
}

/** 6. PATCH /api/keywords/:slug —— 更新。slug 不可改（会破坏已有链接）。 */
export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return guard(async () => {
    const { slug } = await params

    const body = await readJson(req)
    if (!body) return apiError('VALIDATION_ERROR', '请求体不是合法的 JSON')

    let patch
    try {
      patch = validatePatch(body)
    } catch (e) {
      if (e instanceof ValidationError) return apiError('VALIDATION_ERROR', e.message)
      throw e
    }

    const { data, error } = await db()
      .from('keywords')
      .update(patch)
      .eq('slug', slug)
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('[api] 更新关键词失败', error)
      return apiError('INTERNAL', '写入失败')
    }
    if (!data) return apiError('NOT_FOUND', '关键词不存在')

    const detail = await getKeywordDetail(slug)
    return detail ? ok(detail) : apiError('NOT_FOUND', '关键词不存在')
  })
}

/** Supabase Storage 的 remove 一次不宜给太多 key，分批发。 */
const DELETE_CHUNK = 100

async function removeAll(bucket: string, keys: string[]): Promise<number> {
  let removed = 0
  for (let i = 0; i < keys.length; i += DELETE_CHUNK) {
    const chunk = keys.slice(i, i + DELETE_CHUNK)
    const { error } = await db().storage.from(bucket).remove(chunk)
    if (error) {
      // 对象删不掉不该挡住关键词删除 —— 留几个孤儿对象，好过留一个删不掉的关键词
      console.error(`[api] 删除 ${bucket} 对象失败`, error)
      continue
    }
    removed += chunk.length
  }
  return removed
}

/**
 * 7. DELETE /api/keywords/:slug —— 删除（级联）。
 *
 * 数据库侧靠 FK on delete cascade 清掉 runs/digests/items/exports 行，
 * 但**对象存储没有级联**，必须在删行之前把 key 收集出来，否则就永远找不到了。
 *
 * 【与文档的一处偏差】§6.3 第 7 条只要求删 fulltext 和 exports 两个桶，
 * 没提 images —— 那是文档 1.1 版新增的桶，这一条没有同步更新。照字面实现
 * 会把配图永远留在桶里：按 §8.1 的测算图片是体积最大的一类，孤儿图会直接
 * 吃掉免费额度。这里一并删除，并把三个桶的数量都计入 deleted_objects。
 *
 * 按数据库记录收集 key 而不是按前缀列举：exports 的 key 是
 * `{digest_id}/{format}/...`，根本不带 keyword_slug 前缀，列举法覆盖不到。
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return guard(async () => {
    const { slug } = await params

    const { data: keyword } = await db()
      .from('keywords')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()
    if (!keyword) return apiError('NOT_FOUND', '关键词不存在')

    const { data: items } = await db()
      .from('items')
      .select('fulltext_key,images')
      .eq('keyword_id', keyword.id)

    const fulltextKeys: string[] = []
    const imageKeys: string[] = []
    for (const it of items ?? []) {
      if (it.fulltext_key) fulltextKeys.push(it.fulltext_key)
      for (const img of (it.images ?? []) as Array<{ key?: string }>) {
        if (img?.key) imageKeys.push(img.key)
      }
    }

    const { data: digests } = await db()
      .from('digests')
      .select('id')
      .eq('keyword_id', keyword.id)
    const digestIds = (digests ?? []).map((d) => d.id as string)

    let exportKeys: string[] = []
    if (digestIds.length) {
      const { data: exports } = await db()
        .from('exports')
        .select('storage_key')
        .in('digest_id', digestIds)
      exportKeys = (exports ?? []).map((e) => e.storage_key as string).filter(Boolean)
    }

    let deletedObjects = 0
    if (fulltextKeys.length) deletedObjects += await removeAll(BUCKET_FULLTEXT, fulltextKeys)
    if (imageKeys.length) deletedObjects += await removeAll(BUCKET_IMAGES, imageKeys)
    if (exportKeys.length) deletedObjects += await removeAll(BUCKET_EXPORTS, exportKeys)

    const { error } = await db().from('keywords').delete().eq('id', keyword.id)
    if (error) {
      console.error('[api] 删除关键词失败', error)
      return apiError('INTERNAL', '删除失败')
    }

    return ok({ ok: true, deleted_objects: deletedObjects })
  })
}
