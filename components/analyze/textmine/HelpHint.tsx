'use client'
// components/analyze/textmine/HelpHint.tsx
// Click-to-reveal help popover. Lightweight, no deps, AI-independent so it
// works for every client regardless of feature flags. Pairs a small ? icon
// with a popover explaining what a feature is and how to use it.

import { useState, useRef, useEffect, type ReactNode } from 'react'

const HERMES = '#E8632A'

interface Props {
  title:      string
  children:   ReactNode
  placement?: 'top' | 'bottom' | 'left' | 'right'
  /** Render the icon + popover relative to the parent (default true). When
   *  false the caller positions the host span themselves. */
  inline?:    boolean
}

export default function HelpHint({ title, children, placement = 'bottom', inline = true }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(function() {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEsc)
    return function() {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const popPos: React.CSSProperties =
    placement === 'top'    ? { bottom: 'calc(100% + 8px)', left: 0 } :
    placement === 'left'   ? { right:  'calc(100% + 8px)', top: 0 } :
    placement === 'right'  ? { left:   'calc(100% + 8px)', top: 0 } :
                              { top:    'calc(100% + 8px)', left: 0 }

  return (
    <span ref={ref} style={{ position: 'relative', display: inline ? 'inline-flex' : 'inline-block', alignItems: 'center', verticalAlign: 'middle' }}>
      <button
        type="button"
        onClick={function(e) { e.stopPropagation(); e.preventDefault(); setOpen(function(o) { return !o }) }}
        title="What is this?"
        aria-label={'Help: ' + title}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 14, height: 14, borderRadius: '50%',
          background: open ? '#fff4ef' : 'transparent',
          border: '1px solid ' + (open ? HERMES : '#d1d5db'),
          color: open ? HERMES : '#9ca3af',
          fontSize: 9, fontWeight: 800, cursor: 'pointer', marginLeft: 4,
          lineHeight: 1, padding: 0, flexShrink: 0,
          transition: 'all 0.12s',
        }}>
        ?
      </button>
      {open && (
        <div
          role="tooltip"
          onClick={function(e) { e.stopPropagation() }}
          style={{
            position: 'absolute', zIndex: 50, ...popPos,
            background: 'white', borderRadius: 10,
            border: '1px solid #e5e7eb',
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            padding: '12px 14px',
            width: 280, fontSize: 12, lineHeight: 1.55, color: '#374151',
            textAlign: 'left' as const, fontWeight: 400,
          }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#0a1628', marginBottom: 6 }}>{title}</div>
          <div>{children}</div>
        </div>
      )}
    </span>
  )
}
