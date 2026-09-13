import { guard, ok } from '@/lib/http'
import { EXPIRY_WARN_DAYS } from '@/lib/expiry'
import { listExpiringItems } from '@/lib/queries'

export const dynamic = 'force-dynamic'

const MAX_WITHIN_DAYS = 3650

/**
 * GET /api/expiring?days=7 —— 即将被保留策略清理的条目，按关键词分组。
 *
 * 【文档外新增】后端文档 §6.2 的 18 个接口里没有这一条。文档只规定了
 * 「过期即删」（§8.2）和事后告知（前端 §5.5），没有删除前的提醒。
 * 详见 shared/types.ts 文件头第 3 条。
 */
export async function GET(req: Request) {
  return guard(async () => {
    const raw = Number(new URL(req.url).searchParams.get('days'))
    const days =
      Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), MAX_WITHIN_DAYS) : EXPIRY_WARN_DAYS

    const data = await listExpiringItems(days)
    return ok({
      data,
      within_days: days,
      total: data.reduce((n, g) => n + g.items.length, 0),
    })
  })
}
