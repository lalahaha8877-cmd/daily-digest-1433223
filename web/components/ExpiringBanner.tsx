import { getTranslation } from '@/lib/i18n-server'
import Link from 'next/link'
import { EXPIRY_WARN_DAYS } from '@/lib/expiry'
import { listExpiringItems } from '@/lib/queries'

/**
 * 首页顶部的到期提示条。
 *
 * 【文档外新增】见 shared/types.ts 文件头第 3 条：文档只做事后告知
 * （「已按保留策略清理」），删除之前没有任何提示。
 *
 * 没有即将到期的内容时整条不渲染 —— 常驻的提示条会被无视，
 * 只在真有事时出现才有人看。
 */
export default async function ExpiringBanner() {
  const t = await getTranslation()

  const groups = await listExpiringItems(EXPIRY_WARN_DAYS)
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  if (total === 0) return null

  // 最紧急的那条决定措辞：已到期的说「随时」，否则说还剩几天
  const soonest = Math.min(...groups.flatMap((g) => g.items.map((i) => i.days_left)))
  const when =
    soonest <= 0 ? t("下一次采集后就会被清理") : t("最快 {0} 天后开始清理", soonest)

  return (
    <div
      role="status"
      style={{
        border: '1px solid var(--warn)',
        background: 'var(--surface)',
        borderRadius: 10,
        padding: '11px 14px',
        marginBottom: 16,
        fontSize: 14,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
      }}
    >
      <span aria-hidden style={{ color: 'var(--warn)' }}>
        ⏳
      </span>
      <span>
        {t("有")}<strong>{total}</strong> {t("篇存档即将到期，")}{when}。
      </span>
      <Link href="/expiring" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
        {t("查看并保留 →")}

      </Link>
    </div>
  )
}
