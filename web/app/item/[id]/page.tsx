import { getTranslation } from '@/lib/i18n-server'
import { notFound } from 'next/navigation'
import { getItemFulltext } from '@/lib/queries'
import MarkdownView from '@/components/MarkdownView'
import { BackLink, cleanDomain, relativeTime } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslation()

  const { id } = await params
  const item = await getItemFulltext(id)
  if (!item) notFound()

  const backHref = item.digest
    ? `/k/${item.keyword.slug}/${item.digest.digest_date}`
    : `/k/${item.keyword.slug}`

  return (
    <main>
      <div style={{ padding: '20px 0 4px' }}>
        <BackLink href={backHref}>{t("返回简报")}</BackLink>
      </div>

      <header
        style={{
          padding: '4px 0 18px',
          borderBottom: '1px solid var(--border)',
          marginBottom: 28,
        }}
      >
        <h1 style={{ fontSize: 23, fontWeight: 600, margin: '0 0 8px', textWrap: 'balance' }}>
          {item.title}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: 0 }}>
          {cleanDomain(item.source_domain)}
          {item.published_at && t(" · 发布于 {0}", relativeTime(item.published_at, t))}
          {t(" · 存档于 {0}", relativeTime(item.discovered_at, t))}
          {item.fetch_tier && t(" · 抓取方式 {0}", item.fetch_tier)}
          {'  '}
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            {t("查看原文 ↗")}
          </a>
        </p>
      </header>

      {item.markdown ? (
        <div className="reading">
          <MarkdownView>{item.markdown}</MarkdownView>
        </div>
      ) : (
        <UnavailableNotice item={item} />
      )}

      <footer
        style={{
          marginTop: 40,
          paddingTop: 16,
          borderTop: '1px solid var(--border)',
          fontSize: 12.5,
          color: 'var(--text-subtle)',
        }}
      >
        {t("本页为个人阅读存档（含文字与配图），版权归原作者所有。请以")}<a href={item.url} target="_blank" rel="noopener noreferrer">
          {t("原文")}
        </a>
        {t("为准。")}
      </footer>
    </main>
  )
}

async function UnavailableNotice({
  item,
}: {
  item: Awaited<ReturnType<typeof getItemFulltext>>
}) {
  const t = await getTranslation()

  if (!item) return null

  const messages: Record<string, string> = {
    purged: t("这篇的存档已按保留策略（{0} 天）清理{1}", item.keyword.retention_days, item.image_count > 0 ? t("（含 {0} 张配图）", item.image_count) : ''),
    failed: t("抓取失败{0}", item.fetch_error ? `：${item.fetch_error}` : ''),
    skipped: t("该来源不允许抓取全文"),
    pending: t("正在处理中，稍后刷新看看"),
  }

  return (
    <div style={{ textAlign: 'center', padding: '48px 20px' }}>
      <p style={{ color: 'var(--text)', margin: '0 0 10px' }}>
        {messages[item.fulltext_status] ?? t("没有可显示的存档")}
      </p>
      <p style={{ margin: '0 0 20px' }}>
        <a href={item.url} target="_blank" rel="noopener noreferrer">
          {t("查看原文 ↗")}
        </a>
      </p>

      {item.rss_summary && (
        <blockquote
          style={{
            textAlign: 'left',
            maxWidth: 600,
            margin: '0 auto',
            borderLeft: '3px solid var(--border-strong)',
            paddingLeft: 14,
            color: 'var(--text-muted)',
            fontSize: 14,
          }}
        >
          <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--text-subtle)' }}>
            {t("来源摘要")}
          </p>
          {item.rss_summary}
        </blockquote>
      )}
    </div>
  )
}
