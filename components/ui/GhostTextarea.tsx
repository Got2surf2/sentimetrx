'use client'

// components/ui/GhostTextarea.tsx
// Textarea wrapper with inline ghost-text completion. Branded as
// "Ana suggests" — a ✨ pill appears top-right when a suggestion is shown.
//
// Implementation: a mirror <div> sits behind the textarea with identical
// box metrics (font, line-height, padding, width, word-wrap). It contains
// the user's text rendered transparent + the suggestion in grey, so the
// grey continuation lands exactly where the cursor is. The real textarea
// floats on top with a transparent background.
//
// Tab to accept, Escape to dismiss, any keystroke that diverges from the
// shown prefix clears the suggestion. Hidden on coarse-pointer devices
// (no Tab key, and iOS has its own predictive bar fighting for the same
// real estate) — keep it desktop-only for v1.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { useGhostSuggestion, type GhostSurface } from '@/lib/hooks/useGhostSuggestion'

interface Props {
  value:    string
  onChange: (v: string) => void
  surface:  GhostSurface
  context:  Record<string, unknown>
  /** Disables ghost-text. (The hook also honors useOrgAiMode off-mode.) */
  disabled?:    boolean
  placeholder?: string
  style?:       CSSProperties
  onFocus?:     (e: React.FocusEvent<HTMLTextAreaElement>) => void
  onBlur?:      (e: React.FocusEvent<HTMLTextAreaElement>) => void
}

export default function GhostTextarea(props: Props) {
  const { value, onChange, surface, context, disabled, placeholder, style, onFocus, onBlur } = props

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef   = useRef<HTMLDivElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [isTouch,   setIsTouch]   = useState(false)

  useEffect(function() {
    if (typeof window === 'undefined') return
    setIsTouch(window.matchMedia('(pointer: coarse)').matches)
  }, [])

  const enabled = !disabled && !isTouch && isFocused

  const { suggestion, clear } = useGhostSuggestion({
    surface,
    context,
    prefix: value,
    enabled,
  })

  // Keep the mirror's scroll in sync with the textarea so the ghost stays
  // aligned when the textarea scrolls.
  function syncScroll() {
    const ta = textareaRef.current
    const mi = mirrorRef.current
    if (!ta || !mi) return
    mi.scrollTop = ta.scrollTop
    mi.scrollLeft = ta.scrollLeft
  }
  useLayoutEffect(syncScroll, [value, suggestion])

  function accept() {
    if (!suggestion) return
    // If the suggestion would land flush against the prefix and either side
    // is a word char, insert a space — the model sometimes returns a bare
    // word continuation when a space is expected.
    const lastChar  = value.slice(-1)
    const firstChar = suggestion.charAt(0)
    const needsSpace = /\w/.test(lastChar) && /\w/.test(firstChar)
    const next = value + (needsSpace ? ' ' : '') + suggestion
    onChange(next)
    clear()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Tab' && suggestion) {
      e.preventDefault()
      accept()
      return
    }
    if (e.key === 'Escape' && suggestion) {
      e.preventDefault()
      clear()
      return
    }
  }

  // The mirror needs the same box metrics as the textarea. Pull from
  // computed style on focus/value change to stay in sync if the consumer
  // resizes the textarea (resize: vertical is common).
  const [mirrorBox, setMirrorBox] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  useLayoutEffect(function() {
    const ta = textareaRef.current
    if (!ta) return
    setMirrorBox({ width: ta.clientWidth, height: ta.clientHeight })
  }, [value, suggestion, style])

  const sharedTextStyle: CSSProperties = useMemo(function() {
    return {
      ...style,
      // Ensure both nodes wrap identically.
      whiteSpace:    'pre-wrap' as const,
      wordWrap:      'break-word' as const,
      overflowWrap:  'break-word' as const,
    }
  }, [style])

  // The mirror is absolutely positioned to overlay the textarea exactly.
  // It does NOT receive pointer events (textarea is on top); it is purely
  // visual.
  const mirrorStyle: CSSProperties = {
    ...sharedTextStyle,
    position:        'absolute',
    inset:           0,
    width:           mirrorBox.width || '100%',
    minHeight:       mirrorBox.height || (style?.minHeight ?? 0),
    pointerEvents:   'none',
    color:           'transparent',
    background:      'transparent',
    border:          (style?.border as string) || '1.5px solid transparent',
    overflow:        'hidden',
    zIndex:          0,
  }

  const textareaStyle: CSSProperties = {
    ...sharedTextStyle,
    background: 'transparent',
    position:   'relative',
    zIndex:     1,
  }

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* Mirror — hides under the textarea; shows the grey ghost continuation. */}
      <div ref={mirrorRef} style={mirrorStyle} aria-hidden="true">
        {value}
        {suggestion && (
          <span style={{ color: '#9ca3af' }}>{
            // If the last char before the suggestion is a word char and the
            // suggestion starts with one too, render a visual space so the
            // ghost doesn't collide with the prefix.
            /\w/.test(value.slice(-1)) && suggestion && /\w/.test(suggestion.charAt(0)) ? ' ' : ''
          }{suggestion}</span>
        )}
        {/* Trailing space prevents the line from collapsing when value ends
            with a newline and no suggestion is showing. */}
        {!suggestion && value.endsWith('\n') && ' '}
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={function(e) { onChange(e.target.value) }}
        onScroll={syncScroll}
        onKeyDown={handleKeyDown}
        onFocus={function(e) { setIsFocused(true); if (onFocus) onFocus(e) }}
        onBlur={function(e) {
          setIsFocused(false)
          clear()
          if (onBlur) onBlur(e)
        }}
        placeholder={placeholder}
        style={textareaStyle}
      />

      {suggestion && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute', top: 6, right: 8, zIndex: 2,
            fontSize: 10, fontWeight: 700, color: '#7c3aed',
            background: '#f5f3ff', border: '1px solid #ddd6fe',
            padding: '2px 6px', borderRadius: 10,
            pointerEvents: 'none', letterSpacing: '.02em',
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
          <span>{'✨'}</span>
          <span>{'Tab to accept'}</span>
        </div>
      )}
    </div>
  )
}
