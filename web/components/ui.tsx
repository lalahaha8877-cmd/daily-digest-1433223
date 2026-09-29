import type { Translator } from '@/lib/i18n'
import { getTranslation } from '@/lib/i18n-server'
import Link from 'next/link'
import type { ReactNode } from 'react'
import type { RunStatus } from '@/lib/types'

/** 状态指示器：圆点 + 文字。不单独用颜色传达信息（§1.4 无障碍要求）。 */
export async function StatusDot({ status, showLabel = true }: { status: RunStatus; showLabel?: boolean }) {
  const t = await getTranslation()

  const STATUS_META: Record<RunStatus, { color: string; label: string; filled: boolean }> = {
    ok: { color: 'var(--ok)', label: t("已更新"), filled: true },
    no_update: { color: 'var(--neutral)', label: t("无更新"), filled: false },
    queued: { color: 'var(--warn)', label: t("排队中"), filled: false },
    running: { color: 'var(--warn)', label: t("采集中"), filled: true },
    failed: { color: 'var(--danger)', label: t("失败"), filled: true },
  }

  const meta = STATUS_META[status] ?? STATUS_META.no_update
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      aria-label={t("运行状态：{0}", meta.label)}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: meta.filled ? meta.color : 'transparent',
          border: `1.5px solid ${meta.color}`,
          flex: '0 0 auto',
        }}
      />
      {showLabel && <span style={{ color: 'var(--text-muted)' }}>{meta.label}</span>}
    </span>
  )
}

export async function Badge({ count }: { count: number }) {
  const t = await getTranslation()

  if (count <= 0) return null
  return (
    <span
      aria-label={t("{0} 篇未读", count)}
      style={{
        background: 'var(--accent)',
        color: '#fff',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        padding: '1px 8px',
        lineHeight: 1.6,
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

export function Card({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <div
      style={{
        background: muted ? 'transparent' : 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 16,
      }}
    >
      {children}
    </div>
  )
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div style={{ textAlign: 'center', padding: '56px 20px', color: 'var(--text-muted)' }}>
      <p style={{ fontSize: 16, color: 'var(--text)', margin: '0 0 6px' }}>{title}</p>
      {hint && <p style={{ margin: '0 0 16px', fontSize: 14 }}>{hint}</p>}
      {action}
    </div>
  )
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        fontSize: 14,
        color: 'var(--text-muted)',
        textDecoration: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
      }}
    >
      <span aria-hidden>←</span>
      {children}
    </Link>
  )
}

/** 相对时间。§7：<1分钟「刚刚」；今天 HH:mm；昨天；今年 MM-DD；跨年完整日期。 */
export function relativeTime(iso: string | null, t: Translator): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()

  if (diffMs < 60_000) return t("刚刚")
  if (diffMs < 3600_000) return t("{0} 分钟前", Math.floor(diffMs / 60_000))

  const sameDay = d.toDateString() === now.toDateString()
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (sameDay) return hhmm

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return t("昨天 {0}", hhmm)

  const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return d.getFullYear() === now.getFullYear() ? mmdd : `${d.getFullYear()}-${mmdd}`
}

/** 日期字符串（YYYY-MM-DD）→ 「09-12 周六」 */
export function formatDigestDate(date: string, t: Translator): string {
  const d = new Date(date + 'T00:00:00')
  const week = [t("周日"), t("周一"), t("周二"), t("周三"), t("周四"), t("周五"), t("周六")][d.getDay()]
  return `${date.slice(5)} ${week}`
}

export function cleanDomain(domain: string): string {
  const d = domain.replace(/^www\./, '')
  return d.length > 22 ? `${d.slice(0, 12)}…${d.slice(-8)}` : d
}
