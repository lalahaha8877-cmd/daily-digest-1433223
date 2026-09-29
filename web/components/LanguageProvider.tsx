'use client'

import { createContext, useContext, useMemo, useTransition, type ReactNode } from 'react'
import { setLanguage } from '@/app/language-actions'
import { createTranslator, type Locale } from '@/lib/i18n'

const LanguageContext = createContext<Locale>('zh-CN')

export function LanguageProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LanguageContext.Provider value={locale}>{children}</LanguageContext.Provider>
}

export function useTranslation() {
  const locale = useContext(LanguageContext)
  return useMemo(() => createTranslator(locale), [locale])
}

export function LanguageToggle() {
  const locale = useContext(LanguageContext)
  const [pending, startTransition] = useTransition()
  const next = locale === 'en' ? 'zh-CN' : 'en'
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 16 }}>
      <button
        type="button"
        className="language-toggle"
        disabled={pending}
        aria-busy={pending}
        aria-label={locale === 'en' ? 'Switch page language to Chinese' : '切换页面语言为英文'}
        onClick={() => {
          startTransition(async () => { await setLanguage(next) })
        }}
      >
        <span lang="zh-CN" style={{ fontWeight: locale === 'zh-CN' ? 700 : 400 }}>中文</span>
        <span aria-hidden="true"> / </span>
        <span lang="en" style={{ fontWeight: locale === 'en' ? 700 : 400 }}>English</span>
      </button>
    </div>
  )
}
