'use client'

import { useState, useRef, useEffect } from 'react'

// ── Curated rating-scale picks (for experience/Likert scales) ─

export const RATING_SCALE_EMOJIS = [
  '😞','😕','😐','😊','😍',
  '😡','😢','😔','😌','😄',
  '😎','🤩','🥳','😤','🥺',
  '👍','👎','❤️','💔','⭐',
  '🔥','💯','🏆','✅','❌',
]

// ── Curated "above the line" picks (reactions + rating scales) ─

export const QUICK_EMOJIS = [
  '😀','😃','😄','😁','😆','🥹','😅','😂','🙂','😊','😇','🥰','😍','🤩',
  '😋','😛','😜','🤪','😝','🤑','🤗','🤔','😐','😑','😏','😒','🙄','😬',
  '😌','😔','😪','😴','😷','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓',
  '🧐','😕','🙁','☹️','😢','😭','😱','😤','😡','😠','👿',
  '👍','👎','👏','🙌','🤝','🙏','💪','✌️','🤞','👌','🤌','✊','🫶',
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💯','⭐','🌟','✨','💫',
  '🔥','🏆','🥇','🎯','💎','🎉','🚀','💡',
]

// ── Full categorized library (shown below the divider) ────────

export const EMOJI_CATEGORIES = [
  {
    id: 'reactions',
    label: 'All reactions',
    icon: '😊',
    emojis: [
      '😀','😃','😄','😁','😆','🥹','😅','🤣','😂','🙂','🙃','😉','😊','😇',
      '🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑',
      '🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥',
      '😌','😔','😪','🤤','😴','🥱','😷','🤒','🤕','🤢','🤧','🥵','🥶','🥴',
      '😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯',
      '😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞',
      '😓','😩','😫','😤','😡','😠','🤬','👿','💀','☠️','💩','🤡','👻',
    ],
  },
  {
    id: 'hands',
    label: 'Hands & gestures',
    icon: '👋',
    emojis: [
      '👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞',
      '🫰','🤟','🤘','🤙','👈','👉','👆','👇','☝️','🫵','👍','👎','✊','👊',
      '🤛','🤜','👏','🙌','🫶','🤲','🤝','🙏','💪','🦾','💅','🤳',
    ],
  },
  {
    id: 'hearts',
    label: 'Hearts & stars',
    icon: '❤️',
    emojis: [
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','❤️‍🔥','❤️‍🩹','💔',
      '💘','💝','💖','💗','💓','💞','💕','💟','❣️','💌','💋','💯',
      '✨','💫','⭐','🌟','🌠','🌈','🔥','💥','🌸','🌺','🌻','🌹','🌷','💐',
    ],
  },
  {
    id: 'awards',
    label: 'Awards & scores',
    icon: '🏆',
    emojis: [
      '🏆','🥇','🥈','🥉','🎖️','🏅','🎯','💯','🔥','🎉','🎊','🎁','🎀',
      '🏵️','🎗️','🎫','🎟️','🚀','⚡','💎','🌟','✨','💫','👑','🪄',
      '📊','📈','📉','🔔','📣','📢','🆙','🆒','🆕',
    ],
  },
  {
    id: 'people',
    label: 'People',
    icon: '👥',
    emojis: [
      '👤','👥','🧑','👶','🧒','👦','👧','👱','👨','🧔','👩','🧓','👴','👵',
      '🧑‍💼','👨‍💼','👩‍💼','🧑‍⚕️','👨‍⚕️','👩‍⚕️',
      '🧑‍🏫','👨‍🏫','👩‍🏫','🧑‍💻','👨‍💻','👩‍💻',
      '🧑‍🍳','👨‍🍳','👩‍🍳','🤝','🫂','💬','🗣️',
    ],
  },
  {
    id: 'nature',
    label: 'Nature',
    icon: '🌿',
    emojis: [
      '🌱','🌿','🍀','🌾','🌵','🌲','🌳','🌴','🌸','🌺','🌻','🌹','🌷','💐',
      '🍁','🍂','🍃','☀️','🌤️','⛅','🌥️','☁️','🌦️','🌧️','⛈️','❄️','⛄',
      '🌈','🌊','💧','🌙','🌍','🌎','🌏','🏔️','⛰️','🗻','🏖️','🏝️',
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    icon: '💼',
    emojis: [
      '💼','📋','📊','📈','📉','📌','📍','🗺️','🏷️','📦','📬','📧','📱','💻',
      '🖥️','⌨️','🖱️','🔧','🔩','⚙️','🛠️','🔬','🔭','💡','🔦','🕯️','🔐','🗝️',
      '📚','📖','✏️','📝','🗒️','📓','📔','📒','📕','📗','📘','📙','🎒','🧳',
    ],
  },
  {
    id: 'symbols',
    label: 'Symbols',
    icon: '✅',
    emojis: [
      '✅','❌','⭕','❓','❗','‼️','⁉️','💯','🔴','🟠','🟡','🟢','🔵','🟣',
      '⚫','⚪','🟤','🔶','🔷','🔸','🔹','🔺','🔻','💠','🔘',
      '♠️','♥️','♦️','♣️','♾️','✔️','☑️','🔔','🎵','🎶','🎼',
      '⬆️','⬇️','⬅️','➡️','↗️','↘️','↙️','↖️','🔄','♻️',
    ],
  },
]

const ALL_LIBRARY_EMOJIS = EMOJI_CATEGORIES.flatMap(c => c.emojis)

// ── Skin tone support ─────────────────────────────────────────
const SKIN_TONES        = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}']
const SKIN_TONE_SAMPLES = ['🖐️','🖐🏻','🖐🏼','🖐🏽','🖐🏾','🖐🏿']
const SKIN_TONE_LABELS  = ['Default','Light','Medium-light','Medium','Medium-dark','Dark']
const SKIN_TONE_CAPABLE = new Set([
  '👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰',
  '🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛',
  '🤜','👏','🙌','🫶','🤲','🙏','💪','💅','🤳','👶','🧒','👦','👧','🧑','👱',
  '👨','🧔','👩','🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🙇','🤦','🤷',
])
function applyTone(emoji: string, tone: string) {
  if (!tone || !SKIN_TONE_CAPABLE.has(emoji)) return emoji
  return emoji + tone
}

// ── Props ─────────────────────────────────────────────────────

interface Props {
  value:           string
  onChange:        (v: string) => void
  /** If provided, show these emojis in the "above the line" section with industry label */
  industryEmojis?: string[]
  industryLabel?:  string
  /** Replaces QUICK_EMOJIS above the line when no industryEmojis — pass a curated context set */
  curatedEmojis?:  string[]
  /** Size of the trigger button: 'sm' | 'md' (default 'md') */
  size?:           'sm' | 'md'
  className?:      string
}

// ── Component ─────────────────────────────────────────────────

export default function EmojiPickerPopover({
  value, onChange, industryEmojis, industryLabel, curatedEmojis, size = 'md', className = '',
}: Props) {
  const [open,      setOpen]      = useState(false)
  const [moreTab,   setMoreTab]   = useState('reactions')
  const [search,    setSearch]    = useState('')
  const [tone,      setTone]      = useState('')
  const [customVal, setCustomVal] = useState('')

  const wrapRef   = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const nativeRef = useRef<HTMLInputElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  // Focus search on open
  useEffect(() => {
    if (open) { setSearch(''); setTimeout(() => searchRef.current?.focus(), 50) }
  }, [open])

  // "Above the line" emojis: industry-specific if provided, else curated or default quick set
  const aboveLabel   = industryEmojis ? (industryLabel ? `${industryLabel} picks` : 'Industry picks') : 'Suggested'
  const aboveEmojis  = industryEmojis ?? curatedEmojis ?? QUICK_EMOJIS

  // Search across all emojis
  const searchTrimmed = search.trim()
  const searchActive  = searchTrimmed.length > 0

  // For the "more" section grid
  const moreEmojis = EMOJI_CATEGORIES.find(c => c.id === moreTab)?.emojis ?? []

  function select(emoji: string) {
    onChange(applyTone(emoji, tone))
    setOpen(false)
    setSearch('')
  }

  function useCustom() {
    const v = customVal.trim()
    if (!v) return
    onChange(v)
    setOpen(false)
    setCustomVal('')
  }

  const btnSizeCls = size === 'sm'
    ? 'text-base px-1.5 py-1 min-w-[2rem]'
    : 'text-xl px-2 py-1.5 min-w-[2.5rem]'

  // Emojis shown when search is active
  const searchResults = searchTrimmed
    ? Array.from(new Set([...aboveEmojis, ...ALL_LIBRARY_EMOJIS])).filter(e => e.includes(searchTrimmed))
    : []

  return (
    <div ref={wrapRef} className="relative inline-block">
      {/* Trigger button */}
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
          className="absolute z-50 bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden flex flex-col"
          style={{ width: 320, top: 'calc(100% + 4px)', left: 0 }}
        >
          {/* Search */}
          <div className="px-3 pt-3 pb-2">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search emojis…"
              className="w-full px-3 py-2 rounded-xl text-sm bg-gray-50 border border-gray-200 outline-none focus:border-orange-400 transition-colors"
            />
          </div>

          {/* Skin tone selector */}
          <div className="flex gap-1 px-3 pb-2">
            <span className="text-xs text-gray-400 self-center mr-1">Skin:</span>
            {SKIN_TONES.map((t, ti) => (
              <button
                key={ti}
                type="button"
                title={SKIN_TONE_LABELS[ti]}
                onClick={() => setTone(t)}
                className={`text-base px-1 py-0.5 rounded-lg transition-all ${tone === t ? 'bg-orange-100 ring-2 ring-orange-400' : 'hover:bg-gray-100'}`}
              >
                {SKIN_TONE_SAMPLES[ti]}
              </button>
            ))}
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: 340 }}>
            {searchActive ? (
              /* ── Search results ── */
              <div className="px-2 py-2">
                <p className="text-xs text-gray-400 px-1 mb-1">
                  {searchResults.length > 0 ? `${searchResults.length} matches` : 'No matches — try the custom field below'}
                </p>
                <div className="grid grid-cols-8 gap-0.5">
                  {searchResults.map((e, i) => {
                    const rendered = applyTone(e, tone)
                    return (
                      <button key={i} type="button" onClick={() => select(e)} title={e}
                        className={`text-xl p-1.5 rounded-lg hover:bg-orange-50 transition-colors leading-none ${value === rendered ? 'bg-orange-100 ring-2 ring-orange-400' : ''}`}>
                        {rendered}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <>
                {/* ── Above the line: industry/curated picks ── */}
                <div className="px-3 py-2">
                  <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wider mb-1.5">{aboveLabel}</p>
                  <div className="grid grid-cols-8 gap-0.5">
                    {aboveEmojis.map((e, i) => {
                      const rendered = applyTone(e, tone)
                      return (
                        <button key={i} type="button" onClick={() => select(e)} title={e}
                          className={`text-xl p-1.5 rounded-lg hover:bg-orange-50 transition-colors leading-none ${value === rendered ? 'bg-orange-100 ring-2 ring-orange-400' : ''}`}>
                          {rendered}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* ── Divider with "More emojis" label ── */}
                <div className="flex items-center gap-2 px-3 py-2">
                  <div className="flex-1 h-px bg-gray-100" />
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">More emojis</span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>

                {/* ── Category tabs for the "more" section ── */}
                <div className="flex gap-1 px-2 overflow-x-auto pb-1">
                  {EMOJI_CATEGORIES.map(cat => (
                    <button
                      key={cat.id}
                      type="button"
                      title={cat.label}
                      onClick={() => setMoreTab(cat.id)}
                      className={`flex-shrink-0 text-lg px-2 py-1 rounded-lg transition-all ${moreTab === cat.id ? 'bg-orange-100 ring-2 ring-orange-400' : 'hover:bg-gray-100'}`}
                    >
                      {cat.icon}
                    </button>
                  ))}
                </div>

                {/* ── Below the line: category grid ── */}
                <div className="grid grid-cols-8 gap-0.5 px-2 pt-1 pb-2">
                  {moreEmojis.map((e, i) => {
                    const rendered = applyTone(e, tone)
                    return (
                      <button key={i} type="button" onClick={() => select(e)} title={e}
                        className={`text-xl p-1.5 rounded-lg hover:bg-orange-50 transition-colors leading-none ${value === rendered ? 'bg-orange-100 ring-2 ring-orange-400' : ''}`}>
                        {rendered}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {/* Custom / paste row */}
          <div className="flex gap-2 px-3 py-2 border-t border-gray-100">
            <input
              ref={nativeRef}
              type="text"
              value={customVal}
              onChange={e => setCustomVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') useCustom() }}
              placeholder="Type or paste any emoji…"
              className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 text-sm outline-none focus:border-orange-400 transition-colors"
            />
            <button
              type="button"
              onClick={useCustom}
              disabled={!customVal.trim()}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-default transition-colors"
            >
              Use
            </button>
          </div>

          {/* OS keyboard hint */}
          <div className="px-3 pb-2.5 text-center">
            <button
              type="button"
              onClick={() => nativeRef.current?.focus()}
              className="text-[11px] text-gray-400 hover:text-orange-500 transition-colors"
            >
              🌐 Use OS emoji keyboard: <span className="font-mono">⌘ Ctrl Space</span> (Mac) · <span className="font-mono">Win .</span> (Windows)
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
