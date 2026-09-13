import Link from 'next/link'
import { notFound } from 'next/navigation'
import CollectButton from '@/components/CollectButton'
import { getKeywordDetail, listDigests } from '@/lib/queries'
import {
  BackLink,
  Card,
  EmptyState,
  StatusDot,
  cleanDomain,
  formatDigestDate,
  relativeTime,
} from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function TimelinePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const keyword = await getKeywordDetail(slug)
  if (!keyword) notFound()

  const digests = await listDigests(slug, { limit: 30 })
  const lastRun = keyword.last_run

  return (
    <main>
      <div style={{ padding: '20px 0 4px' }}>
        <BackLink href="/">关键词</BackLink>
      </div>

      <header style={{ padding: '4px 0 20px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{ fontSize: 26, fontWeight: 600, margin: '0 0 6px' }}>{keyword.name}</h1>
          <Link
            href={`/k/${slug}/settings`}
            style={{ marginLeft: 'auto', fontSize: 14, whiteSpace: 'nowrap' }}
          >
            设置
          </Link>
        </div>
        <p
          style={{
            fontSize: 13,
            color: 'var(--text-muted)',
            margin: '0 0 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {lastRun && <StatusDot status={lastRun.status} />}
          {lastRun?.finished_at && <span>{relativeTime(lastRun.finished_at)}</span>}
          <span>检索词 {keyword.query}</span>
          <span>· 保留 {keyword.retention_days} 天</span>
          <span>· 每次最多 {keyword.max_items_per_run} 条</span>
          {!keyword.enabled && <span style={{ color: 'var(--text-subtle)' }}>· 已停用</span>}
        </p>

        <CollectButton slug={slug} disabled={!keyword.enabled} />
      </header>

      {/* 失败态要单独显示原因 —— 「昨天为什么没有内容」是 V1 踩过的坑（§2.1 第 8 条） */}
      {lastRun?.status === 'failed' && (
        <div
          role="alert"
          style={{
            border: '1px solid var(--danger)',
            borderRadius: 10,
            padding: '10px 14px',
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          最近一次采集失败了
          {lastRun.run_date ? `（${lastRun.run_date}）` : ''}。{' '}
          <Link href="/status">查看运行状态</Link>
        </div>
      )}

      {digests.length === 0 ? (
        <EmptyState
          title="还没有采集过"
          hint="点上面的「立即采集」马上试一次，或者等明天早上 8 点自动跑。"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {digests.map((d) => (
            <Link
              key={d.id}
              href={`/k/${slug}/${d.digest_date}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <Card muted={d.is_read}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    color: 'var(--text-muted)',
                    marginBottom: 6,
                  }}
                >
                  <span>{formatDigestDate(d.digest_date)}</span>
                  {d.is_starred && <span aria-label="已收藏">★</span>}
                  {!d.is_read && (
                    <span
                      aria-label="未读"
                      style={{
                        marginLeft: 'auto',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: 'var(--accent)',
                      }}
                    />
                  )}
                </div>

                <h2
                  style={{
                    fontSize: 17,
                    fontWeight: 600,
                    margin: '0 0 8px',
                    color: d.is_read ? 'var(--text-muted)' : 'var(--text)',
                  }}
                >
                  {d.title}
                </h2>

                {d.preview_bullets.map((b, i) => (
                  <p
                    key={i}
                    style={{
                      margin: '0 0 4px',
                      fontSize: 14,
                      color: 'var(--text-muted)',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    · {b}
                  </p>
                ))}

                <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 8 }}>
                  {d.source_domains.slice(0, 3).map(cleanDomain).join('  ')}
                  {d.source_domains.length > 3 && ` +${d.source_domains.length - 3}`}
                  {' · '}
                  {d.item_count} 篇
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
