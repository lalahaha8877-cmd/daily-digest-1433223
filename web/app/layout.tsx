import type { Metadata } from 'next'
import { LanguageProvider, LanguageToggle } from '@/components/LanguageProvider'
import { getLocale } from '@/lib/i18n-server'
import './globals.css'

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale()
  return {
    title: locale === 'en' ? 'Daily News' : '每日消息',
    description: locale === 'en' ? 'Keyword-based news subscriptions' : '关键词订阅式资讯采集',
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  return (
    <html lang={locale}>
      <body>
        <LanguageProvider locale={locale}>
          <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 16px 64px' }}>
            <LanguageToggle />
            {children}
          </div>
        </LanguageProvider>
      </body>
    </html>
  )
}
