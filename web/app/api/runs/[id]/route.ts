import { apiError, guard, ok } from '@/lib/http'
import { getRun } from '@/lib/queries'

export const dynamic = 'force-dynamic'

/**
 * 17. GET /api/runs/:id —— 单条运行状态，供「立即采集」轮询。
 *
 * **必须带 Cache-Control: no-store**（§6.3 第 17 条）。轮询的全部意义就是
 * 看状态变化，被任何一层缓存住都会让前端一直读到 queued，直到轮询次数耗尽。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await params
    const run = await getRun(id)
    if (!run) return apiError('NOT_FOUND', '运行记录不存在')

    const res = ok(run)
    res.headers.set('Cache-Control', 'no-store')
    return res
  })
}
