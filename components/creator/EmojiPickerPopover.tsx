'use client'

import { useState, useRef, useEffect, type MutableRefObject } from 'react'

// ── Curated rating-scale picks (for experience/Likert scales) ─

export const RATING_SCALE_EMOJIS = [
  '😞','😕','😐','😊','😍',
  '😡','😢','😔','😌','😄',
  '😎','🤩','🥳','😤','🥺',
  '👍','👎','❤️','💔','⭐',
  '🔥','💯','🏆','✅','❌',
]

// ── Curated quick picks (fallback when no industry emojis) ─────

export const QUICK_EMOJIS = [
  '😀','😃','😄','😁','😆','🥹','😅','😂','🙂','😊','😇','🥰','😍','🤩',
  '😋','😛','😜','🤪','😝','🤑','🤗','🤔','😐','😑','😏','😒','🙄','😬',
  '😌','😔','😪','😴','😷','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓',
  '🧐','😕','🙁','☹️','😢','😭','😱','😤','😡','😠','👿',
  '👍','👎','👏','🙌','🤝','🙏','💪','✌️','🤞','👌','🤌','✊','🫶',
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💯','⭐','🌟','✨','💫',
  '🔥','🏆','🥇','🎯','💎','🎉','🚀','💡',
]

// ── Props ─────────────────────────────────────────────────────

interface Props {
  value:           string
  onChange:        (v: string) => void
  /** If provided, show these emojis in the industry row above the picker */
  industryEmojis?: string[]
  industryLabel?:  string
  /** Replaces QUICK_EMOJIS above the line when no industryEmojis */
  curatedEmojis?:  string[]
  /** Size of the trigger button: 'sm' | 'md' (default 'md') */
  size?:           'sm' | 'md'
  className?:      string
}

// ── CSS injected once for the emoji-picker-element web component ─

const PICKER_CSS = `
  emoji-picker {
    --background: #ffffff;
    --border-color: #e5e7eb;
    --button-active-background: #fff7ed;
    --button-hover-background: #fef3ec;
    --category-emoji-size: 1.25rem;
    --emoji-size: 1.6rem;
    --emoji-padding: 8px;
    --indicator-color: #e8622a;
    --input-border-color: #d1d5db;
    --input-font-color: #111827;
    --input-placeholder-color: #9ca3af;
    --outline-color: #fb923c;
    --category-font-color: #6b7280;
    --num-columns: 8;
    --border-radius: 0px;
    width: 100%;
    height: 100%;
    min-height: 300px;
    border: none;
    box-shadow: none;
  }
`

let cssInjected = false
function injectPickerCSS() {
  if (cssInjected || typeof document === 'undefined') return
  const style = document.createElement('style')
  style.textContent = PICKER_CSS
  document.head.appendChild(style)
  cssInjected = true
}

// ── Component ─────────────────────────────────────────────────

export default function EmojiPickerPopover({
  value, onChange, industryEmojis, industryLabel, curatedEmojis, size = 'md', className = '',
}: Props) {
  const [open, setOpen] = useState(false)
  const pickerRef      = useRef<HTMLDivElement>(null)
  const onChangeRef    = useRef(onChange) as MutableRefObject<(v: string) => void>

  useEffect(() => { onChangeRef.current = onChange })

  const aboveLabel  = industryEmojis ? (industryLabel ? `${industryLabel} picks` : 'Industry picks') : 'Suggested'
  const aboveEmojis = industryEmojis ?? curatedEmojis ?? QUICK_EMOJIS

  // Lock body scroll when modal is open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Close on Escape key
  useEffect(() => {
    if (!open) return
    function handle(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open])

  // Dynamically mount emoji-picker-element when modal opens
  useEffect(() => {
    if (!open || !pickerRef.current) return
    injectPickerCSS()

    let picker: any = null
    let cancelled = false

    import('emoji-picker-element').then(({ Picker }) => {
      if (cancelled || !pickerRef.current) return
      pickerRef.current.innerHTML = ''
      picker = new Picker({ skinToneEmoji: '👋' })
      pickerRef.current.appendChild(picker)

      function handlePick(e: Event) {
        const detail = (e as CustomEvent).detail
        // detail.unicode has the skin-tone-applied version; detail.emoji.unicode is the base
        const emoji = detail?.unicode || detail?.emoji?.unicode
        if (emoji) { onChangeRef.current(emoji); setOpen(false) }
      }
      picker.addEventListener('emoji-click', handlePick)
    })

    return () => {
      cancelled = true
      if (picker && pickerRef.current) {
        try { pickerRef.current.innerHTML = '' } catch (_) {}
      }
    }
  }, [open])

  const btnSizeCls = size === 'sm'
    ? 'text-base px-1.5 py-1 min-w-[2rem]'
    : 'text-xl px-2 py-1.5 min-w-[2.5rem]'

  return (
    <>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Pick emoji"
        className={`${btnSizeCls} bg-white border border-gray-300 rounded-lg hover:border-orange-400 transition-colors flex items-center gap-1 leading-none ${className}`}
      >
        <span>{value || '😊'}</span>
        <span className="text-gray-400 text-[10px] leading-none">▼</span>
      </button>

      {/* Full-screen modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => setOpen(false)}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40" />

          {/* Modal panel */}
          <div
            className="relative bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{ maxHeight: '85vh' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
              <span className="text-sm font-semibold text-gray-700">Choose Emoji</span>
              <button type="button" onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none px-1">&times;</button>
            </div>

            {/* Current selection + paste input */}
            <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100 flex-shrink-0">
              <span className="text-3xl">{value || '😊'}</span>
              <span className="text-xs text-gray-400 flex-1">Current selection</span>
              <input
                type="text"
                placeholder="Paste emoji"
                className="w-16 text-center text-xl border border-gray-200 rounded-lg px-1 py-1 outline-none focus:border-orange-400"
                style={{ fontSize: 16 }}
                onChange={(e) => {
                  const val = e.target.value
                  if (!val) return
                  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
                    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
                    const segments = Array.from(segmenter.segment(val), s => s.segment)
                    if (segments.length > 0) { onChange(segments[segments.length - 1]); setOpen(false) }
                  } else {
                    onChange(val.slice(-2)); setOpen(false)
                  }
                }}
              />
            </div>

            {/* Industry / curated quick-picks */}
            <div className="px-4 pt-3 pb-2 border-b border-gray-100 flex-shrink-0">
              <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wider mb-1.5">{aboveLabel}</p>
              <div className="flex flex-wrap gap-1">
                {aboveEmojis.slice(0, 40).map((e, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { onChange(e); setOpen(false) }}
                    title={e}
                    className={`text-2xl p-2 rounded-lg hover:bg-orange-50 transition-colors leading-none ${value === e ? 'bg-orange-100 ring-2 ring-orange-400' : ''}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            {/* Full emoji-picker-element — search, all categories, skin tones */}
            <div ref={pickerRef} className="w-full flex-1 min-h-0 overflow-hidden" />

            {/* OS keyboard hint */}
            <div className="px-3 py-2 border-t border-gray-100 text-center flex-shrink-0">
              <span className="text-[11px] text-gray-400">
                Or press <kbd className="font-mono bg-gray-100 px-1 rounded">&#x2318; Ctrl Space</kbd> (Mac) &middot;{' '}
                <kbd className="font-mono bg-gray-100 px-1 rounded">Win .</kbd> (Windows) for the OS keyboard
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
