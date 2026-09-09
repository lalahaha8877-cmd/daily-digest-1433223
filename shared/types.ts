// 前后端唯一契约。逐字对应《每日消息V2-后端需求文档》§7。
//
// 规则（后端文档 §0）：两边都不得单方面改动。
// 前端的 lib/types.ts 直接从本文件复制，不要各写各的。
//
// ⚠️ 已知缺口（实现时注意，不要擅自补）：
//   runs 表有 images_ok / images_failed 两列（§2.3），但 §7 的 RunRecord 没有列出。
//   状态页若要显示配图成功/失败数，需要先在文档层面把这两个字段加进契约，
//   而不是前端或后端单方面加。

export type RunStatus = 'queued' | 'running' | 'ok' | 'no_update' | 'failed'
export type FulltextStatus = 'pending' | 'ok' | 'failed' | 'skipped' | 'purged'
export type FetchTier = 'fetcher' | 'dynamic' | 'stealthy'
export type SourceType = 'rss' | 'gnews' | 'listing' | 'websearch'

export interface Source {
  type: SourceType
  url?: string
  query?: string
  hl?: string
  gl?: string
  ceid?: string
  selector_hint?: string
  schedule?: 'daily' | 'weekly' | 'monthly'
  allow_fulltext: boolean
}

export interface KeywordSummary {
  id: string
  slug: string
  name: string
  enabled: boolean
  unread_count: number
  total_digests: number
  last_digest_date: string | null // 'YYYY-MM-DD'
  last_run: {
    id: string
    status: RunStatus
    run_date: string
    finished_at: string | null
  } | null
}

export interface KeywordDetail extends KeywordSummary {
  query: string
  sources: Source[]
  retention_days: number
  max_items_per_run: number
  created_at: string
}

export interface DigestSummary {
  id: string
  keyword_id: string
  keyword_slug: string
  digest_date: string
  title: string
  preview_bullets: string[] // 最多 2 条
  item_count: number
  source_domains: string[] // 最多 5 个
  is_read: boolean
  is_starred: boolean
}

export interface Bullet {
  text: string
  item_ids: string[]
}

export interface DigestDetail extends DigestSummary {
  summary_md: string
  bullets: Bullet[]
  items: ItemSummary[]
}

export interface ItemSummary {
  id: string
  url: string
  title: string
  source_domain: string
  published_at: string | null
  discovered_at: string
  discovery_type: SourceType
  fulltext_status: FulltextStatus
  fetch_tier: FetchTier | null
  fetch_error: string | null
  rss_summary: string | null
  /** 该条目存档的配图数量，0 表示无图（含「曾有图但已清理」） */
  image_count: number
  is_starred: boolean
}

export interface ItemFulltext extends ItemSummary {
  /** 已把 item-image:// 占位符替换成可用签名 URL */
  markdown: string | null
  keyword: { slug: string; name: string; retention_days: number }
  digest: { id: string; digest_date: string } | null
}

export interface RunRecord {
  id: string
  keyword_id: string
  keyword_slug: string
  keyword_name: string
  run_date: string
  trigger: 'schedule' | 'manual'
  status: RunStatus
  started_at: string | null
  finished_at: string | null
  items_found: number
  items_new: number
  fulltext_ok: number
  fulltext_failed: number
  tokens_in: number
  tokens_out: number
  error_code: string | null
  error_message: string | null
}

// ── 通用响应形态（§6.1）────────────────────────────────
export interface ApiError {
  error: {
    code:
      | 'UNAUTHORIZED'
      | 'VALIDATION_ERROR'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'RATE_LIMITED'
      | 'UPSTREAM_ERROR'
      | 'INTERNAL'
    message: string
  }
}

export interface Paginated<T> {
  data: T[]
  next_cursor: string | null
}
