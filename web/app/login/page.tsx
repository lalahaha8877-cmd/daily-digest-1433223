'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (res.ok) {
        router.replace(params.get('next') || '/')
        router.refresh()
        return
      }

      const body = await res.json().catch(() => null)
      setError(
        res.status === 429
          ? '尝试太频繁，请 15 分钟后再试'
          : body?.error?.message || '口令不对',
      )
    } catch {
      setError('网络错误，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: '18vh auto 0' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: '0 0 20px' }}>每日消息</h1>
      <form onSubmit={submit}>
        <input
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="访问口令"
          aria-label="访问口令"
          aria-describedby={error ? 'login-error' : undefined}
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: 15,
            borderRadius: 10,
            border: `1px solid ${error ? 'var(--danger)' : 'var(--border-strong)'}`,
            background: 'var(--surface-sunken)',
            color: 'var(--text)',
          }}
        />
        {error && (
          <p id="login-error" style={{ color: 'var(--danger)', fontSize: 13, margin: '8px 0 0' }}>
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !password}
          style={{
            width: '100%',
            marginTop: 14,
            padding: '10px 12px',
            fontSize: 15,
            fontWeight: 500,
            borderRadius: 10,
            border: 'none',
            background: 'var(--accent)',
            color: '#fff',
            cursor: busy || !password ? 'not-allowed' : 'pointer',
            opacity: busy || !password ? 0.6 : 1,
          }}
        >
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
