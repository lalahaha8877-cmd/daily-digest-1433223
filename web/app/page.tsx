import Link from 'next/link'
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
        <Link href="/status" style={{ fontSize: 14 }}>
          运行状态
        </Link>
      </header>

      {keywords.length === 0 ? (
        <EmptyState
          title="还没有关键词"
          hint="在 Supabase 的 keywords 表里加一条，明天早上就能收到第一份简报。"
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
