/**
 * 客户端 fetch 封装。对应前端需求文档 §6.4。
 *
 * 两件事：把 `{error:{code,message}}` 解析成可抛的异常；遇到 401 一律跳登录。
 * Server Component 不要用这个 —— 它们直接调 lib/queries.ts，少一次自我 HTTP 往返。
 */
import type { ErrorCode } from './http'

export class ApiError extends Error {
  code: ErrorCode | 'NETWORK'
  status: number

  constructor(code: ErrorCode | 'NETWORK', message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json()
    const e = body?.error
    if (e?.code && e?.message) return new ApiError(e.code, e.message, res.status)
  } catch {
    // 响应不是 JSON（网关错误页之类），走下面的兜底
  }
  return new ApiError('INTERNAL', `请求失败（${res.status}）`, res.status)
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch {
    throw new ApiError('NETWORK', '网络连接失败，请检查网络后重试', 0)
  }

  if (res.status === 401) {
    // 会话过期。带上当前路径，登录后回到原处。
    const next = encodeURIComponent(window.location.pathname + window.location.search)
    window.location.replace(`/login?next=${next}`)
    // 跳转是异步的，这里必须抛出，否则调用方会拿着 undefined 继续往下走
    throw new ApiError('UNAUTHORIZED', '登录已过期', 401)
  }

  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const apiGet = <T>(path: string) => api<T>(path)

export const apiSend = <T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) =>
  api<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
