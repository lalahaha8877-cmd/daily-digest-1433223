import { db } from '@/lib/supabase'
import { apiError, guard, ok, readJson } from '@/lib/http'
import { listKeywords } from '@/lib/queries'
import { ValidationError, slugify, validateCreate } from '@/lib/validate'
import type { KeywordDetail } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** 3. GET /api/keywords —— 关键词列表（含未读数、最近运行）。 */
export async function GET(req: Request) {
  return guard(async () => {
    const includeDisabled =
      new URL(req.url).searchParams.get('include_disabled') === 'true'
    return ok({ data: await listKeywords(includeDisabled) })
  })
}

/**
 * 4. POST /api/keywords —— 新建关键词。
 *
 * slug 冲突时追加 -2、-3…（§6.3 第 4 条）。这里用「查已占用的前缀 → 取最小空位」
 * 而不是循环 insert 试错：单用户场景没有并发新建，一次查询就够，
 * 且避免了失败的 insert 在 Postgres 里留下序列空洞。
 */
export async function POST(req: Request) {
  return guard(async () => {
    const body = await readJson(req)
    if (!body) return apiError('VALIDATION_ERROR', '请求体不是合法的 JSON')

    let input
    try {
      input = validateCreate(body)
    } catch (e) {
      if (e instanceof ValidationError) return apiError('VALIDATION_ERROR', e.message)
      throw e
    }

    const base = input.slug ?? slugify(input.name)
    const { data: taken } = await db()
      .from('keywords')
      .select('slug')
      .like('slug', `${base}%`)

    const used = new Set((taken ?? []).map((r) => r.slug as string))
    let slug = base
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`

    const { data, error } = await db()
      .from('keywords')
      .insert({
        slug,
        name: input.name,
        query: input.query,
        sources: input.sources,
        retention_days: input.retention_days,
        max_items_per_run: input.max_items_per_run,
      })
      .select('*')
      .single()

    if (error || !data) {
      // 唯一约束是最后一道防线：上面的空位计算和它撞车时走这里
      if (error?.code === '23505') return apiError('CONFLICT', 'slug 已被占用，换一个名称重试')
      console.error('[api] 新建关键词失败', error)
      return apiError('INTERNAL', '写入失败')
    }

    const detail: KeywordDetail = {
      id: data.id,
      slug: data.slug,
      name: data.name,
      enabled: data.enabled,
      unread_count: 0,
      total_digests: 0,
      last_digest_date: null,
      last_run: null,
      query: data.query,
      sources: data.sources ?? [],
      retention_days: data.retention_days,
      max_items_per_run: data.max_items_per_run,
      created_at: data.created_at,
    }
    return ok(detail, 201)
  })
}
