import { english } from './translations'

export type Locale = 'zh-CN' | 'en'
export const LOCALE_COOKIE = 'daily-news-language'
export function normalizeLocale(value?: string): Locale {
  return value === 'en' ? 'en' : 'zh-CN'
}
export function createTranslator(locale: Locale) {
  return (text: string, ...values: Array<string | number>) => {
    const template = locale === 'en' ? (english[text] ?? text) : text
    return template.replace(/\{(\d+)\}/g, (match, index) => String(values[Number(index)] ?? match))
  }
}
export type Translator = ReturnType<typeof createTranslator>
