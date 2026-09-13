'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ApiError, apiSend } from '@/lib/api'
import { Button, Field, Input, Select, Switch } from '@/components/form'
import type { KeywordDetail, Source, SourceType } from '@/lib/types'

/**
 * 新建 / 设置共用的关键词表单。对应前端需求文档 §5.8。
 *
 * 校验只做即时反馈，真正把关的是服务端的 lib/validate.ts（§6.1：
 * 所有写操作在服务端二次校验，不信任前端）。
 */

const TYPE_OPTIONS: ReadonlyArray<{ value: SourceType; label: string }> = [
  { value: 'gnews', label: 'Google News 搜索' },
  { value: 'rss', label: 'RSS / Atom 订阅' },
  { value: 'listing', label: '文章列表页' },
  { value: 'websearch', label: 'Claude 联网搜索' },
]

const SCHEDULE_OPTIONS = [
  { value: 'daily' as const, label: '每天' },
  { value: 'weekly' as const, label: '每周一' },
  { value: 'monthly' as const, label: '每月 1 号' },
]

/** 新增一行时的默认值。gnews 排第一、也是默认 —— 它只要填检索词，不用用户自己去找 RSS 地址。 */
function blankSource(type: SourceType, query: string): Source {
  const base = { type, allow_fulltext: true }
  switch (type) {
    case 'gnews':
      return { ...base, query, hl: 'zh-CN', gl: 'CN', ceid: 'CN:zh' }
    case 'websearch':
      return { ...base, schedule: 'weekly' }
    default:
      return { ...base, url: '' }
  }
}

/** §8.1 的实测值：全文 gzip 后约 3.5 KB/篇；配图按 40% 条目带图、2 张/篇、150 KB/张。 */
function estimateStorage(retentionDays: number, itemsPerRun: number) {
  const items = retentionDays * itemsPerRun
  return {
    fulltextMb: (items * 3.5) / 1024,
    imagesMb: (items * 0.4 * 2 * 150) / 1024,
  }
}

export default function KeywordForm({
  mode,
  initial,
}: {
  mode: 'create' | 'edit'
  initial?: KeywordDetail
}) {
  const router = useRouter()

  const [name, setName] = useState(initial?.name ?? '')
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [query, setQuery] = useState(initial?.query ?? '')
  const [sources, setSources] = useState<Source[]>(
    initial?.sources?.length ? initial.sources : [blankSource('gnews', '')],
  )
  const [retention, setRetention] = useState(String(initial?.retention_days ?? 90))
  const [maxItems, setMaxItems] = useState(String(initial?.max_items_per_run ?? 5))
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patchSource = (i: number, patch: Partial<Source>) =>
    setSources((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))

  const changeType = (i: number, type: SourceType) =>
    setSources((prev) => prev.map((s, idx) => (idx === i ? blankSource(type, query) : s)))

  const est = estimateStorage(Number(retention) || 0, Number(maxItems) || 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      if (mode === 'create') {
        const created = await apiSend<KeywordDetail>('/api/keywords', 'POST', {
          name,
          query,
          ...(slug.trim() ? { slug: slug.trim() } : {}),
          sources,
          retention_days: Number(retention),
          max_items_per_run: Number(maxItems),
        })
        router.push(`/k/${created.slug}`)
      } else {
        await apiSend<KeywordDetail>(`/api/keywords/${initial!.slug}`, 'PATCH', {
          name,
          query,
          sources,
          retention_days: Number(retention),
          max_items_per_run: Number(maxItems),
          enabled,
        })
        router.push(`/k/${initial!.slug}`)
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败，请重试')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <Field label="名称" required hint="显示用，比如「AI Agent 新进展」">
        {({ id, describedBy }) => (
          <Input id={id} describedBy={describedBy} value={name} onChange={setName} />
        )}
      </Field>

      {mode === 'create' && (
        <Field label="网址标识（slug）" hint="留空自动生成。建好之后不能再改 —— 改了会让已有链接失效">
          {({ id, describedBy }) => (
            <Input
              id={id}
              describedBy={describedBy}
              value={slug}
              onChange={setSlug}
              placeholder="ai-agents"
            />
          )}
        </Field>
      )}

      <Field label="检索词" required hint="实际拿去搜索和判断相关性用的词">
        {({ id, describedBy }) => (
          <Input id={id} describedBy={describedBy} value={query} onChange={setQuery} />
        )}
      </Field>

      <SourceEditor
        sources={sources}
        onChangeType={changeType}
        onPatch={patchSource}
        onRemove={(i) => setSources((prev) => prev.filter((_, idx) => idx !== i))}
        onAdd={() => setSources((prev) => [...prev, blankSource('rss', query)])}
      />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 180px' }}>
          <Field
            label="保留天数"
            hint={`稳态约 ${est.fulltextMb.toFixed(1)} MB 全文 + ${est.imagesMb.toFixed(0)} MB 配图`}
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                describedBy={describedBy}
                type="number"
                min={1}
                max={3650}
                value={retention}
                onChange={setRetention}
              />
            )}
          </Field>
        </div>
        <div style={{ flex: '1 1 180px' }}>
          <Field label="每次最多条目" hint="1–20，超出的只入库不进简报">
            {({ id, describedBy }) => (
              <Input
                id={id}
                describedBy={describedBy}
                type="number"
                min={1}
                max={20}
                value={maxItems}
                onChange={setMaxItems}
              />
            )}
          </Field>
        </div>
      </div>

      {mode === 'edit' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 18,
            fontSize: 14,
          }}
        >
          <Switch checked={enabled} onChange={setEnabled} label="启用这个关键词" />
          <span>{enabled ? '已启用，每天自动采集' : '已停用，不再采集'}</span>
        </div>
      )}

      {error && (
        <p
          role="alert"
          style={{
            color: 'var(--danger)',
            fontSize: 14,
            background: 'var(--surface)',
            border: '1px solid var(--danger)',
            borderRadius: 8,
            padding: '9px 12px',
            margin: '0 0 16px',
          }}
        >
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <Button type="submit" variant="primary" loading={saving}>
          {mode === 'create' ? '创建关键词' : '保存'}
        </Button>
        <Button onClick={() => router.back()} disabled={saving}>
          取消
        </Button>
      </div>
    </form>
  )
}

function SourceEditor({
  sources,
  onChangeType,
  onPatch,
  onRemove,
  onAdd,
}: {
  sources: Source[]
  onChangeType: (i: number, type: SourceType) => void
  onPatch: (i: number, patch: Partial<Source>) => void
  onRemove: (i: number) => void
  onAdd: () => void
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <p style={{ fontSize: 14, fontWeight: 500, margin: '0 0 4px' }}>
        发现源<span aria-hidden style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span>
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px' }}>
        决定「去哪里找文章」。不确定就保留 Google News —— 只要填检索词，不用自己找 RSS 地址。
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sources.map((s, i) => (
          <div
            key={i}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 12,
              background: 'var(--surface)',
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <Select
                value={s.type}
                onChange={(t) => onChangeType(i, t)}
                options={TYPE_OPTIONS}
                width={170}
              />
              <div style={{ flex: 1 }} />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onRemove(i)}
                title="删除这个来源"
              >
                移除
              </Button>
            </div>

            {(s.type === 'rss' || s.type === 'listing') && (
              <Input
                value={s.url ?? ''}
                onChange={(v) => onPatch(i, { url: v })}
                placeholder={
                  s.type === 'rss' ? 'https://example.com/feed/' : 'https://example.com/news'
                }
              />
            )}

            {s.type === 'gnews' && (
              <Input
                value={s.query ?? ''}
                onChange={(v) => onPatch(i, { query: v })}
                placeholder="要搜索的词"
              />
            )}

            {s.type === 'websearch' && (
              <>
                <Select
                  value={s.schedule ?? 'weekly'}
                  onChange={(v) => onPatch(i, { schedule: v })}
                  options={SCHEDULE_OPTIONS}
                  width={170}
                />
                <p
                  style={{
                    fontSize: 13,
                    color: 'var(--warn)',
                    margin: '8px 0 0',
                  }}
                >
                  这是唯一按次计费的来源（约 $0.01/次），建议选「每周一」。
                </p>
              </>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 10,
                fontSize: 13,
                color: 'var(--text-muted)',
              }}
            >
              <Switch
                checked={s.allow_fulltext}
                onChange={(v) => onPatch(i, { allow_fulltext: v })}
                label="抓取全文"
              />
              <span>
                {s.allow_fulltext
                  ? '抓取全文（仍会先查 robots.txt）'
                  : '只保留标题和摘要，不抓全文'}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10 }}>
        <Button size="sm" onClick={onAdd}>
          ＋ 添加来源
        </Button>
      </div>
    </div>
  )
}
