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
    --category-emoji-size: 1.15rem;
    --emoji-size: 1.55rem;
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
    height: 100%;
    min-height: 340px;
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

    let picker: HTMLElement | null = null
    let cancelled = false

    void import('emoji-picker-element').then(({ Picker }) => {
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
    ? 'text-base px-2 py-1 min-w-[2.25rem] gap-1.5'
    : 'text-xl px-2.5 py-1.5 min-w-[2.75rem] gap-2'

  return (
    <>
      {/* Trigger — clearer affordance than the previous "emoji + ▼". */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Change emoji"
        className={`${btnSizeCls} bg-white border border-gray-300 rounded-lg hover:border-orange-400 hover:bg-orange-50 transition-colors flex items-center leading-none ${className}`}
      >
        <span>{value || '😊'}</span>
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Change</span>
      </button>

      {/* Centered popover — was previously a full-screen drawer-on-mobile,
          which felt heavyweight for picking a single emoji. */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />

          <div
            className="relative bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{ width: 420, maxWidth: '100%', maxHeight: '70vh' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header — preview + close */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 flex-shrink-0">
              <span className="text-3xl leading-none">{value || '😊'}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-800">Choose an emoji</div>
                <div className="text-[11px] text-gray-400 mt-0.5">Search below, or pick a suggestion.</div>
              </div>
              <button type="button" onClick={() => setOpen(false)}
                title="Close"
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none px-2 -mr-2">&times;</button>
            </div>

            {/* Curated quick-picks — denser grid, bigger tap targets. */}
            <div className="px-4 pt-3 pb-2 border-b border-gray-100 flex-shrink-0">
              <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wider mb-2">{aboveLabel}</p>
              <div className="grid grid-cols-10 gap-1">
                {aboveEmojis.slice(0, 30).map((e, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { onChange(e); setOpen(false) }}
                    title={e}
                    className={`text-xl aspect-square rounded-md flex items-center justify-center hover:bg-orange-50 transition-colors leading-none ${value === e ? 'bg-orange-100 ring-2 ring-orange-400' : ''}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            {/* Full picker — search, all categories, skin tones. */}
            <div ref={pickerRef} className="w-full flex-1 min-h-0 overflow-hidden" />

            {/* OS keyboard hint */}
            <div className="px-3 py-2 border-t border-gray-100 text-center flex-shrink-0">
              <span className="text-[11px] text-gray-400">
                Or press <kbd className="font-mono bg-gray-100 px-1 rounded">&#x2318; Ctrl Space</kbd> (Mac) &middot;{' '}
                <kbd className="font-mono bg-gray-100 px-1 rounded">Win .</kbd> (Windows)
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
