'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface Props {
  /** The textarea/input ref to watch for text selection */
  targetRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>
  /** Current value of the field */
  value: string
  /** Callback when the value changes (with link markup inserted) */
  onChange: (newValue: string) => void
}

/**
 * Floating toolbar that appears when text is selected in a textarea.
 * Lets the user wrap the selected text in an HTML link: <a href="...">text</a>
 */
export default function LinkToolbar({ targetRef, value, onChange }: Props) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [selection, setSelection] = useState({ start: 0, end: 0, text: '' })
  const [urlInput, setUrlInput] = useState(false)
  const [url, setUrl] = useState('')
  const toolbarRef = useRef<HTMLDivElement>(null)
  const urlRef = useRef<HTMLInputElement>(null)

  const checkSelection = useCallback(() => {
    const el = targetRef.current
    if (!el) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    const text = value.slice(start, end)

    if (text.length > 0 && start !== end) {
      // Position toolbar above the textarea
      const rect = el.getBoundingClientRect()
      setPos({
        x: rect.left + rect.width / 2,
        y: rect.top - 8,
      })
      setSelection({ start, end, text })
      setShow(true)
    } else {
      if (!urlInput) {
        setShow(false)
      }
    }
  }, [targetRef, value, urlInput])

  useEffect(() => {
    const el = targetRef.current
    if (!el) return
    const handler = () => setTimeout(checkSelection, 10)
    el.addEventListener('mouseup', handler)
    el.addEventListener('keyup', handler)
    return () => {
      el.removeEventListener('mouseup', handler)
      el.removeEventListener('keyup', handler)
    }
  }, [targetRef, checkSelection])

  // Close on click outside
  useEffect(() => {
    if (!show) return
    const handler = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setShow(false)
        setUrlInput(false)
        setUrl('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [show])

  useEffect(() => {
    if (urlInput && urlRef.current) urlRef.current.focus()
  }, [urlInput])

  const applyLink = () => {
    if (!url.trim()) return
    const href = url.trim().startsWith('http') ? url.trim() : 'https://' + url.trim()
    const before = value.slice(0, selection.start)
    const after = value.slice(selection.end)
    const linked = `<a href="${href}" target="_blank">${selection.text}</a>`
    onChange(before + linked + after)
    setShow(false)
    setUrlInput(false)
    setUrl('')
  }

  if (!show) return null

  return (
    <div
      ref={toolbarRef}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        transform: 'translate(-50%, -100%)',
        zIndex: 9999,
      }}
    >
      <div style={{
        background: '#1f2937',
        borderRadius: 8,
        padding: urlInput ? '6px 8px' : '4px 6px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,.25)',
      }}>
        {!urlInput ? (
          <button
            type="button"
            onClick={() => setUrlInput(true)}
            style={{
              background: 'none',
              border: 'none',
              color: 'white',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              padding: '4px 10px',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.15)' }}
            onMouseLeave={e => { (e.target as HTMLElement).style.background = 'none' }}
          >
            <span style={{ fontSize: 14 }}>🔗</span> Add Link
          </button>
        ) : (
          <>
            <input
              ref={urlRef}
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') applyLink(); if (e.key === 'Escape') { setUrlInput(false); setUrl('') } }}
              placeholder="https://..."
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 4,
                color: 'white',
                fontSize: 12,
                padding: '4px 8px',
                width: 200,
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={applyLink}
              style={{
                background: '#e8622a',
                border: 'none',
                color: 'white',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '4px 10px',
                borderRadius: 4,
              }}
            >
              Apply
            </button>
          </>
        )}
      </div>
      {/* Arrow */}
      <div style={{
        width: 0, height: 0,
        borderLeft: '6px solid transparent',
        borderRight: '6px solid transparent',
        borderTop: '6px solid #1f2937',
        margin: '0 auto',
      }} />
    </div>
  )
}
