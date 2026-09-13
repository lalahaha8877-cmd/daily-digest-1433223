'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ApiError, apiSend } from '@/lib/api'
import { Button, Input, Modal } from '@/components/form'

/**
 * 设置页底部的危险区。对应前端需求文档 §5.8。
 *
 * 要求输入关键词名称才能确认，并在模态里写清会连带删掉多少东西 ——
 * 删除是级联的（简报、条目、全文归档、配图、导出文件一起没），且不可恢复。
 */
export default function DeleteKeyword({
  slug,
  name,
  digestCount,
}: {
  slug: string
  name: string
  digestCount: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await apiSend<{ ok: boolean; deleted_objects: number }>(
        `/api/keywords/${slug}`,
        'DELETE',
      )
      router.push('/')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败，请重试')
      setBusy(false)
    }
  }

  return (
    <section
      style={{
        marginTop: 40,
        border: '1px solid var(--danger)',
        borderRadius: 10,
        padding: 16,
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 6px', color: 'var(--danger)' }}>
        危险区
      </h2>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 14px' }}>
        删除这个关键词会连带删掉它的全部简报、条目、全文归档和配图，无法恢复。
        只是暂时不想收内容的话，用上面的「启用」开关停用即可。
      </p>
      <Button variant="danger" onClick={() => setOpen(true)}>
        删除关键词
      </Button>

      <Modal open={open} title={`删除「${name}」`} onClose={() => !busy && setOpen(false)}>
        <p style={{ fontSize: 14, lineHeight: 1.7, margin: '0 0 14px' }}>
          会同时删除 <strong>{digestCount}</strong> 篇简报，以及它们名下的全部条目、
          全文归档和配图。<strong style={{ color: 'var(--danger)' }}>此操作无法恢复。</strong>
        </p>
        <p style={{ fontSize: 14, margin: '0 0 8px' }}>
          输入关键词名称 <code style={{ fontFamily: 'var(--font-mono)' }}>{name}</code> 以确认：
        </p>
        <Input value={typed} onChange={setTyped} placeholder={name} />

        {error && (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, margin: '10px 0 0' }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <Button
            variant="danger"
            loading={busy}
            disabled={typed.trim() !== name}
            onClick={confirm}
          >
            永久删除
          </Button>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            取消
          </Button>
        </div>
      </Modal>
    </section>
  )
}
