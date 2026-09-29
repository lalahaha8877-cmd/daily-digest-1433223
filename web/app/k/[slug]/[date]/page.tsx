import { getTranslation } from '@/lib/i18n-server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDigestDetail } from '@/lib/queries'
import MarkdownView from '@/components/MarkdownView'
import { BackLink, cleanDomain, formatDigestDate, relativeTime } from '@/components/ui'
import type { ItemSummary } from '@/lib/types'

export const dynamic = 'force-dynamic'

const FULLTEXT_LABEL: Record<ItemSummary['fulltext_status'], string> = {
  ok: '已存档',
  pending: '处理中',
  purged: '已按保留策略清理',
  failed: '抓取失败',
  skipped: '未抓取（源站不允许）',
}

export default async function DigestPage({
  params,
}: {
  params: Promise<{ slug: string; date: string }>
}) {
  const t = await getTranslation()

  const { slug, date } = await params
  const digest = await getDigestDetail(slug, date)
  if (!digest) notFound()

  const readable = digest.items.filter((i) => i.fulltext_status === 'ok').length

  return (
    <main style={{ maxWidth: 720 }}>
      <div style={{ padding: '20px 0 4px' }}>
        <BackLink href={`/k/${slug}`}>{t("返回时间线")}</BackLink>
      </div>

      <header style={{ padding: '4px 0 16px' }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 6px' }}>
          {formatDigestDate(digest.digest_date, t)}
        </p>
        <h1 style={{ fontSize: 25, fontWeight: 600, margin: 0, textWrap: 'balance' }}>
          {digest.title}
        </h1>
      </header>

      {digest.summary_md && (
        <div style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
          <MarkdownView>{digest.summary_md}</MarkdownView>
        </div>
      )}

      {/* 完整稿入口：无 AI 提炼时这是主要的阅读方式，所以放在要点之前 */}
      {readable > 0 && (
        <Link
          href={`/k/${slug}/${date}/full`}
          style={{
            display: 'block',
            textDecoration: 'none',
            border: '1px solid var(--accent)',
            background: 'var(--accent-subtle)',
            borderRadius: 10,
            padding: '12px 14px',
            marginBottom: 24,
          }}
        >
          <span style={{ fontWeight: 600, color: 'var(--accent)' }}>
            {t("读完整稿（")}{readable} {t("篇全文）→")}
          </span>
          <span
            style={{
              display: 'block',
              fontSize: 13,
              color: 'var(--text-muted)',
              marginTop: 2,
            }}
          >
            {t("把今天抓到的正文按顺序铺在一页里，不用逐条点开")}
          </span>
        </Link>
      )}

      <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 20px' }} />

      <section>
        {digest.bullets.map((b, i) => (
          <p key={i} style={{ margin: '0 0 10px' }}>
            <span style={{ color: 'var(--text-subtle)', marginRight: 8 }}>·</span>
            {b.text}
          </p>
        ))}
      </section>

      <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '24px 0 16px' }} />

      <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>
        {t("本期条目（")}{digest.items.length}）
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {digest.items.map((item, idx) => (
          <div key={item.id} id={`item-${item.id}`}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ color: 'var(--text-subtle)', fontSize: 13, flex: '0 0 auto' }}>
                [{idx + 1}]
              </span>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: '0 0 4px', fontWeight: 500 }}>{item.title}</p>

                <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--text-subtle)' }}>
                  {cleanDomain(item.source_domain)}
                  {item.published_at && ` · ${relativeTime(item.published_at, t)}`}
                  {' · '}
                  {t(FULLTEXT_LABEL[item.fulltext_status])}
                  {item.image_count > 0 &&
                    (item.fulltext_status === 'purged'
                      ? t(" · 曾含 {0} 张配图", item.image_count)
                      : t(" · {0} 张配图", item.image_count))}
                </p>

                <div style={{ display: 'flex', gap: 14, fontSize: 13 }}>
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    {t("原文 ↗")}
                  </a>
                  {item.fulltext_status === 'ok' ? (
                    <Link href={`/item/${item.id}`}>{t("存档")}</Link>
                  ) : (
                    <span
                      style={{ color: 'var(--text-subtle)' }}
                      title={t(FULLTEXT_LABEL[item.fulltext_status])}
                    >
                      {t("存档")}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
