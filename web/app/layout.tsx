import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '每日消息',
  description: '关键词订阅式资讯采集',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 16px 64px' }}>
          {children}
        </div>
      </body>
    </html>
  )
}
