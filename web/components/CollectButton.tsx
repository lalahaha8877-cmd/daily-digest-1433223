'use client'

import { useTranslation } from '@/components/LanguageProvider'


import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, apiGet, apiSend } from '@/lib/api'
import { Button } from '@/components/form'
import type { RunRecord } from '@/lib/types'

/**
 * 「立即采集一次」。对应前端需求文档 §6.3 的轮询规格。
 *
 * 触发的是 GitHub Actions，不是本地任务 —— 从点下去到 Worker 真正开始跑，
 * 中间隔着 Actions 的排队和约 1 分钟的环境准备（装依赖、装浏览器），
 * 所以「已排队」这个中间态会停留一会儿，是正常的。
 */

const POLL_MS = 3000
const MAX_POLLS = 100 // 3s × 100 = 5 分钟

type Phase = 'idle' | 'queued' | 'running'
type Note = { kind: 'ok' | 'info' | 'danger'; text: string; values?: Array<string | number>; showStatusLink?: boolean } | null

export default function CollectButton({ slug, disabled }: { slug: string; disabled?: boolean }) {
  const t = useTranslation()

  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('idle')
  const [note, setNote] = useState<Note>(null)

  // 卸载后不得再 setState，也不得再排下一次轮询
  const alive = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runId = useRef<string | null>(null)
  const polls = useRef(0)

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    runId.current = null
    setPhase('idle')
  }, [])

  const poll = useCallback(async function pollRun() {
    if (!alive.current || !runId.current) return

    // 页面在后台时不发请求，等回到前台由 visibilitychange 立刻补一次
    if (document.hidden) {
      timer.current = setTimeout(pollRun, POLL_MS)
      return
    }

    if (polls.current >= MAX_POLLS) {
      setNote({ kind: 'info', text: "还在跑，稍后到运行状态页查看结果", showStatusLink: true })
      stop()
      return
    }
    polls.current += 1

    let run: RunRecord
    try {
      run = await apiGet<RunRecord>(`/api/runs/${runId.current}`)
    } catch {
      // 单次轮询失败（网络抖动）不该中断整个流程，下一轮继续
      timer.current = setTimeout(pollRun, POLL_MS)
      return
    }
    if (!alive.current) return

    switch (run.status) {
      case 'queued':
        setPhase('queued')
        timer.current = setTimeout(pollRun, POLL_MS)
        return
      case 'running':
        setPhase('running')
        timer.current = setTimeout(pollRun, POLL_MS)
        return
      case 'ok':
        setNote({ kind: 'ok', text: "已更新，新增 {0} 条", values: [run.items_new] })
        stop()
        router.refresh()
        return
      case 'no_update':
        setNote({ kind: 'info', text: "今天没有新内容" })
        stop()
        router.refresh()
        return
      case 'failed':
        setNote({
          kind: 'danger',
          text: "采集失败：{0}", values: [run.error_message || run.error_code || "未知原因"],
          showStatusLink: true,
        })
        stop()
        return
    }
  }, [router, stop])

  useEffect(() => {
    alive.current = true
    const onVisible = () => {
      if (!document.hidden && runId.current) {
        if (timer.current) clearTimeout(timer.current)
        poll()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive.current = false
      document.removeEventListener('visibilitychange', onVisible)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [poll])

  async function start() {
    setNote(null)
    setPhase('queued')
    polls.current = 0
    try {
      const { run_id } = await apiSend<{ run_id: string }>(
        `/api/keywords/${slug}/collect`,
        'POST',
      )
      runId.current = run_id
      timer.current = setTimeout(poll, POLL_MS)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "触发失败，请稍后重试"
      setNote({ kind: err instanceof ApiError && err.code === 'CONFLICT' ? 'info' : 'danger', text: msg })
      setPhase('idle')
    }
  }

  const label =
    phase === 'queued' ? t("已排队") : phase === 'running' ? t("采集中…") : t("立即采集")

  const COLOR = { ok: 'var(--ok)', info: 'var(--text-muted)', danger: 'var(--danger)' } as const

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <Button
        variant="primary"
        size="sm"
        loading={phase !== 'idle'}
        disabled={disabled}
        onClick={start}
        title={disabled ? t("关键词已停用，请先在设置里启用") : undefined}
      >
        {label}
      </Button>

      {note && (
        <span
          role={note.kind === 'danger' ? 'alert' : 'status'}
          style={{ fontSize: 13, color: COLOR[note.kind] }}
        >
          {t(note.text, ...(note.values ?? []).map((value) => typeof value === 'string' ? t(value) : value))}
          {note.showStatusLink && (
            <>
              {' '}
              <Link href="/status">{t("查看运行状态")}</Link>
            </>
          )}
        </span>
      )}
    </div>
  )
}
