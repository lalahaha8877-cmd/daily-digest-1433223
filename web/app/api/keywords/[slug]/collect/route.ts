import { db } from '@/lib/supabase'
import { apiError, guard, ok } from '@/lib/http'
import { todayInUserTz } from '@/lib/date'

export const dynamic = 'force-dynamic'

/** 5 分钟内已有进行中的 run 就不再触发（§6.3 第 8 条）。 */
const COOLDOWN_MINUTES = 5

/**
 * 8. POST /api/keywords/:slug/collect —— 立即采集一次。
 *
 * 实现见后端需求文档 §5.2：A 先建一条 queued 的 run，把 run_id 传给
 * GitHub Actions，Worker 用 --run-id 接管它（而不是自己走 claim_run）。
 * 这样前端有个确定的 id 可以轮询，不用去猜 Worker 建了哪条记录。
 *
 * 带 --force：手动触发的语义就是「不管今天跑没跑过，现在再跑一次」。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return guard(async () => {
    const { slug } = await params

    const token = process.env.GITHUB_DISPATCH_TOKEN
    const repo = process.env.GITHUB_REPO
    if (!token || !repo) {
      return apiError(
        'UPSTREAM_ERROR',
        '未配置 GITHUB_DISPATCH_TOKEN / GITHUB_REPO，无法触发采集',
      )
    }

    const { data: keyword } = await db()
      .from('keywords')
      .select('id,enabled')
      .eq('slug', slug)
      .maybeSingle()
    if (!keyword) return apiError('NOT_FOUND', '关键词不存在')
    if (!keyword.enabled) return apiError('VALIDATION_ERROR', '关键词已停用，请先在设置里启用')

    const since = new Date(Date.now() - COOLDOWN_MINUTES * 60_000).toISOString()
    const { data: active } = await db()
      .from('runs')
      .select('id')
      .eq('keyword_id', keyword.id)
      .in('status', ['queued', 'running'])
      .gte('created_at', since)
      .limit(1)
    if (active?.length) return apiError('CONFLICT', '正在采集中，请稍候')

    const { data: run, error } = await db()
      .from('runs')
      .insert({
        keyword_id: keyword.id,
        run_date: todayInUserTz(),
        trigger: 'manual',
        status: 'queued',
      })
      .select('id')
      .single()

    if (error || !run) {
      // 同日部分唯一索引会拦住「当天已有 queued/running/ok/no_update」的情况。
      // 这不是错误，是幂等生效 —— 换成 409 让前端提示「今天已经跑过」。
      if (error?.code === '23505') {
        return apiError('CONFLICT', '今天已经采集过了，明天早上会自动再跑一次')
      }
      console.error('[api] 建 run 失败', error)
      return apiError('INTERNAL', '无法创建运行记录')
    }

    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/collect.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: process.env.GITHUB_REF || 'main',
          // inputs 的值必须是字符串/布尔/数字，不能是别的类型（§5.2）
          inputs: { keyword_slug: slug, run_id: run.id, force: 'true' },
        }),
      },
    ).catch(() => null)

    // 成功是 204 No Content，没有响应体
    if (!res || !res.ok) {
      const detail = res ? `${res.status} ${await res.text().catch(() => '')}`.slice(0, 200) : '网络失败'
      console.error('[api] GitHub dispatch 失败', detail)
      await db()
        .from('runs')
        .update({
          status: 'failed',
          error_code: 'DISPATCH_FAILED',
          error_message: detail,
          finished_at: new Date().toISOString(),
        })
        .eq('id', run.id)
      return apiError('UPSTREAM_ERROR', '触发 GitHub Actions 失败，请稍后重试')
    }

    return ok({ run_id: run.id }, 202)
  })
}
