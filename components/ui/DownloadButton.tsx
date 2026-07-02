'use client'

// components/ui/DownloadButton.tsx
// Small dropdown for choosing CSV vs Excel (.xlsx) export format.
// Pass a builder that returns a URL or a fetch handler given the chosen format.
//
// Usage:
//   <DownloadButton
//     hrefFor={fmt => '/api/foo/export?format=' + fmt}
//   />
//
// Or for a fetch+blob flow:
//   <DownloadButton
//     onChoose={async fmt => { const res = await fetch(...); ... }}
//   />

import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Build a download URL for the chosen format. The browser navigates to it. */
  hrefFor?: (format: 'csv' | 'xlsx') => string
  /** Or take over the action — useful when you need POST or signed URLs. */
  onChoose?: (format: 'csv' | 'xlsx') => void | Promise<void>
  label?: string
  disabled?: boolean
  /** Tailwind class applied to the trigger button. Defaults match HERMES button styling. */
  className?: string
}

export default function DownloadButton({ hrefFor, onChoose, label = 'Download', disabled, className }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const choose = (fmt: 'csv' | 'xlsx') => {
    setOpen(false)
    if (onChoose) { void onChoose(fmt); return }
    if (hrefFor) { window.location.href = hrefFor(fmt) }
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button type="button" disabled={disabled} onClick={() => setOpen(o => !o)}
        className={className || 'text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50'}>
        {label} <span style={{ fontSize: '0.65rem', marginLeft: 4 }}>▼</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-10 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden min-w-[140px]">
          <button onClick={() => choose('csv')}
            className="w-full text-left text-xs px-3 py-2 hover:bg-gray-50 text-gray-700">
            CSV
          </button>
          <button onClick={() => choose('xlsx')}
            className="w-full text-left text-xs px-3 py-2 hover:bg-gray-50 text-gray-700 border-t border-gray-100">
            Excel (.xlsx)
          </button>
        </div>
      )}
    </div>
  )
}
