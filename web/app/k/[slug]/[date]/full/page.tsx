import { getTranslation } from '@/lib/i18n-server'
import { notFound } from 'next/navigation'
import { getDayFulltext } from '@/lib/queries'
import MarkdownView from '@/components/MarkdownView'
import { BackLink, cleanDomain, formatDigestDate, relativeTime } from '@/components/ui'

export const dynamic = 'force-dynamic'

/**
 * 完整稿 —— 当天所有条目的存档正文，按顺序铺在一页里。
 *
 * 这是**没有 AI 提炼时的主要阅读界面**：模型关掉后，简报的要点退化成文章
 * 标题，价值就落在「能一口气读完当天抓到的全文」上，而不是逐条点进去。
 * 正文是本站存档的版本（含配图），所以原站失效、限流或屏蔽都不影响阅读。
 */
export default async function FullTextPage({
  params,
}: {
  params: Promise<{ slug: string; date: string }>
}) {
  const t = await getTranslation()

  const { slug, date } = await params
  const data = await getDayFulltext(slug, date)
  if (!data) notFound()

  const { digest, articles } = data
  const readable = articles.filter((a) => a.markdown)
  const unreadable = articles.filter((a) => !a.markdown)

  return (
    <main>
      <div style={{ padding: '20px 0 4px' }}>
        <BackLink href={`/k/${slug}/${date}`}>{t("返回简报")}</BackLink>
      </div>

      <header
        style={{
          padding: '4px 0 18px',
          borderBottom: '1px solid var(--border)',
          marginBottom: 28,
        }}
      >
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 6px' }}>
          {formatDigestDate(digest.digest_date, t)} {t("· 完整稿")}</p>
        <h1 style={{ fontSize: 25, fontWeight: 600, margin: '0 0 8px', textWrap: 'balance' }}>
          {digest.title}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: 0 }}>
          {t("共")}{articles.length} {t("篇，其中")}{readable.length} {t("篇有存档全文")}{unreadable.length > 0 && t(" · {0} 篇只有标题", unreadable.length)}
        </p>
      </header>

      {/* 目录：篇数多时能快速跳转 */}
      {readable.length > 2 && (
        <nav
          aria-label={t("本页目录")}
          style={{
            background: 'var(--surface-sunken)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '12px 16px',
            marginBottom: 32,
          }}
        >
          <p
            style={{
              margin: '0 0 8px',
              fontSize: 12,
              color: 'var(--text-subtle)',
              letterSpacing: '.06em',
            }}
          >
            {t("本页目录")}
          </p>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
            {readable.map(({ item }) => (
              <li key={item.id} style={{ marginBottom: 4 }}>
                <a href={`#a-${item.id}`}>{item.title}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {readable.map(({ item, markdown }, idx) => (
        <article
          key={item.id}
          id={`a-${item.id}`}
          style={{
            paddingBottom: 36,
            marginBottom: 36,
            borderBottom:
              idx === readable.length - 1 ? 'none' : '1px solid var(--border)',
            scrollMarginTop: 16,
          }}
        >
          <h2 style={{ fontSize: 21, fontWeight: 600, margin: '0 0 6px', textWrap: 'balance' }}>
            {item.title}
          </h2>

          <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: '0 0 20px' }}>
            {cleanDomain(item.source_domain)}
            {item.published_at && t(" · 发布于 {0}", relativeTime(item.published_at, t))}
            {item.image_count > 0 && t(" · {0} 张配图", item.image_count)}
            {'  '}
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              {t("查看原文 ↗")}
            </a>
          </p>

          <div className="reading">
            <MarkdownView>{markdown as string}</MarkdownView>
          </div>
        </article>
      ))}

      {unreadable.length > 0 && (
        <section
          style={{
            background: 'var(--surface-sunken)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '14px 16px',
          }}
        >
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>
            {t("以下")}{unreadable.length} {t("篇没有存档全文")}</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
            {t("多半是付费墙或源站不允许抓取。标题和链接仍然保留。")}
          </p>
          {unreadable.map(({ item }) => (
            <p key={item.id} style={{ margin: '0 0 8px', fontSize: 14 }}>
              {item.title}
              <br />
              <span style={{ fontSize: 13, color: 'var(--text-subtle)' }}>
                {cleanDomain(item.source_domain)}{' '}
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  {t("原文 ↗")}
                </a>
              </span>
            </p>
          ))}
        </section>
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
        {t("本页为个人阅读存档（含文字与配图），版权归原作者所有。请以各篇原文为准。")}
      </footer>
    </main>
  )
}
