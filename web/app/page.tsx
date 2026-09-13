import Link from 'next/link'
import ExpiringBanner from '@/components/ExpiringBanner'
import { listKeywords } from '@/lib/queries'
import { Badge, Card, EmptyState, StatusDot, cleanDomain } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const keywords = await listKeywords(true)

  return (
    <main>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          padding: '28px 0 18px',
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>关键词</h1>
        <span style={{ display: 'flex', gap: 16, fontSize: 14 }}>
          <Link href="/status">运行状态</Link>
          <Link href="/new" style={{ fontWeight: 500 }}>
            ＋ 新建
          </Link>
        </span>
      </header>

      <ExpiringBanner />

      {keywords.length === 0 ? (
        <EmptyState
          title="还没有关键词"
          hint="添加一个关键词，明天早上就能收到第一份简报。"
          action={
            <Link
              href="/new"
              style={{
                display: 'inline-block',
                background: 'var(--accent)',
                color: '#fff',
                borderRadius: 6,
                padding: '7px 14px',
                fontSize: 14,
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              新建关键词
            </Link>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {keywords.map((k) => (
            <Link
              key={k.id}
              href={`/k/${k.slug}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div style={{ opacity: k.enabled ? 1 : 0.6 }}>
                <Card>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: 6,
                    }}
                  >
                    {k.last_run && <StatusDot status={k.last_run.status} showLabel={false} />}
                    <span style={{ fontSize: 17, fontWeight: 600 }}>{k.name}</span>
                    {!k.enabled && (
                      <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>已停用</span>
                    )}
                    <span style={{ marginLeft: 'auto' }}>
                      <Badge count={k.unread_count} />
                    </span>
                  </div>

                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {k.last_digest_date
                      ? `最近 ${k.last_digest_date} · 共 ${k.total_digests} 篇简报`
                      : '还没有采集过'}
                  </div>
                </Card>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
