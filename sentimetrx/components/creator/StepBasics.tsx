'use client'

import { useState } from 'react'
import type { StepProps } from '@/lib/studyDraft'
import { Input, Section, NavButtons } from './CreatorUI'
import { INDUSTRY_LABELS, INDUSTRY_DEFAULTS, type Industry } from '@/lib/industryDefaults'

// ── Skin tone modifiers ───────────────────────────────────────
const SKIN_TONES        = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}']
const SKIN_TONE_SAMPLES = ['🖐️','🖐🏻','🖐🏼','🖐🏽','🖐🏾','🖐🏿']
const SKIN_TONE_LABELS  = ['Default','Light','Medium-light','Medium','Medium-dark','Dark']

// Simple emojis that accept a Fitzpatrick skin tone modifier
const SKIN_TONE_CAPABLE = new Set([
  '👋','🤚','🖐️','✋','🖖','👌','✌️','🤞','👍','👎','✊','👊','👏','🙌',
  '🙏','💪','💅','🤳','👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓',
  '👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🙇','🤦','🤷','👮','💂','👷',
  '🕵️','🥷','👼','🎅','🤶','🦸','🦹','🧙','🧝','🧛','🧜','🧚','🤗','🫂',
])

function applyTone(emoji: string, tone: string): string {
  if (!tone || !SKIN_TONE_CAPABLE.has(emoji)) return emoji
  return emoji + tone
}

// ── Universal emojis ──────────────────────────────────────────
const UNIVERSAL_EMOJIS = [
  '🤝','👋','😊','🙏','💬','🗣️','👥','🫂','🤗','✌️','👏','🙌','💪',
  '💼','📊','🎯','🏆','⭐','🌟','💡','📈','🏅','🔬',
  '❤️','💚','💙','🧡','💜','🖤','🤍',
]

// ── Industry emoji sets ───────────────────────────────────────
const INDUSTRY_EMOJIS: Record<string, string[]> = {
  healthcare:          ['👨‍⚕️','👩‍⚕️','🧑‍⚕️','🏥','💊','🩺','🩻','💉','🩹','🧬','❤️‍🩹','🚑','🫀','🧪','🔬'],
  casual_dining:       ['👨‍🍳','👩‍🍳','🧑‍🍳','🍽️','🥂','☕','🍷','🛎️','🥘','🍝','🥗','🍻','🍾'],
  fast_food:           ['👨‍🍳','👩‍🍳','🧑‍🍳','🍔','🍕','🌮','🍟','🥤','🌯','🌭','🍿','🥪'],
  fine_dining:         ['👨‍🍳','👩‍🍳','🧑‍🍳','🍽️','🥂','🍷','🛎️','🌹','🥩','🍣','🦞','🍾','🕯️'],
  education:           ['👨‍🏫','👩‍🏫','🧑‍🏫','🎓','📚','✏️','🏫','🖊️','📖','📝','🔬','🔭','📐','🖥️'],
  higher_education:    ['👨‍🏫','👩‍🏫','🧑‍🏫','👨‍🎓','👩‍🎓','🧑‍🎓','🎓','📚','🏛️','🔬','🧪','🔭','📜','🎖️'],
  financial_services:  ['👨‍💼','👩‍💼','🧑‍💼','💰','💳','🏦','📈','🤝','💹','🏧','🪙','💵','🏢'],
  hospitality:         ['🛎️','🏨','🛏️','🔑','🧳','🍳','🛁','🏖️','☀️','🌴','🍹','🏊','🧖'],
  saas_software:       ['👨‍💻','👩‍💻','🧑‍💻','💻','🖥️','⚙️','🔧','🚀','🤖','🛠️','📡','🔐','💾','🖱️'],
  retail_ecommerce:    ['🛍️','🏪','💳','📦','🚚','🏷️','🛒','💝','🎁','📬','📱','🏬'],
  sports:              ['🏋️','⚽','🏆','🎽','🏅','🏃','⛹️','🤸','🧗','🏊','🚴','🏈','🎾','⛷️','🏒'],
  travel_tourism:      ['✈️','🗺️','🧳','🏖️','🏝️','🗼','🌍','🏔️','🚂','🛳️','🌅','🎡','🏕️','🧭'],
  hr_employee:         ['👔','🤝','👥','🏢','📋','💼','🧑‍💼','👨‍💼','👩‍💼','📊','🏅','🌱','🎯'],
  nonprofits:          ['🤝','🌍','❤️','🙏','🫂','💚','🌱','🕊️','🙌','🌈','🤲','🫶','♻️','🌻'],
  performing_arts:     ['🎭','🎬','🎵','🎤','🎪','🎩','🩰','🎻','🎸','🥁','🎺','🎷','🎼','🎟️','📽️'],
  media_entertainment: ['📺','🎮','🎬','🎙️','📻','🎧','🎥','📸','🕹️','📡','🖥️','📱','🎞️'],
  political:           ['🏛️','🗳️','⚖️','🎙️','📜','🗺️','🤝','📢','📰','🫡'],
  automotive_repair:   ['🔧','🚗','🔩','🛠️','🏎️','🚙','🪛','🔋','⛽','🛞','🧰','🔌'],
}

// ── Color presets ─────────────────────────────────────────────
const PRESETS = [
  { name: 'Ocean',  primary: '#00b4d8', gradient: 'linear-gradient(135deg,#00b4d8,#0077a8)', accent: '#00d4ff' },
  { name: 'Forest', primary: '#1a7a4a', gradient: 'linear-gradient(135deg,#1a7a4a,#0d4a2a)', accent: '#4ade80' },
  { name: 'Sunset', primary: '#e85d04', gradient: 'linear-gradient(135deg,#e85d04,#9d0208)', accent: '#ffba08' },
  { name: 'Violet', primary: '#7c3aed', gradient: 'linear-gradient(135deg,#7c3aed,#4c1d95)', accent: '#a78bfa' },
  { name: 'Rose',   primary: '#e11d48', gradient: 'linear-gradient(135deg,#e11d48,#9f1239)', accent: '#fb7185' },
  { name: 'Slate',  primary: '#475569', gradient: 'linear-gradient(135deg,#475569,#1e293b)', accent: '#94a3b8' },
  { name: 'Gold',   primary: '#d97706', gradient: 'linear-gradient(135deg,#d97706,#92400e)', accent: '#fbbf24' },
]

const HERMES = '#E8632A'

// ── Emoji picker ──────────────────────────────────────────────
function EmojiPicker({ currentEmoji, onSelect, onClose, industry }: { currentEmoji: string; onSelect: (e: string) => void; onClose: () => void; industry: string }) {
  const [tone,      setTone]      = useState('')
  const [filter,    setFilter]    = useState('all')
  const [customVal, setCustomVal] = useState('')

  const industrySet     = industry && industry !== 'other' ? (INDUSTRY_EMOJIS[industry] || []) : []
  const hasIndustrySet  = industrySet.length > 0

  const displayEmojis = filter === 'industry' && hasIndustrySet
    ? industrySet
    : hasIndustrySet
      ? [...industrySet, ...UNIVERSAL_EMOJIS.filter(e => !industrySet.includes(e))]
      : UNIVERSAL_EMOJIS

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-lg flex flex-col gap-3">

      {/* Skin tone row */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Skin tone</span>
        <div className="flex gap-1.5 flex-wrap">
          {SKIN_TONES.map(function(t, ti) {
            return (
              <button
                key={ti}
                type="button"
                onClick={() => setTone(t)}
                title={SKIN_TONE_LABELS[ti]}
                className={'text-xl px-2 py-1 rounded-lg border-2 transition-all ' + (tone === t ? 'border-orange-400 bg-orange-50' : 'border-transparent hover:border-gray-200')}
              >
                {SKIN_TONE_SAMPLES[ti]}
              </button>
            )
          })}
        </div>
      </div>

      {/* Filter tabs — only when industry set exists */}
      {hasIndustrySet && (
        <div className="flex gap-2 pb-2 border-b border-gray-100">
          {['industry', 'all'].map(function(f) {
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={'px-3 py-1 rounded-full text-xs font-semibold transition-all ' + (filter === f ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}
              >
                {f === 'industry' ? (INDUSTRY_LABELS[industry] + ' picks') : 'All emojis'}
              </button>
            )
          })}
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-8 gap-1 max-h-52 overflow-y-auto">
        {displayEmojis.map(function(e) {
          const rendered = applyTone(e, tone)
          return (
            <button
              key={e}
              type="button"
              onClick={() => { onSelect(rendered); onClose() }}
              title={e}
              className={'text-2xl p-1.5 rounded-lg hover:bg-orange-50 transition-colors ' + (currentEmoji === rendered ? 'bg-orange-100 ring-2 ring-orange-400' : '')}
            >
              {rendered}
            </button>
          )
        })}
      </div>

      {/* Custom input */}
      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <input
          type="text"
          value={customVal}
          onChange={e => setCustomVal(e.target.value)}
          placeholder="Or type any emoji…"
          className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 text-sm outline-none focus:border-orange-400"
          maxLength={8}
        />
        <button
          type="button"
          onClick={() => {
            const val = customVal.trim()
            if (val) { onSelect(val); onClose(); setCustomVal('') }
          }}
          className="px-3 py-1.5 rounded-lg text-sm font-medium text-white"
          style={{ background: HERMES }}
        >
          Use
        </button>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────
interface Props extends StepProps { onNext: () => void }

export default function StepBasics({ draft, update, updateConfig, onNext }: Props) {
  const theme   = draft.config.theme
  const canNext = draft.name.trim() && draft.bot_name.trim()
  const [industry,      setIndustry]      = useState<Industry>((draft as any).industry || '' as Industry)
  const [otherIndustry, setOtherIndustry] = useState((draft as any).otherIndustry || '')
  const [applied,       setApplied]       = useState(false)
  const [showPicker,    setShowPicker]    = useState(false)

  const inputCls = 'w-full px-4 py-2.5 rounded-xl text-sm text-gray-800 placeholder-gray-400 bg-white border border-gray-300 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors'

  function applyPreset(p: typeof PRESETS[0]) {
    updateConfig({
      theme: { ...theme, primaryColor: p.primary, headerGradient: p.gradient, accentColor: p.accent, botAvatarGradient: p.gradient }
    })
  }

  function applyIndustryDefaults() {
    if (!industry || industry === 'other') return
    const defaults = INDUSTRY_DEFAULTS[industry]
    updateConfig(defaults)
    ;(update as any)({ industry, otherIndustry })
    setApplied(true)
  }

  function handleBotNameChange(v: string) {
    const oldName = draft.bot_name
    update({ bot_name: v })
    if (oldName && draft.config.greeting.includes(oldName)) {
      updateConfig({ greeting: draft.config.greeting.replaceAll(oldName, v) })
    }
  }

  function handleEmojiSelect(e: string) {
    const oldEmoji = draft.bot_emoji
    update({ bot_emoji: e })
    if (oldEmoji && draft.config.greeting.includes(oldEmoji)) {
      updateConfig({ greeting: draft.config.greeting.replaceAll(oldEmoji, e) })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">Study basics</h2>
        <p className="text-gray-500 text-sm">Name your study, choose an industry, and set up your bot.</p>
      </div>

      {/* Industry */}
      <Section title="Industry" description="Select your industry and we'll pre-fill sensible defaults for all prompts, adaptive follow-ups, and psychographic questions. You can edit everything afterwards.">
        <select value={industry} onChange={e => { setIndustry(e.target.value as Industry); setApplied(false) }} className={inputCls}>
          <option value="">— Select an industry —</option>
          {(Object.keys(INDUSTRY_LABELS) as Industry[]).map(k => (
            <option key={k} value={k}>{INDUSTRY_LABELS[k]}</option>
          ))}
        </select>
        {industry === 'other' && (
          <input type="text" value={otherIndustry} onChange={e => setOtherIndustry(e.target.value)}
            placeholder="Describe your industry or context…" className={inputCls} />
        )}
        {industry && industry !== 'other' && (
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={applyIndustryDefaults} disabled={applied}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-all"
              style={{ background: applied ? '#9ca3af' : HERMES }}>
              {applied ? '✓ Defaults applied' : '✦ Apply industry defaults'}
            </button>
            {!applied && <p className="text-xs text-gray-400">Pre-fills all prompts, follow-ups &amp; psychographic questions for {INDUSTRY_LABELS[industry]}</p>}
            {applied  && <p className="text-xs text-green-600">Defaults applied — customise on the next steps</p>}
          </div>
        )}
      </Section>

      {/* Study name */}
      <Section title="Study name">
        <Input value={draft.name} onChange={v => update({ name: v })}
          placeholder="e.g. Q2 Patient Satisfaction Study"
          hint="Internal name — respondents don't see this" />
      </Section>

      {/* Bot identity */}
      <Section title="Bot name & emoji">
        <div className="flex gap-3">
          <Input value={draft.bot_name} onChange={handleBotNameChange} placeholder="e.g. Aria" className="flex-1" />
          <button type="button" onClick={() => setShowPicker(v => !v)}
            className="h-11 w-14 rounded-xl bg-white border border-gray-300 text-2xl flex items-center justify-center hover:border-orange-400 transition-colors flex-shrink-0"
            title="Pick an emoji">
            {draft.bot_emoji || '💬'}
          </button>
        </div>

        {showPicker && (
          <EmojiPicker
            currentEmoji={draft.bot_emoji || ''}
            onSelect={handleEmojiSelect}
            onClose={() => setShowPicker(false)}
            industry={industry}
          />
        )}

        <p className="text-gray-400 text-xs">
          The name and emoji respondents see in the chat.
          {industry && industry !== 'other' && INDUSTRY_EMOJIS[industry] && (
            <span className="text-orange-500"> Industry-specific emojis available — pick an industry then open the emoji picker.</span>
          )}
        </p>
      </Section>

      {/* Color theme */}
      <Section title="Color theme">
        <div className="grid grid-cols-4 gap-2 mb-3">
          {PRESETS.map(p => (
            <button key={p.name} onClick={() => applyPreset(p)}
              className={'rounded-xl p-3 text-center transition-all border-2 ' + (theme.primaryColor === p.primary ? 'border-white/70 shadow-md' : 'border-transparent hover:border-white/30')}
              style={{ background: p.gradient }}>
              <span className="text-white text-xs font-semibold drop-shadow">{p.name}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
          <span className="text-gray-700 text-sm font-semibold flex-1">Custom primary color</span>
          <span className="text-gray-400 text-xs font-mono">{theme.primaryColor || '#000000'}</span>
          <input type="color" value={theme.primaryColor || '#00b4d8'}
            onChange={e => {
              const c = e.target.value
              updateConfig({ theme: { ...theme, primaryColor: c, headerGradient: `linear-gradient(135deg,${c},${c}cc)`, accentColor: c, botAvatarGradient: `linear-gradient(135deg,${c},${c}cc)` } })
            }}
            className="w-10 h-10 rounded-lg cursor-pointer border border-gray-300 bg-white p-0.5" />
        </div>
      </Section>

      <NavButtons onNext={onNext} nextDisabled={!canNext} nextLabel="Next: Opening" />
    </div>
  )
}



