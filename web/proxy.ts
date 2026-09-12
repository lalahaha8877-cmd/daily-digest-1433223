import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/auth'

/**
 * 整站口令保护。对应后端需求文档 §6.4。
 * 页面路由未登录 → 302 /login?next=<原路径>；/api/* → 401 JSON。
 *
 * 文件名是 proxy.ts 而非 middleware.ts：Next.js 16 已把 middleware 约定
 * 重命名为 proxy，且两者运行时不同 —— 旧名沿用 Edge 运行时（构建产物落在
 * server/edge/chunks/ 并套 edge-wrapper），新名默认 Node.js 运行时。
 * 部署到 Vercel 后 Edge 版本以 MIDDLEWARE_INVOCATION_FAILED 崩溃，改名后
 * 才跑通。函数名也必须同步改成 proxy，否则 Next 找不到入口。
 */
const PUBLIC_PATHS = ['/login', '/api/auth/login']

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  const res = NextResponse.next()
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return res
  }

  const ok = await verifySession(req.cookies.get(SESSION_COOKIE)?.value)
  if (ok) return res

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: '未登录' } },
      { status: 401 },
    )
  }

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = `?next=${encodeURIComponent(pathname)}`
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
