import { db, readFulltext, resolveImagePlaceholders } from './supabase'
import type {
  DigestDetail,
  DigestSummary,
  ExpiringGroup,
  ItemSummary,
  KeywordDetail,
  KeywordSummary,
  RunRecord,
} from './types'

/**
 * 僵死 run：queued/running 超过 45 分钟，在响应里呈现为 failed（不改库）。
 * 对应后端文档 §5.2 的兜底规则。
 */
const STALE_RUN_MINUTES = 45

function applyStaleRule<T extends { status: string; created_at?: string | null }>(
  run: T,
): T {
  if (run.status !== 'queued' && run.status !== 'running') return run
  if (!run.created_at) return run
  const age = Date.now() - new Date(run.created_at).getTime()
  if (age < STALE_RUN_MINUTES * 60_000) return run
  return { ...run, status: 'failed', error_code: 'TIMEOUT' }
}

// ── 关键词 ───────────────────────────────────────────────
export async function listKeywords(includeDisabled = false): Promise<KeywordSummary[]> {
  let q = db().from('keywords').select('*')
  if (!includeDisabled) q = q.eq('enabled', true)
  const { data: keywords } = await q

  if (!keywords?.length) return []

  const ids = keywords.map((k) => k.id)
  const [{ data: digests }, { data: runs }] = await Promise.all([
    db().from('digests').select('keyword_id,digest_date,is_read').in('keyword_id', ids),
    db()
      .from('runs')
      .select('id,keyword_id,status,run_date,finished_at,created_at')
      .in('keyword_id', ids)
      .order('created_at', { ascending: false }),
  ])

  // 这里只需要 KeywordSummary.last_run 那四个字段，不必凑成完整的 RunRecord
  type LastRun = {
    id: string
    keyword_id: string
    status: RunRecord['status']
    run_date: string
    finished_at: string | null
    created_at?: string | null
  }
  const lastRun = new Map<string, LastRun>()
  for (const r of (runs ?? []) as LastRun[]) {
    if (!lastRun.has(r.keyword_id)) lastRun.set(r.keyword_id, applyStaleRule(r))
  }

  const summaries: KeywordSummary[] = keywords.map((k) => {
    const mine = (digests ?? []).filter((d) => d.keyword_id === k.id)
    const dates = mine.map((d) => d.digest_date).sort()
    const run = lastRun.get(k.id)
    return {
      id: k.id,
      slug: k.slug,
      name: k.name,
      enabled: k.enabled,
      unread_count: mine.filter((d) => !d.is_read).length,
      total_digests: mine.length,
      last_digest_date: dates.length ? dates[dates.length - 1] : null,
      last_run: run
        ? {
            id: run.id,
            status: run.status,
            run_date: run.run_date,
            finished_at: run.finished_at,
          }
        : null,
    }
  })

  // 排序：有未读的在前，组内按 last_digest_date 倒序；从未采集过的排最后
  return summaries.sort((a, b) => {
    if (!a.enabled !== !b.enabled) return a.enabled ? -1 : 1
    const au = a.unread_count > 0 ? 1 : 0
    const bu = b.unread_count > 0 ? 1 : 0
    if (au !== bu) return bu - au
    if (!a.last_digest_date) return 1
    if (!b.last_digest_date) return -1
    return b.last_digest_date.localeCompare(a.last_digest_date)
  })
}

export async function getKeyword(slug: string) {
  const { data } = await db().from('keywords').select('*').eq('slug', slug).maybeSingle()
  return data
}

/**
 * KeywordDetail = KeywordSummary + sources/query/保留配置（契约 §7）。
 *
 * 复用 listKeywords 拿统计部分：单用户场景关键词是个位数，多查一次的代价
 * 远低于把那段未读数/最近运行的聚合逻辑复制一份再各自演化。
 */
export async function getKeywordDetail(slug: string): Promise<KeywordDetail | null> {
  const row = await getKeyword(slug)
  if (!row) return null

  const summary = (await listKeywords(true)).find((k) => k.slug === slug)

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    enabled: row.enabled,
    unread_count: summary?.unread_count ?? 0,
    total_digests: summary?.total_digests ?? 0,
    last_digest_date: summary?.last_digest_date ?? null,
    last_run: summary?.last_run ?? null,
    query: row.query,
    sources: row.sources ?? [],
    retention_days: row.retention_days,
    max_items_per_run: row.max_items_per_run,
    created_at: row.created_at,
  }
}

// ── 日报 ─────────────────────────────────────────────────
export async function listDigests(
  slug: string,
  opts: { limit?: number; unreadOnly?: boolean; starredOnly?: boolean; date?: string } = {},
): Promise<DigestSummary[]> {
  const keyword = await getKeyword(slug)
  if (!keyword) return []

  let q = db()
    .from('digests')
    .select('*')
    .eq('keyword_id', keyword.id)
    .order('digest_date', { ascending: false })
    .limit(opts.limit ?? 20)

  if (opts.date) q = q.eq('digest_date', opts.date)
  if (opts.unreadOnly) q = q.eq('is_read', false)
  if (opts.starredOnly) q = q.eq('is_starred', true)

  const { data: digests } = await q
  if (!digests?.length) return []

  const { data: items } = await db()
    .from('items')
    .select('digest_id,source_domain')
    .in('digest_id', digests.map((d) => d.id))

  return digests.map((d) => {
    const mine = (items ?? []).filter((i) => i.digest_id === d.id)
    const domains = Array.from(new Set(mine.map((i) => i.source_domain))).slice(0, 5)
    return {
      id: d.id,
      keyword_id: d.keyword_id,
      keyword_slug: keyword.slug,
      digest_date: d.digest_date,
      title: d.title,
      preview_bullets: (d.bullets ?? []).slice(0, 2).map((b: { text: string }) => b.text),
      item_count: mine.length,
      source_domains: domains,
      is_read: d.is_read,
      is_starred: d.is_starred,
    }
  })
}

export async function getDigestDetail(
  slug: string,
  date: string,
): Promise<DigestDetail | null> {
  const keyword = await getKeyword(slug)
  if (!keyword) return null

  const { data: digest } = await db()
    .from('digests')
    .select('*')
    .eq('keyword_id', keyword.id)
    .eq('digest_date', date)
    .maybeSingle()
  if (!digest) return null

  const { data: items } = await db()
    .from('items')
    .select('*')
    .eq('digest_id', digest.id)
    .order('published_at', { ascending: false, nullsFirst: false })

  return {
    id: digest.id,
    keyword_id: digest.keyword_id,
    keyword_slug: keyword.slug,
    digest_date: digest.digest_date,
    title: digest.title,
    summary_md: digest.summary_md,
    bullets: digest.bullets ?? [],
    preview_bullets: (digest.bullets ?? []).slice(0, 2).map((b: { text: string }) => b.text),
    item_count: items?.length ?? 0,
    source_domains: Array.from(new Set((items ?? []).map((i) => i.source_domain))).slice(0, 5),
    is_read: digest.is_read,
    is_starred: digest.is_starred,
    items: (items ?? []).map(toItemSummary),
  }
}

function toItemSummary(i: Record<string, unknown>): ItemSummary {
  return {
    id: i.id as string,
    url: i.url as string,
    title: i.title as string,
    source_domain: i.source_domain as string,
    published_at: (i.published_at as string) ?? null,
    discovered_at: i.discovered_at as string,
    discovery_type: i.discovery_type as ItemSummary['discovery_type'],
    fulltext_status: i.fulltext_status as ItemSummary['fulltext_status'],
    fetch_tier: (i.fetch_tier as ItemSummary['fetch_tier']) ?? null,
    fetch_error: (i.fetch_error as string) ?? null,
    rss_summary: (i.rss_summary as string) ?? null,
    image_count: (i.image_count as number) ?? 0,
    is_starred: (i.is_starred as boolean) ?? false,
  }
}

// ── 单条全文 ─────────────────────────────────────────────
export async function getItemFulltext(id: string) {
  const { data: item } = await db().from('items').select('*').eq('id', id).maybeSingle()
  if (!item) return null

  const [{ data: keyword }, { data: digest }] = await Promise.all([
    db()
      .from('keywords')
      .select('slug,name,retention_days')
      .eq('id', item.keyword_id)
      .maybeSingle(),
    item.digest_id
      ? db().from('digests').select('id,digest_date').eq('id', item.digest_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  let markdown: string | null = null
  if (item.fulltext_status === 'ok' && item.fulltext_key) {
    const raw = await readFulltext(item.fulltext_key)
    // 占位符换成当次有效的签名 URL，前端拿到就能直接渲染
    markdown = raw ? await resolveImagePlaceholders(raw, item.images ?? []) : null
  }

  return {
    ...toItemSummary(item),
    markdown,
    keyword: keyword ?? { slug: '', name: '', retention_days: 90 },
    digest: digest ?? null,
  }
}

/**
 * 【完整稿】当天所有条目的存档正文，一次取齐。
 *
 * 这是无 AI 模式下的主要阅读界面 —— 没有模型提炼的要点，价值就落在
 * 「能一口气读完当天抓到的全文」上，而不是逐条点进去。
 */
export async function getDayFulltext(slug: string, date: string) {
  const detail = await getDigestDetail(slug, date)
  if (!detail) return null

  const { data: rows } = await db()
    .from('items')
    .select('id,fulltext_key,fulltext_status,images')
    .eq('digest_id', detail.id)

  const byId = new Map((rows ?? []).map((r) => [r.id, r]))

  const articles = await Promise.all(
    detail.items.map(async (item) => {
      const row = byId.get(item.id)
      let markdown: string | null = null
      if (row?.fulltext_status === 'ok' && row.fulltext_key) {
        const raw = await readFulltext(row.fulltext_key)
        markdown = raw ? await resolveImagePlaceholders(raw, row.images ?? []) : null
      }
      return { item, markdown }
    }),
  )

  return { digest: detail, articles }
}

// ── 运行记录 ─────────────────────────────────────────────
export async function listRuns(days = 30): Promise<RunRecord[]> {
  const since = new Date(Date.now() - days * 86400_000).toISOString()
  const { data: runs } = await db()
    .from('runs')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(100)
  if (!runs?.length) return []

  const { data: keywords } = await db().from('keywords').select('id,slug,name')
  const kw = new Map((keywords ?? []).map((k) => [k.id, k]))

  return runs.map((r) => {
    const k = kw.get(r.keyword_id)
    return applyStaleRule({
      ...r,
      keyword_slug: k?.slug ?? '',
      keyword_name: k?.name ?? '(已删除)',
    }) as RunRecord
  })
}

/** 单条运行记录。「立即采集」的轮询用（接口 17）。 */
export async function getRun(id: string): Promise<RunRecord | null> {
  const { data: run } = await db().from('runs').select('*').eq('id', id).maybeSingle()
  if (!run) return null

  const { data: k } = await db()
    .from('keywords')
    .select('slug,name')
    .eq('id', run.keyword_id)
    .maybeSingle()

  return applyStaleRule({
    ...run,
    keyword_slug: k?.slug ?? '',
    keyword_name: k?.name ?? '(已删除)',
  }) as RunRecord
}

// ── 到期提醒 ─────────────────────────────────────────────
/**
 * 即将被保留策略清理的条目，按关键词分组。
 *
 * 【判定规则必须与 worker/db.py 的 expired_items() 完全一致】，否则这里提醒的
 * 和 cleanup 实际删的不是同一批，提醒就是错的。那边的四个条件：
 *   1. fulltext_status = 'ok'（pending/failed/skipped/purged 都没有对象可删）
 *   2. items.is_starred = false
 *   3. 所属 digest 也未收藏（§8.2：收藏豁免一切清理，简报级同样生效）
 *   4. (now - discovered_at).days >= keyword.retention_days
 *
 * 第 4 条那边用的是 Python timedelta.days（向下取整），这里用 Math.floor
 * 对齐；now 都取用户时区（§4.4）。
 *
 * 和那边一样在应用层过滤而不是写 SQL —— PostgREST 表达不了「join keywords
 * 拿 retention_days 再比日期」，且这个量级的数据拉回来算完全够用。
 */
export async function listExpiringItems(withinDays: number): Promise<ExpiringGroup[]> {
  const { data: rows } = await db()
    .from('items')
    .select('id,title,url,source_domain,discovered_at,image_count,digest_id,keyword_id')
    .eq('fulltext_status', 'ok')
    .eq('is_starred', false)
    .order('discovered_at')

  if (!rows?.length) return []

  const { data: keywords } = await db()
    .from('keywords')
    .select('id,slug,name,retention_days')
  const kw = new Map((keywords ?? []).map((k) => [k.id as string, k]))

  // 所属简报被收藏的条目要排除（条件 3）
  const digestIds = [...new Set(rows.map((r) => r.digest_id).filter(Boolean))] as string[]
  let starredDigests = new Set<string>()
  if (digestIds.length) {
    const { data: starred } = await db()
      .from('digests')
      .select('id')
      .in('id', digestIds)
      .eq('is_starred', true)
    starredDigests = new Set((starred ?? []).map((d) => d.id as string))
  }

  const { data: digestDates } = digestIds.length
    ? await db().from('digests').select('id,digest_date').in('id', digestIds)
    : { data: [] }
  const digestDate = new Map(
    (digestDates ?? []).map((d) => [d.id as string, d.digest_date as string]),
  )

  const now = Date.now()
  const groups = new Map<string, ExpiringGroup>()

  for (const r of rows) {
    const k = kw.get(r.keyword_id)
    if (!k) continue
    if (r.digest_id && starredDigests.has(r.digest_id)) continue

    const ageDays = Math.floor((now - new Date(r.discovered_at).getTime()) / 86400_000)
    const daysLeft = k.retention_days - ageDays
    if (daysLeft > withinDays) continue

    let g = groups.get(k.slug)
    if (!g) {
      g = { keyword: { slug: k.slug, name: k.name }, items: [] }
      groups.set(k.slug, g)
    }
    g.items.push({
      id: r.id,
      title: r.title,
      url: r.url,
      source_domain: r.source_domain,
      discovered_at: r.discovered_at,
      days_left: daysLeft,
      image_count: r.image_count ?? 0,
      keyword: { slug: k.slug, name: k.name, retention_days: k.retention_days },
      digest: r.digest_id
        ? { id: r.digest_id, digest_date: digestDate.get(r.digest_id) ?? '' }
        : null,
    })
  }

  // 最紧急的排前面
  for (const g of groups.values()) g.items.sort((a, b) => a.days_left - b.days_left)
  return [...groups.values()].sort(
    (a, b) => (a.items[0]?.days_left ?? 0) - (b.items[0]?.days_left ?? 0),
  )
}
