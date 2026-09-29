'use server'

import { cookies } from 'next/headers'
import { LOCALE_COOKIE, normalizeLocale, type Locale } from '@/lib/i18n'

export async function setLanguage(locale: Locale) {
  const store = await cookies()
  store.set(LOCALE_COOKIE, normalizeLocale(locale), {
    path: '/',
    maxAge: 31536000,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  })
}
