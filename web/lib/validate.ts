import type { Source, SourceType } from './types'

/**
 * 关键词输入校验。对应后端需求文档 §6.3 第 4、6 条。
 *
 * 所有写操作在服务端二次校验，不信任前端（§6.1）。前端的表单校验只是
 * 为了即时反馈，绕过它直接打接口同样过不去。
 */

export const SOURCE_TYPES: SourceType[] = ['rss', 'gnews', 'listing', 'websearch']
const SCHEDULES = ['daily', 'weekly', 'monthly']

export const LIMITS = {
  nameMax: 40,
  slugPattern: /^[a-z0-9-]{1,40}$/,
  retentionMin: 1,
  retentionMax: 3650,
  retentionDefault: 90,
  itemsMin: 1,
  itemsMax: 20,
  itemsDefault: 5,
} as const

export class ValidationError extends Error {}

function fail(msg: string): never {
  throw new ValidationError(msg)
}

function isHttpUrl(v: unknown): v is string {
  if (typeof v !== 'string' || !v.trim()) return false
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * slug 生成：中文没法直接转 URL 安全字符，先抽出其中的拉丁字母和数字；
 * 抽不出（纯中文名）就退回随机串 —— 文档 §6.3 第 4 条允许拼音或 nanoid 兜底，
 * 这里选随机串：不引入拼音库，且 slug 只要稳定唯一即可，可读性由 name 承担。
 */
export function slugify(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.nameMax)
  if (ascii) return ascii

  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

/** 校验单个发现源。按 type 要求不同的必填字段（§4.6）。 */
function validateSource(raw: unknown, index: number): Source {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`第 ${index + 1} 个来源格式不对`)
  }
  const s = raw as Record<string, unknown>
  const type = s.type

  if (typeof type !== 'string' || !SOURCE_TYPES.includes(type as SourceType)) {
    fail(`第 ${index + 1} 个来源的类型必须是 ${SOURCE_TYPES.join(' / ')}`)
  }

  const out: Source = {
    type: type as SourceType,
    // 缺省放行抓全文；明确禁止抓取的站点由用户设 false（主文档 §12 合规要求）
    allow_fulltext: s.allow_fulltext !== false,
  }

  switch (out.type) {
    case 'rss':
    case 'listing':
      if (!isHttpUrl(s.url)) fail(`第 ${index + 1} 个来源需要一个 http(s) 地址`)
      out.url = (s.url as string).trim()
      if (out.type === 'listing' && typeof s.selector_hint === 'string' && s.selector_hint.trim()) {
        out.selector_hint = s.selector_hint.trim()
      }
      break

    case 'gnews':
      if (typeof s.query !== 'string' || !s.query.trim()) {
        fail(`第 ${index + 1} 个来源需要填检索词`)
      }
      out.query = (s.query as string).trim()
      out.hl = typeof s.hl === 'string' && s.hl.trim() ? s.hl.trim() : 'zh-CN'
      out.gl = typeof s.gl === 'string' && s.gl.trim() ? s.gl.trim() : 'CN'
      out.ceid = typeof s.ceid === 'string' && s.ceid.trim() ? s.ceid.trim() : 'CN:zh'
      break

    case 'websearch':
      out.schedule = SCHEDULES.includes(s.schedule as string)
        ? (s.schedule as Source['schedule'])
        : 'weekly'
      break
  }

  return out
}

function validateInt(raw: unknown, min: number, max: number, label: string): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    fail(`${label}必须是 ${min}–${max} 之间的整数`)
  }
  return n
}

export interface KeywordInput {
  name: string
  query: string
  slug?: string
  sources: Source[]
  retention_days: number
  max_items_per_run: number
  enabled?: boolean
}

/**
 * 新建（POST）用：name / query 必填，其余取默认值。
 * 抛 ValidationError，由 Route Handler 转成 400。
 */
export function validateCreate(body: Record<string, unknown>): KeywordInput {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > LIMITS.nameMax) {
    fail(`名称必填，且不超过 ${LIMITS.nameMax} 字`)
  }

  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (!query) fail('检索词必填')

  let slug: string | undefined
  if (typeof body.slug === 'string' && body.slug.trim()) {
    slug = body.slug.trim().toLowerCase()
    if (!LIMITS.slugPattern.test(slug)) {
      fail('slug 只能是小写字母、数字和连字符，最多 40 个字符')
    }
  }

  const rawSources = Array.isArray(body.sources) ? body.sources : []
  const sources = rawSources.map(validateSource)
  if (!sources.length) fail('至少要配置一个发现源')

  return {
    name,
    query,
    slug,
    sources,
    retention_days:
      body.retention_days === undefined
        ? LIMITS.retentionDefault
        : validateInt(body.retention_days, LIMITS.retentionMin, LIMITS.retentionMax, '保留天数'),
    max_items_per_run:
      body.max_items_per_run === undefined
        ? LIMITS.itemsDefault
        : validateInt(body.max_items_per_run, LIMITS.itemsMin, LIMITS.itemsMax, '每次最多条目'),
  }
}

/**
 * 更新（PATCH）用：只校验出现的字段。
 * **slug 不接受修改** —— 改了会破坏已有链接（§6.3 第 6 条）。
 */
export function validatePatch(body: Record<string, unknown>): Partial<KeywordInput> {
  const out: Partial<KeywordInput> = {}

  if ('slug' in body) fail('slug 不可修改')

  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > LIMITS.nameMax) fail(`名称必填，且不超过 ${LIMITS.nameMax} 字`)
    out.name = name
  }

  if ('query' in body) {
    const query = typeof body.query === 'string' ? body.query.trim() : ''
    if (!query) fail('检索词必填')
    out.query = query
  }

  if ('sources' in body) {
    if (!Array.isArray(body.sources)) fail('发现源格式不对')
    const sources = body.sources.map(validateSource)
    if (!sources.length) fail('至少要配置一个发现源')
    out.sources = sources
  }

  if ('retention_days' in body) {
    out.retention_days = validateInt(
      body.retention_days,
      LIMITS.retentionMin,
      LIMITS.retentionMax,
      '保留天数',
    )
  }

  if ('max_items_per_run' in body) {
    out.max_items_per_run = validateInt(
      body.max_items_per_run,
      LIMITS.itemsMin,
      LIMITS.itemsMax,
      '每次最多条目',
    )
  }

  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') fail('启用状态必须是 true / false')
    out.enabled = body.enabled
  }

  if (!Object.keys(out).length) fail('没有可更新的字段')
  return out
}
