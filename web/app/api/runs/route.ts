import { guard, ok } from '@/lib/http'
import { listRuns } from '@/lib/queries'

export const dynamic = 'force-dynamic'

/**
 * 16. GET /api/runs —— 运行记录列表。
 *
 * 「僵死 run 呈现为 failed」的规则在 lib/queries.ts 的 applyStaleRule 里，
 * 读取时套用、不改库（§5.2 兜底）。
 */
export async function GET(req: Request) {
  return guard(async () => {
    const sp = new URL(req.url).searchParams
    const days = Number(sp.get('days')) || 30
    const keyword = sp.get('keyword')
    const status = sp.get('status')

    let runs = await listRuns(days)
    if (keyword) runs = runs.filter((r) => r.keyword_slug === keyword)
    if (status) runs = runs.filter((r) => r.status === status)

    return ok({ data: runs })
  })
}
