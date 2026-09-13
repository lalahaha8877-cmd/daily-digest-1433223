'use client'

import { useEffect, useId, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'

/**
 * 基础表单组件。对应前端需求文档 §4.1。
 *
 * 沿用项目既有做法：内联样式 + CSS 变量，不写死 hex（§1.1 约束）。
 * 焦点环一律 2px accent + offset 2px，任何地方都不得 outline:none（§8 无障碍）。
 */

const focusRing: CSSProperties = {
  outline: 'none',
}

function applyFocus(e: React.FocusEvent<HTMLElement>) {
  e.currentTarget.style.outline = '2px solid var(--accent)'
  e.currentTarget.style.outlineOffset = '2px'
}

function clearFocus(e: React.FocusEvent<HTMLElement>) {
  e.currentTarget.style.outline = 'none'
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        border: '2px solid currentColor',
        borderTopColor: 'transparent',
        borderRadius: '50%',
        display: 'inline-block',
        // 动画在 globals.css 里声明，prefers-reduced-motion 下会被全局关掉
        animation: 'spin 700ms linear infinite',
      }}
    />
  )
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, CSSProperties> = {
  primary: { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' },
  secondary: {
    background: 'var(--surface)',
    color: 'var(--text)',
    border: '1px solid var(--border-strong)',
  },
  ghost: { background: 'transparent', color: 'var(--text-muted)', border: '1px solid transparent' },
  danger: { background: 'var(--danger)', color: '#fff', border: '1px solid var(--danger)' },
}

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  type = 'button',
  onClick,
  title,
}: {
  children: ReactNode
  variant?: Variant
  size?: 'sm' | 'md'
  loading?: boolean
  disabled?: boolean
  type?: 'button' | 'submit'
  onClick?: () => void
  title?: string
}) {
  const off = disabled || loading
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={off}
      title={title}
      onFocus={applyFocus}
      onBlur={clearFocus}
      style={{
        ...VARIANTS[variant],
        ...focusRing,
        borderRadius: 6,
        padding: size === 'sm' ? '4px 10px' : '7px 14px',
        fontSize: size === 'sm' ? 13 : 14,
        fontWeight: 500,
        cursor: off ? 'not-allowed' : 'pointer',
        opacity: off ? 0.55 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        transition: 'opacity 150ms ease-out',
        fontFamily: 'inherit',
      }}
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
}

const controlStyle: CSSProperties = {
  ...focusRing,
  width: '100%',
  background: 'var(--surface-sunken)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '8px 11px',
  fontSize: 14,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

export function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
  id,
  describedBy,
  invalid,
  min,
  max,
}: {
  value: string | number
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'number' | 'password'
  disabled?: boolean
  id?: string
  describedBy?: string
  invalid?: boolean
  min?: number
  max?: number
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      min={min}
      max={max}
      disabled={disabled}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value)}
      onFocus={applyFocus}
      onBlur={clearFocus}
      style={{
        ...controlStyle,
        borderColor: invalid ? 'var(--danger)' : 'var(--border)',
      }}
    />
  )
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  disabled,
  id,
  width,
}: {
  value: T
  onChange: (v: T) => void
  options: ReadonlyArray<{ value: T; label: string }>
  disabled?: boolean
  id?: string
  width?: number | string
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      onFocus={applyFocus}
      onBlur={clearFocus}
      style={{ ...controlStyle, width: width ?? '100%', cursor: 'pointer' }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      onFocus={applyFocus}
      onBlur={clearFocus}
      style={{
        ...focusRing,
        width: 40,
        height: 22,
        borderRadius: 999,
        border: '1px solid var(--border-strong)',
        background: checked ? 'var(--accent)' : 'var(--surface-sunken)',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'background 150ms ease-out',
        flex: '0 0 auto',
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 20 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 150ms ease-out',
        }}
      />
    </button>
  )
}

/** 标签 + 控件 + 说明/错误。错误用 aria-describedby 关联（§8）。 */
export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string
  hint?: string
  error?: string
  children: (ids: { id: string; describedBy?: string }) => ReactNode
  required?: boolean
}) {
  const id = useId()
  const descId = `${id}-desc`
  const text = error ?? hint
  return (
    <div style={{ marginBottom: 18 }}>
      <label
        htmlFor={id}
        style={{
          display: 'block',
          fontSize: 14,
          fontWeight: 500,
          marginBottom: 6,
          color: 'var(--text)',
        }}
      >
        {label}
        {required && (
          <span aria-hidden style={{ color: 'var(--danger)', marginLeft: 3 }}>
            *
          </span>
        )}
      </label>
      {children({ id, describedBy: text ? descId : undefined })}
      {text && (
        <p
          id={descId}
          style={{
            margin: '6px 0 0',
            fontSize: 13,
            color: error ? 'var(--danger)' : 'var(--text-muted)',
          }}
        >
          {text}
        </p>
      )}
    </div>
  )
}

/**
 * 模态。Esc 关闭、打开时锁背景滚动、焦点移入（§7 交互规范）。
 * 不做完整的 focus trap —— 这个应用只有「删除确认」一处用到模态。
 */
export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgb(0 0 0 / .45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 50,
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          ...focusRing,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: '0 4px 16px rgb(0 0 0 / .08)',
          padding: 20,
          maxWidth: 460,
          width: '100%',
          maxHeight: '85vh',
          overflowY: 'auto',
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>{title}</h2>
        {children}
      </div>
    </div>
  )
}
