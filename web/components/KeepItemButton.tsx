'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ApiError, apiSend } from '@/lib/api'
import { Button } from '@/components/form'

/**
 * 到期清单里的「保留」按钮。走接口 14，把条目标为收藏 ——
 * 收藏豁免一切自动清理（§8.2），这是让内容不被删掉的唯一办法。
 *
 * 乐观更新：立即翻转状态，失败再翻回来并提示（§6.2 只对收藏和标已读
 * 做乐观更新，因为它们高频且失败无害）。
 */
export default function KeepItemButton({ id }: { id: string }) {
  const router = useRouter()
  const [kept, setKept] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function keep() {
    setKept(true)
    setBusy(true)
    setFailed(false)
    try {
      await apiSend(`/api/items/${id}`, 'PATCH', { is_starred: true })
      router.refresh()
    } catch (e) {
      setKept(false)
      setFailed(true)
      console.error(e instanceof ApiError ? e.message : e)
    } finally {
      setBusy(false)
    }
  }

  if (kept) {
    return (
      <span style={{ fontSize: 13, color: 'var(--ok)', whiteSpace: 'nowrap' }}>★ 已保留</span>
    )
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Button size="sm" loading={busy} onClick={keep} title="收藏后不再被自动清理">
        保留
      </Button>
      {failed && (
        <span role="alert" style={{ fontSize: 12, color: 'var(--danger)' }}>
          失败
        </span>
      )}
    </span>
  )
}
