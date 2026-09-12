/**
 * 整站单口令保护。对应后端需求文档 §6.3 第 1 条。
 *
 * session 值 = HMAC-SHA256(SESSION_SECRET, "v1:" + exp) + "." + exp
 * 无状态、不落库；改 SESSION_SECRET 即可让所有既有会话失效。
 *
 * 本文件被 proxy.ts 引用，必须保持运行时中立：不要 import next/headers
 * 之类只能在 Server Component / Route Handler 里用的 API。
 */
const COOKIE_NAME = 'session'
const MAX_AGE = 60 * 60 * 24 * 30 // 30 天

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET 缺失或短于 32 字节')
  }
  return s
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return Buffer.from(sig).toString('base64url')
}

export async function mintSession(): Promise<{ value: string; maxAge: number }> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE
  const mac = await hmac(`v1:${exp}`)
  return { value: `${mac}.${exp}`, maxAge: MAX_AGE }
}

export async function verifySession(value: string | undefined): Promise<boolean> {
  if (!value) return false
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return false

  const mac = value.slice(0, dot)
  const exp = Number(value.slice(dot + 1))
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false

  const expected = await hmac(`v1:${exp}`)
  return timingSafeEqual(mac, expected)
}

/** 定长比较，避免按字符提前返回泄露信息。 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function checkPassword(input: string): boolean {
  const expected = process.env.APP_PASSWORD
  if (!expected) throw new Error('缺少 APP_PASSWORD 环境变量')
  return timingSafeEqual(input, expected)
}

export const SESSION_COOKIE = COOKIE_NAME
