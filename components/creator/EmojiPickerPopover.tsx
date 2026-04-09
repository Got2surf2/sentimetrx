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

// Re-exported for callers that used EMOJI_CATEGORIES
export const EMOJI_CATEGORIES: { id: string; label: string; icon: string; emojis: string[] }[] = []

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
    --category-emoji-size: 1.1rem;
    --emoji-size: 1.4rem;
    --emoji-padding: 6px;
    --indicator-color: #e8622a;
    --input-border-color: #d1d5db;
    --input-font-color: #111827;
    --input-placeholder-color: #9ca3af;
    --outline-color: #fb923c;
    --category-font-color: #6b7280;
    --num-columns: 9;
    --border-radius: 0px;
    width: 100%;
    height: 380px;
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
  const wrapRef        = useRef<HTMLDivElement>(null)
  const pickerRef      = useRef<HTMLDivElement>(null)
  const onChangeRef    = useRef(onChange) as MutableRefObject<(v: string) => void>

  useEffect(() => { onChangeRef.current = onChange })

  const aboveLabel  = industryEmojis ? (industryLabel ? `${industryLabel} picks` : 'Industry picks') : 'Suggested'
  const aboveEmojis = industryEmojis ?? curatedEmojis ?? QUICK_EMOJIS

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  // Dynamically mount emoji-picker-element when popover opens
  useEffect(() => {
    if (!open || !pickerRef.current) return
    injectPickerCSS()

    let picker: any = null

    import('emoji-picker-element').then(({ Picker }) => {
      if (!pickerRef.current) return
      // Clear any existing instance
      pickerRef.current.innerHTML = ''
      picker = new Picker({ skinToneEmoji: '👋' })
      pickerRef.current.appendChild(picker)

      function handlePick(e: Event) {
        const detail = (e as CustomEvent).detail
        const emoji = detail?.emoji?.unicode || detail?.unicode
        if (emoji) { onChangeRef.current(emoji); setOpen(false) }
      }
      picker.addEventListener('emoji-click', handlePick)
    })

    return () => {
      if (picker && pickerRef.current) {
        try { pickerRef.current.innerHTML = '' } catch (_) {}
      }
    }
  }, [open])

  const btnSizeCls = size === 'sm'
    ? 'text-base px-1.5 py-1 min-w-[2rem]'
    : 'text-xl px-2 py-1.5 min-w-[2.5rem]'

  return (
    <div ref={wrapRef} className="relative inline-block">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title="Pick emoji"
        className={`${btnSizeCls} bg-white border border-gray-300 rounded-lg hover:border-orange-400 transition-colors flex items-center gap-1 leading-none ${className}`}
      >
        <span>{value || '😊'}</span>
        <span className="text-gray-400 text-[10px] leading-none">▼</span>
      </button>

      {/* Popover */}
      {open && (
        <div
          className="absolute z-50 bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
          style={{ width: 360, top: 'calc(100% + 6px)', left: 0 }}
        >
          {/* Industry / curated quick-picks row */}
          <div className="px-3 pt-3 pb-2 border-b border-gray-100">
            <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wider mb-1.5">{aboveLabel}</p>
            <div className="flex flex-wrap gap-0.5">
              {aboveEmojis.slice(0, 32).map((e, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { onChange(e); setOpen(false) }}
                  title={e}
                  className={`text-xl p-1.5 rounded-lg hover:bg-orange-50 transition-colors leading-none ${value === e ? 'bg-orange-100 ring-2 ring-orange-400' : ''}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Full emoji-picker-element — search, all categories, skin tones */}
          <div ref={pickerRef} className="w-full" />

          {/* OS keyboard hint */}
          <div className="px-3 py-2 border-t border-gray-100 text-center">
            <span className="text-[11px] text-gray-400">
              Or press <kbd className="font-mono bg-gray-100 px-1 rounded">⌘ Ctrl Space</kbd> (Mac) ·{' '}
              <kbd className="font-mono bg-gray-100 px-1 rounded">Win .</kbd> (Windows) for the OS keyboard
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
