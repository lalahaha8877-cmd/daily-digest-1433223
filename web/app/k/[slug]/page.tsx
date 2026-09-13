import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getKeyword, listDigests } from '@/lib/queries'
import {
  BackLink,
  Card,
  EmptyState,
  cleanDomain,
  formatDigestDate,
} from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function TimelinePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const keyword = await getKeyword(slug)
  if (!keyword) notFound()

  const digests = await listDigests(slug, { limit: 30 })

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
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          检索词 {keyword.query} · 保留 {keyword.retention_days} 天 · 每次最多{' '}
          {keyword.max_items_per_run} 条
          {!keyword.enabled && <span style={{ color: 'var(--text-subtle)' }}> · 已停用</span>}
        </p>
      </header>

      {digests.length === 0 ? (
        <EmptyState
          title="还没有采集过"
          hint="在项目根目录跑 py -m worker.main run --keyword 这个slug --force，或者等明天早上 8 点。"
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
