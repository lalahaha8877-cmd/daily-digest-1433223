import { getTranslation } from '@/lib/i18n-server'
import Link from 'next/link'
import KeepItemButton from '@/components/KeepItemButton'
import { BackLink, Card, EmptyState, cleanDomain } from '@/components/ui'
import { EXPIRY_WARN_DAYS } from '@/lib/expiry'
import { listExpiringItems } from '@/lib/queries'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const t = await getTranslation()
  return { title: t('即将到期 · 每日消息') }
}

export default async function ExpiringPage() {
  const t = await getTranslation()

  const groups = await listExpiringItems(EXPIRY_WARN_DAYS)
  const total = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <main>
      <div style={{ padding: '20px 0 4px' }}>
        <BackLink href="/">{t("关键词")}</BackLink>
      </div>

      <h1 style={{ fontSize: 28, fontWeight: 600, margin: '8px 0 6px', lineHeight: 1.3 }}>
        {t("即将到期")}</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 8px' }}>
        {t("这些条目的")}<strong>{t("存档全文和配图")}

      </strong>{t("即将按保留策略被清理。清理之后， 标题、链接和简报仍然保留，只是点「存档」会提示已清理，只能回原站看。")}</p>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 28px' }}>
        {t("点「保留」即收藏该条，之后")}<strong>{t("永不清理")}

      </strong>{t("。代价是它会一直占着存储 —— 不必要的就让它自然过期。")}</p>

      {total === 0 ? (
        <EmptyState
          title={t("未来 {0} 天内没有内容到期", EXPIRY_WARN_DAYS)}
          hint={t("有内容快到期时，首页顶部会出现提示条。")}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {groups.map((g) => (
            <section key={g.keyword.slug}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 10px' }}>
                <Link href={`/k/${g.keyword.slug}`} style={{ color: 'inherit' }}>
                  {g.keyword.name}
                </Link>
                <span
                  style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8, fontSize: 14 }}
                >
                  {g.items.length} {t("篇")}</span>
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {g.items.map((it) => (
                  <Card key={it.id}>
                    <div
                      style={{
                        display: 'flex',
                        gap: 12,
                        alignItems: 'flex-start',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                        <Link
                          href={`/item/${it.id}`}
                          style={{ color: 'inherit', textDecoration: 'none' }}
                        >
                          <p style={{ margin: '0 0 5px', fontSize: 15, fontWeight: 500 }}>
                            {it.title}
                          </p>
                        </Link>
                        <p
                          style={{
                            margin: 0,
                            fontSize: 13,
                            color: 'var(--text-muted)',
                            display: 'flex',
                            gap: 8,
                            flexWrap: 'wrap',
                          }}
                        >
                          <span>{cleanDomain(it.source_domain)}</span>
                          {it.image_count > 0 && <span>🖼 {it.image_count}</span>}
                          <span
                            style={{
                              color: it.days_left <= 0 ? 'var(--danger)' : 'var(--warn)',
                              fontWeight: 500,
                            }}
                          >
                            {it.days_left <= 0
                              ? t("已到期，下次清理时删除")
                              : t("还剩 {0} 天", it.days_left)}
                          </span>
                        </p>
                      </div>

                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <a
                          href={it.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 13, whiteSpace: 'nowrap' }}
                        >
                          {t("原文 ↗")}

                        </a>
                        <KeepItemButton id={it.id} />
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  )
}
