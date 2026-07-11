// AI Hubs — 通用文件预览/下载组件
// 用法：<FilePreviewModal path="data/report.pdf" open={...} onClose={...} />
//       <FilePreviewButton path="data/report.pdf" />

import { useEffect, useState } from 'react'
import { X, Download, ExternalLink, FileText, Image as ImageIcon, File, Music, Video } from 'lucide-react'
import { ideApi } from '../api/client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export interface FileMeta {
  path: string
  name: string
  size: number
  ext: string
  mime: string
  is_text: boolean
  is_image: boolean
  is_pdf: boolean
  is_media: boolean
}

// ── 紧凑型按钮（用于任务列表、工具结果 等场景）──
export function FilePreviewButton({ path, label, className = '' }: { path: string; label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-bg-tertiary border border-border text-text-secondary hover:text-text-primary hover:border-accent/50 ${className}`}
        title={`预览/下载 ${label || path}`}
      >
        <FileText size={10} /> {label || path.split('/').pop()}
      </button>
      {open && <FilePreviewModal path={path} onClose={() => setOpen(false)} />}
    </>
  )
}

// ── 完整弹层 ──
export function FilePreviewModal({ path, onClose, title }: { path: string; onClose: () => void; title?: string }) {
  const [meta, setMeta] = useState<FileMeta | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [imageBlobUrl, setImageBlobUrl] = useState<string | null>(null)
  const [mediaBlobUrl, setMediaBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancel = false
    let blobUrl: string | null = null
    setLoading(true); setErr(''); setText(null); setImageBlobUrl(null); setMediaBlobUrl(null)
    ;(async () => {
      try {
        const m = await ideApi.fileInfo(path)
        if (cancel) return
        setMeta(m)
        const token = localStorage.getItem('ai_hubs_token') || ''
        if (m.is_text && m.size < 1024 * 1024) {
          const res = await fetch(ideApi.previewUrl(path), {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (res.ok) {
            const t = await res.text()
            if (!cancel) setText(t)
          }
        }
        if (m.is_image) {
          const res = await fetch(ideApi.previewUrl(path, true), {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (res.ok) {
            const blob = await res.blob()
            blobUrl = URL.createObjectURL(blob)
            if (!cancel) setImageBlobUrl(blobUrl)
          }
        }
        if (m.is_media) {
          const res = await fetch(ideApi.previewUrl(path, true), {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (res.ok) {
            const blob = await res.blob()
            blobUrl = URL.createObjectURL(blob)
            if (!cancel) setMediaBlobUrl(blobUrl)
          }
        }
      } catch (e) {
        if (!cancel) setErr((e as Error)?.message || '加载失败')
      }
      if (!cancel) setLoading(false)
    })()
    return () => {
      cancel = true
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [path])

  const downloadHref = ideApi.downloadUrl(path)
  const previewHref = meta ? ideApi.previewUrl(path, true) : ''
  const name = meta?.name || path.split('/').pop() || path
  const sizeStr = meta ? formatSize(meta.size) : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="bg-bg-secondary border border-border rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-bg-tertiary flex-shrink-0">
          {meta?.is_image ? <ImageIcon size={16} className="text-accent" /> :
           meta?.is_pdf ? <FileText size={16} className="text-red-500" /> :
           meta?.is_media && meta.mime.startsWith('audio/') ? <Music size={16} className="text-accent" /> :
           meta?.is_media ? <Video size={16} className="text-accent" /> :
           <File size={16} className="text-text-muted" />}
          <span className="font-medium text-text-primary truncate flex-1">{title || name}</span>
          {meta && <span className="text-xs text-text-muted">{meta.mime} · {sizeStr}</span>}
          <a href={previewHref} target="_blank" rel="noreferrer"
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-secondary"
            title="新窗口打开">
            <ExternalLink size={14} />
          </a>
          <a href={downloadHref} download={name}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-secondary"
            title="下载">
            <Download size={14} />
          </a>
          <button onClick={onClose}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-secondary"
            title="关闭">
            <X size={14} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 min-h-0 overflow-auto bg-bg-primary">
          {loading ? (
            <div className="h-full flex items-center justify-center text-text-muted">加载中…</div>
          ) : err ? (
            <div className="h-full flex items-center justify-center text-red-500 p-4">{err}</div>
          ) : !meta ? (
            <div className="h-full flex items-center justify-center text-text-muted">文件不存在</div>
          ) : meta.is_image ? (
            <div className="h-full flex items-center justify-center p-4">
              {imageBlobUrl ? (
                <img src={imageBlobUrl} alt={name} className="max-w-full max-h-full object-contain" />
              ) : (
                <div className="text-text-muted">加载中…</div>
              )}
            </div>
          ) : meta.is_pdf ? (
            <iframe src={previewHref} className="w-full h-full" title={name} />
          ) : meta.is_text ? (
            meta.ext === 'md' ? (
              <div className="p-4 text-sm text-text-primary max-w-none prose prose-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{text || '空文件'}</ReactMarkdown>
              </div>
            ) : (
              <pre className="p-4 text-xs text-text-primary whitespace-pre-wrap break-words font-mono">{text || '空文件'}</pre>
            )
          ) : meta.is_media && meta.mime.startsWith('audio/') ? (
            <div className="h-full flex items-center justify-center p-8">
              {mediaBlobUrl ? (
                <audio src={mediaBlobUrl} controls className="w-full max-w-md" />
              ) : (
                <div className="text-text-muted">加载中…</div>
              )}
            </div>
          ) : meta.is_media ? (
            mediaBlobUrl ? (
              <video src={mediaBlobUrl} controls className="w-full h-full" />
            ) : (
              <div className="h-full flex items-center justify-center text-text-muted">加载中…</div>
            )
          ) : (
            // 其它二进制（pptx/docx/xlsx/zip 等）：给个下载引导
            <div className="h-full flex flex-col items-center justify-center text-text-muted gap-3 p-8">
              <FileText size={48} className="text-text-dim" />
              <div className="text-text-primary font-medium">{name}</div>
              <div className="text-xs">此文件类型无法在浏览器中直接预览，请下载后查看</div>
              <a href={downloadHref} download={name}
                className="mt-2 px-4 py-2 rounded-lg bg-accent text-white text-sm flex items-center gap-2">
                <Download size={14} /> 下载文件
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function formatSize(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
