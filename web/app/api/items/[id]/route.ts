import { db } from '@/lib/supabase'
import { apiError, guard, ok, readJson } from '@/lib/http'

export const dynamic = 'force-dynamic'

/**
 * 14. PATCH /api/items/:id —— 条目收藏。
 *
 * 收藏在这个系统里不只是书签，它**豁免一切自动清理**（§8.2）——
 * 到期提醒里的「保留」按钮走的就是这个接口。
 *
 * 代价是收藏的内容会永久累积、不再释放存储，所以不该无差别地全收藏。
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await params

    const body = await readJson(req)
    if (!body) return apiError('VALIDATION_ERROR', '请求体不是合法的 JSON')
    if (typeof body.is_starred !== 'boolean') {
      return apiError('VALIDATION_ERROR', 'is_starred 必须是 true / false')
    }

    const { data, error } = await db()
      .from('items')
      .update({ is_starred: body.is_starred })
      .eq('id', id)
      .select('id,is_starred')
      .maybeSingle()

    if (error) {
      console.error('[api] 更新条目失败', error)
      return apiError('INTERNAL', '写入失败')
    }
    if (!data) return apiError('NOT_FOUND', '条目不存在')

    return ok(data)
  })
}
