import { getTranslation } from '@/lib/i18n-server'
import { listRuns } from '@/lib/queries'
import { BackLink, EmptyState, StatusDot, relativeTime } from '@/components/ui'

export const dynamic = 'force-dynamic'

function duration(started: string | null, finished: string | null): string {
  if (!started || !finished) return '—'
  const ms = new Date(finished).getTime() - new Date(started).getTime()
  if (ms < 0) return '—'
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export default async function StatusPage() {
  const t = await getTranslation()

  const runs = await listRuns(30)

  return (
    <main>
      <div style={{ padding: '20px 0 4px' }}>
        <BackLink href="/">{t("关键词")}</BackLink>
      </div>

      <header style={{ padding: '4px 0 20px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: '0 0 4px' }}>{t("运行状态")}</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          {t("最近 30 天。用来回答「昨天为什么没有内容」。")}
        </p>
      </header>

      {runs.length === 0 ? (
        <EmptyState title={t("还没有运行记录")} hint={t("采集跑过一次之后这里就有数据了。")} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {runs.map((r) => (
            <div
              key={r.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '12px 14px',
                background:
                  r.status === 'failed' ? 'rgba(192,69,59,.06)' : 'var(--surface)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  marginBottom: 6,
                }}
              >
                <StatusDot status={r.status} />
                <span style={{ fontWeight: 500 }}>{r.keyword_name}</span>
                <span style={{ fontSize: 13, color: 'var(--text-subtle)' }}>
                  {r.trigger === 'manual' ? t("手动") : t("定时")} ·{' '}
                  {relativeTime(r.created_at ?? r.started_at, t)}
                </span>
              </div>

              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {t("新增")}{r.items_new} {t("· 存档")}{r.fulltext_ok}/
                {r.fulltext_ok + r.fulltext_failed} {t("· 用时")}{' '}
                {duration(r.started_at, r.finished_at)}
                {r.tokens_in + r.tokens_out > 0 &&
                  ` · tokens ${r.tokens_in + r.tokens_out}`}
              </div>

              {r.error_code && (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 13,
                    color: 'var(--danger)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {r.error_code}
                  {r.error_message ? ` — ${r.error_message.slice(0, 160)}` : ''}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
