import { NextResponse } from 'next/server'
import { SESSION_COOKIE, checkPassword, mintSession } from '@/lib/auth'

/** 同 IP 每 15 分钟最多 10 次（§6.3 第 1 条）。进程内计数，够单用户场景用。 */
const WINDOW_MS = 15 * 60_000
const MAX_ATTEMPTS = 10
const attempts = new Map<string, { count: number; resetAt: number }>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const rec = attempts.get(ip)
  if (!rec || now > rec.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  rec.count += 1
  return rec.count > MAX_ATTEMPTS
}

export async function POST(req: Request) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'

  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: '尝试太频繁，请 15 分钟后再试' } },
      { status: 429 },
    )
  }

  let password = ''
  try {
    password = (await req.json())?.password ?? ''
  } catch {
    // 空 body 当作空口令处理，走下面的失败分支
  }

  if (!password || !checkPassword(password)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: '口令不对' } },
      { status: 401 },
    )
  }

  const { value, maxAge } = await mintSession()
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  })
  return res
}
