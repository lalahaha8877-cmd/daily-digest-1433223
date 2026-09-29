import { getTranslation } from '@/lib/i18n-server'
import { notFound } from 'next/navigation'
import DeleteKeyword from '@/components/DeleteKeyword'
import KeywordForm from '@/components/KeywordForm'
import { BackLink } from '@/components/ui'
import { getKeywordDetail } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export default async function KeywordSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const t = await getTranslation()

  const { slug } = await params
  const keyword = await getKeywordDetail(slug)
  if (!keyword) notFound()

  return (
    <main style={{ maxWidth: 640 }}>
      <div style={{ padding: '20px 0 4px' }}>
        <BackLink href={`/k/${slug}`}>{keyword.name}</BackLink>
      </div>

      <h1 style={{ fontSize: 28, fontWeight: 600, margin: '8px 0 6px', lineHeight: 1.3 }}>
        {t("关键词设置")}</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 28px' }}>
        {t("网址标识")}<code style={{ fontFamily: 'var(--font-mono)' }}>{keyword.slug}</code> {t("不可修改 —— 改了会让已有链接失效")}
      </p>

      <KeywordForm mode="edit" initial={keyword} />

      <DeleteKeyword
        slug={keyword.slug}
        name={keyword.name}
        digestCount={keyword.total_digests}
      />
    </main>
  )
}
