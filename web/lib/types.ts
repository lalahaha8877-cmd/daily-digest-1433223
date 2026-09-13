// 前后端唯一契约。逐字对应《每日消息V2-后端需求文档》§7。
//
// 规则（后端文档 §0）：两边都不得单方面改动。
// 前端的 lib/types.ts 直接从本文件复制，不要各写各的。
//
// ⚠️ 相对后端文档 §7 的两处偏差，都记在这里，不要静默改动：
//
// 1. 【已补】RunRecord.created_at —— §7 没列出，但 §5.2 的「僵死 run 呈现为
//    failed」规则明确要求按 created_at 判断是否超过 45 分钟。缺了它这条规则
//    无法实现（queued 状态的 run 没有 started_at）。已补上并标为可选，
//    以免旧的调用方拿不到时报错。
//
// 2. 【未补】runs 表有 images_ok / images_failed 两列（§2.3），§7 未列出。
//    状态页目前不显示配图成败数。要显示的话，应先在文档层面把这两个字段
//    加进契约，而不是任何一边单方面加。
//
// 3. 【新增】ExpiringItem / ExpiringGroup —— 文档里没有这两个类型，也没有
//    对应接口。它们服务于一个文档未覆盖的需求：在存档被保留策略删掉之前
//    提醒用户。文档 §8.2 只规定了「过期即删」，前端文档 §5.5 则是事后告知
//    （「已按保留策略清理」），并在已清理的条目上放一个「收藏这条以后不再
//    清理」按钮 —— 但那时东西已经删了，收藏救不回来。真正能救的时机在删除
//    之前，文档没有覆盖。这两个类型和 /api/expiring 是为补这个缺口加的。

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
  /** §7 未列出，但 §5.2 的僵死 run 判断需要它。见文件顶部说明。 */
  created_at?: string
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

// ── 到期提醒（文档外新增，见文件头第 3 条）──────────────
//
// 判定规则必须与 worker/db.py 的 expired_items() 逐条对齐，否则提醒的
// 和实际删的不是同一批。四个条件：fulltext_status='ok'、条目未收藏、
// 所属简报未收藏、按用户时区算的天数差 >= retention_days。

export interface ExpiringItem {
  id: string
  title: string
  url: string
  source_domain: string
  discovered_at: string
  /** 距离被清理还剩几天。<= 0 表示已达保留期，下一次清理就会删。 */
  days_left: number
  image_count: number
  keyword: { slug: string; name: string; retention_days: number }
  digest: { id: string; digest_date: string } | null
}

export interface ExpiringGroup {
  keyword: { slug: string; name: string }
  items: ExpiringItem[]
}
