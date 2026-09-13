import { NextResponse } from 'next/server'

/**
 * Route Handler 的统一响应工具。对应后端需求文档 §6.1。
 *
 * 错误响应一律 `{ "error": { "code": ..., "message": ... } }`，
 * 前端的 lib/api.ts 按这个形状解析，两边不得单方面改。
 */
export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL'

const STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  INTERNAL: 500,
}

export function apiError(code: ErrorCode, message: string) {
  return NextResponse.json({ error: { code, message } }, { status: STATUS[code] })
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status })
}

/**
 * 把 Route Handler 包一层，未捕获异常统一转成 500 而不是 Next 的默认错误页。
 *
 * 不把原始 message 透给前端 —— 里面可能带着连接串或键名。日志留在服务端。
 */
export async function guard<T>(fn: () => Promise<T>): Promise<T | NextResponse> {
  try {
    return await fn()
  } catch (e) {
    console.error('[api] 未捕获异常', e)
    return apiError('INTERNAL', '服务器内部错误')
  }
}

/** 解析请求体。非法 JSON 返回 null，由调用方转成 VALIDATION_ERROR。 */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null
  } catch {
    return null
  }
}
