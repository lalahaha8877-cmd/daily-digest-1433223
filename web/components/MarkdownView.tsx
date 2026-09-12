'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * 渲染 summary_md 与全文归档。安全要求见前端需求文档 §4.3。
 *
 * 硬性约束：
 *  · 禁用 raw HTML（不加 rehype-raw）—— 全文来自外部站点，是不可信内容
 *  · 所有链接强制 target=_blank rel="noopener noreferrer nofollow"
 *  · 图片懒加载 + 失败降级为灰色占位文字，不显示浏览器裂图图标
 *  · 表格与代码块套 overflow-x 容器，页面 body 永不横向滚动
 */
export default function MarkdownView({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow">
            {children}
          </a>
        ),
        img: ({ src, alt }) => <ArticleImage src={typeof src === 'string' ? src : ''} alt={alt ?? ''} />,
        table: ({ children }) => (
          <div className="table-scroll">
            <table>{children}</table>
          </div>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  )
}

function ArticleImage({ src, alt }: { src: string; alt: string }) {
  if (!src) return null
  return (
    <figure style={{ margin: '1.1em 0' }}>
      <a href={src} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={(e) => {
            const img = e.currentTarget
            const note = document.createElement('div')
            note.textContent = '[图片无法加载，可能已过期，刷新页面重试]'
            note.style.cssText =
              'color:var(--text-subtle);font-size:13px;padding:10px 0;'
            img.replaceWith(note)
          }}
        />
      </a>
      {alt ? (
        <figcaption
          style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}
        >
          {alt}
        </figcaption>
      ) : null}
    </figure>
  )
}
