'use client'

import { useState, useRef, useEffect } from 'react'

// ── Categorized emoji sets ────────────────────────────────────

const CATEGORIES = [
  {
    id: 'reactions',
    label: 'Reactions',
    icon: '😊',
    emojis: [
      '😀','😃','😄','😁','😆','🥹','😅','🤣','😂','🙂','🙃','😉','😊','😇',
      '🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑',
      '🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥',
      '😌','😔','😪','🤤','😴','🥱','😷','🤒','🤕','🤢','🤧','🥵','🥶','🥴',
      '😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯',
      '😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞',
      '😓','😩','😫','😤','😡','😠','🤬','👿',
    ],
  },
  {
    id: 'hands',
    label: 'Hands',
    icon: '👍',
    emojis: [
      '👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞',
      '🫰','🤟','🤘','🤙','👈','👉','👆','👇','☝️','🫵','👍','👎','✊','👊',
      '🤛','🤜','👏','🙌','🫶','🤲','🤝','🙏','💪','🦾','💅','🤳',
    ],
  },
  {
    id: 'hearts',
    label: 'Hearts & Stars',
    icon: '❤️',
    emojis: [
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','❤️‍🔥','❤️‍🩹','💔',
      '💘','💝','💖','💗','💓','💞','💕','💟','❣️','💌','💋','💯',
      '✨','💫','⭐','🌟','🌠','🌈','🔥','💥','🌸','🌺','🌻','🌹',
    ],
  },
  {
    id: 'awards',
    label: 'Awards',
    icon: '🏆',
    emojis: [
      '🏆','🥇','🥈','🥉','🎖️','🏅','🎯','💯','🔥','🎉','🎊','🎁','🎀',
      '🏵️','🎗️','🎫','🎟️','🚀','⚡','💎','🌟','✨','💫','👑','🪄',
      '📊','📈','📉','🔔','📣','📢',
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
    id: 'objects',
    label: 'Objects',
    icon: '💼',
    emojis: [
      '💼','📋','📊','📈','📉','📌','📍','🗺️','🏷️','📦','📬','📧','📱','💻',
      '🖥️','⌨️','🖱️','🔧','🔩','⚙️','🛠️','🔬','🔭','💡','🔦','🕯️','🔐','🗝️',
      '🚪','🪞','🪑','🛋️','🏠','🏢','🏬','🏪','🏩','🏨','🏦','🏥','🏤','🏣',
    ],
  },
  {
    id: 'nature',
    label: 'Nature',
    icon: '🌿',
    emojis: [
      '🌱','🌿','🍀','🌾','🌵','🌲','🌳','🌴','🌸','🌺','🌻','🌹','🌷','💐',
      '🍁','🍂','🍃','☀️','🌤️','⛅','🌥️','☁️','🌦️','🌧️','⛈️','🌩️','❄️','⛄',
      '🌈','🌊','💧','🌙','⭐','🌟','✨','🌍','🌎','🌏','🌐','🏔️','⛰️','🗻',
    ],
  },
  {
    id: 'symbols',
    label: 'Symbols',
    icon: '✅',
    emojis: [
      '✅','❌','⭕','❓','❗','‼️','⁉️','💯','🔴','🟠','🟡','🟢','🔵','🟣',
      '⚫','⚪','🟤','🔶','🔷','🔸','🔹','🔺','🔻','💠','🔘','🏁','🚩','🎌',
      '♠️','♥️','♦️','♣️','♾️','✔️','☑️','🔔','🔕','🎵','🎶','🎼','📣','📢',
      '⬆️','⬇️','⬅️','➡️','↗️','↘️','↙️','↖️','🔄','♻️','🆕','🆒','🆙',
    ],
  },
]

// flat list for search
const ALL_EMOJIS = CATEGORIES.flatMap(c => c.emojis)

// ── Skin tone support ─────────────────────────────────────────
const SKIN_TONES        = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}']
const SKIN_TONE_SAMPLES = ['🖐️','🖐🏻','🖐🏼','🖐🏽','🖐🏾','🖐🏿']
const SKIN_TONE_LABELS  = ['Default','Light','Medium-light','Medium','Medium-dark','Dark']
const SKIN_TONE_CAPABLE = new Set([
  '👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰',
  '🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛',
  '🤜','👏','🙌','🫶','🤲','🙏','💪','💅','🤳','👶','🧒','👦','👧','🧑','👱',
  '👨','🧔','👩','🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🙇','🤦','🤷',
  '🧑‍⚕️','👨‍⚕️','👩‍⚕️',
])
function applyTone(emoji: string, tone: string) {
  if (!tone || !SKIN_TONE_CAPABLE.has(emoji)) return emoji
  return emoji + tone
}

// ── Props ─────────────────────────────────────────────────────

interface Props {
  value:       string
  onChange:    (v: string) => void
  /** If provided, show industry-specific picks first */
  industry?:   string
  industryEmojis?: string[]
  /** Size of the trigger button: 'sm' | 'md' (default md) */
  size?:       'sm' | 'md'
  /** Extra classes on the trigger button */
  className?:  string
}

// ── Component ─────────────────────────────────────────────────

export default function EmojiPickerPopover({
  value, onChange, industry, industryEmojis, size = 'md', className = '',
}: Props) {
  const [open,       setOpen]       = useState(false)
  const [tab,        setTab]        = useState('reactions')
  const [search,     setSearch]     = useState('')
  const [tone,       setTone]       = useState('')
  const [customVal,  setCustomVal]  = useState('')

  const wrapRef      = useRef<HTMLDivElement>(null)
  const searchRef    = useRef<HTMLInputElement>(null)
  const nativeRef    = useRef<HTMLInputElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  // Focus search when popover opens
  useEffect(() => {
    if (open) {
      setSearch('')
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }, [open])

  // ── industry tab
  const hasIndustry = !!(industryEmojis && industryEmojis.length > 0)
  const tabs = hasIndustry
    ? [{ id: 'industry', label: industry || 'Industry', icon: '🎯' }, ...CATEGORIES]
    : CATEGORIES

  // ── which emojis to show in grid
  const searchTrimmed = search.trim()
  let displayEmojis: string[]
  if (searchTrimmed) {
    // simple unicode search: match emojis by code-point sequence fragment
    // since we can't look up emoji names easily, just show all and let user pick
    displayEmojis = ALL_EMOJIS.filter(e => e.includes(searchTrimmed))
    if (displayEmojis.length === 0) displayEmojis = ALL_EMOJIS
  } else if (tab === 'industry' && hasIndustry) {
    displayEmojis = industryEmojis!
  } else {
    const cat = CATEGORIES.find(c => c.id === tab)
    displayEmojis = cat ? cat.emojis : ALL_EMOJIS
  }

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
          className="absolute z-50 bg-white border border-gray-200 rounded-2xl shadow-xl flex flex-col gap-0 overflow-hidden"
          style={{ width: 320, top: 'calc(100% + 4px)', left: 0 }}
        >
          {/* Search row */}
          <div className="px-3 pt-3 pb-2">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search… or use Cmd+Ctrl+Space / Win+."
              className="w-full px-3 py-2 rounded-xl text-sm bg-gray-50 border border-gray-200 outline-none focus:border-orange-400 transition-colors"
            />
          </div>

          {/* Category tabs */}
          <div className="flex gap-1 px-3 overflow-x-auto pb-2 scrollbar-hide">
            {tabs.map(t => (
              <button
                key={t.id}
                type="button"
                title={t.label}
                onClick={() => { setTab(t.id); setSearch('') }}
                className={`flex-shrink-0 text-lg px-2 py-1 rounded-lg transition-all ${tab === t.id && !search ? 'bg-orange-100 ring-2 ring-orange-400' : 'hover:bg-gray-100'}`}
              >
                {t.icon}
              </button>
            ))}
          </div>

          {/* Skin tone row */}
          <div className="flex gap-1 px-3 pb-2 border-b border-gray-100">
            {SKIN_TONES.map((t, ti) => (
              <button
                key={ti}
                type="button"
                title={SKIN_TONE_LABELS[ti]}
                onClick={() => setTone(t)}
                className={`text-base px-1.5 py-0.5 rounded-lg transition-all ${tone === t ? 'bg-orange-100 ring-2 ring-orange-400' : 'hover:bg-gray-100'}`}
              >
                {SKIN_TONE_SAMPLES[ti]}
              </button>
            ))}
          </div>

          {/* Emoji grid */}
          <div className="grid grid-cols-8 gap-0.5 px-2 py-2 max-h-48 overflow-y-auto">
            {displayEmojis.map((e, i) => {
              const rendered = applyTone(e, tone)
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => select(e)}
                  title={e}
                  className={`text-xl p-1.5 rounded-lg hover:bg-orange-50 transition-colors leading-none ${value === rendered ? 'bg-orange-100 ring-2 ring-orange-400' : ''}`}
                >
                  {rendered}
                </button>
              )
            })}
          </div>

          {/* Custom / native input row */}
          <div className="flex gap-2 px-3 py-3 border-t border-gray-100">
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
          <div className="px-3 pb-3 text-center">
            <button
              type="button"
              onClick={() => nativeRef.current?.focus()}
              className="text-xs text-gray-400 hover:text-orange-500 transition-colors"
            >
              🌐 Open OS emoji keyboard: <span className="font-mono">⌘+Ctrl+Space</span> (Mac) · <span className="font-mono">Win+.</span> (Windows)
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
