import KeywordForm from '@/components/KeywordForm'
import { BackLink } from '@/components/ui'

export const metadata = { title: '新建关键词 · 每日消息' }

export default function NewKeywordPage() {
  return (
    <main style={{ maxWidth: 640 }}>
      <div style={{ padding: '20px 0 4px' }}>
        <BackLink href="/">关键词</BackLink>
      </div>

      <h1 style={{ fontSize: 28, fontWeight: 600, margin: '8px 0 6px', lineHeight: 1.3 }}>
        新建关键词
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 28px' }}>
        建好之后每天早上 8 点自动采集一次。想马上看效果，进关键词页点「立即采集」。
      </p>

      <KeywordForm mode="create" />
    </main>
  )
}
