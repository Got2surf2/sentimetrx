'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { StepProps } from '@/lib/studyDraft'
import { Input, Section, NavButtons } from './CreatorUI'
import { INDUSTRY_LABELS, INDUSTRY_DEFAULTS, type Industry } from '@/lib/industryDefaults'
import EmojiPickerPopover from './EmojiPickerPopover'

const HERMES = '#E8632A'

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


// ── Main ──────────────────────────────────────────────────────
interface Props extends StepProps { onNext: () => void }

export default function StepBasics({ draft, update, updateConfig, onNext }: Props) {
  const theme   = draft.config.theme
  const canNext = draft.name.trim() && draft.bot_name.trim()
  const presetIndustry = (draft.config.industry || (draft as any).industry || '') as Industry | ''
  const [industry,      setIndustry]      = useState<Industry>(presetIndustry || '' as Industry)
  const [otherIndustry, setOtherIndustry] = useState(draft.config.otherIndustry || (draft as any).otherIndustry || '')
  const [applied,       setApplied]       = useState(!!presetIndustry)
  const isEditing = !!presetIndustry   // true when editing an existing study

  // ── Slug (custom URL) ──────────────────────────────────────
  const [slugInput,    setSlugInput]    = useState(draft.slug || '')
  const [slugStatus,   setSlugStatus]   = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle')
  const slugTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)

  const checkSlug = useCallback((val: string) => {
    if (slugTimer.current) clearTimeout(slugTimer.current)
    const clean = val.toLowerCase().trim()
    if (!clean) { setSlugStatus('idle'); return }
    if (clean.length < 3 || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(clean)) {
      setSlugStatus('invalid'); return
    }
    setSlugStatus('checking')
    slugTimer.current = setTimeout(async () => {
      try {
        const studyId = draft.id || ''
        const res = await fetch(`/api/studies/check-slug?slug=${encodeURIComponent(clean)}&exclude=${studyId}`)
        const data = await res.json()
        setSlugStatus(data.available ? 'available' : 'taken')
      } catch { setSlugStatus('idle') }
    }, 400)
  }, [draft])

  const handleSlugChange = (val: string) => {
    const clean = slugify(val)
    setSlugInput(clean)
    update({ slug: clean || undefined })
    checkSlug(clean)
  }

  const handleSlugBlur = () => {
    // Auto-suggest from study name if empty
    if (!slugInput && draft.name.trim()) {
      const suggested = slugify(draft.name)
      if (suggested.length >= 3) {
        setSlugInput(suggested)
        update({ slug: suggested })
        checkSlug(suggested)
      }
    }
  }

  const inputCls = 'w-full px-4 py-2.5 rounded-xl text-sm text-gray-800 placeholder-gray-400 bg-white border border-gray-300 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors'

  function applyPreset(p: typeof PRESETS[0]) {
    updateConfig({
      theme: { ...theme, primaryColor: p.primary, headerGradient: p.gradient, accentColor: p.accent, botAvatarGradient: p.gradient }
    })
  }

  function applyIndustryDefaults() {
    if (!industry || industry === 'other') return
    const defaults = INDUSTRY_DEFAULTS[industry as Exclude<Industry, 'other'>]
    updateConfig({ ...defaults, industry, otherIndustry })
    setApplied(true)
  }

  function handleIndustrySelect(val: Industry) {
    setIndustry(val)
    setApplied(false)
    // Save selection immediately into config so it persists even without applying defaults
    updateConfig({ industry: val })
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
        {/* Show badge when industry is already set (editing existing study) */}
        {applied && industry && industry !== 'other' && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-xl px-4 py-2.5">
              <span className="text-orange-500 font-bold text-sm">✦</span>
              <span className="text-sm font-semibold text-gray-800">{INDUSTRY_LABELS[industry as Industry]}</span>
              <span className="text-xs text-orange-500 bg-orange-100 px-2 py-0.5 rounded-full">Industry set</span>
            </div>
            <button
              type="button"
              onClick={() => setApplied(false)}
              className="text-xs text-gray-400 hover:text-gray-600 underline transition-colors"
            >
              Change industry
            </button>
          </div>
        )}

        {/* Industry selector — shown when not yet set or changing */}
        {!applied && isEditing && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
            <span className="text-amber-500 text-sm">⚠</span>
            <span className="text-xs text-amber-700 font-medium">Changing industry and re-applying defaults will overwrite your current prompts and questions.</span>
          </div>
        )}
        {!applied && (
          <>
            <select value={industry} onChange={e => handleIndustrySelect(e.target.value as Industry)} className={inputCls}>
              <option value="">— Select an industry —</option>
              {(Object.keys(INDUSTRY_LABELS) as Industry[]).sort((a, b) => INDUSTRY_LABELS[a].localeCompare(INDUSTRY_LABELS[b])).map(k => (
                <option key={k} value={k}>{INDUSTRY_LABELS[k]}</option>
              ))}
            </select>
            {industry === 'other' && (
              <input type="text" value={otherIndustry} onChange={e => setOtherIndustry(e.target.value)}
                placeholder="Describe your industry or context…" className={inputCls} />
            )}
            {industry && industry !== 'other' && (
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={applyIndustryDefaults}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all"
                  style={{ background: HERMES }}>
                  ✦ Apply industry defaults
                </button>
                <p className="text-xs text-gray-400">Pre-fills all prompts, follow-ups &amp; psychographic questions for {INDUSTRY_LABELS[industry as Industry]}</p>
              </div>
            )}
          </>
        )}
      </Section>

      {/* Study name */}
      <Section title="Study name">
        <Input value={draft.name} onChange={v => update({ name: v })}
          placeholder="e.g. Q2 Patient Satisfaction Study"
          hint="Internal name — respondents don't see this" />
      </Section>

      {/* Custom URL */}
      <Section title="Custom survey URL" description="Give your survey a short, memorable link. Leave blank to use the default.">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-0 rounded-xl border border-gray-300 overflow-hidden bg-white focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-100 transition-all">
            <span className="px-3 py-2.5 text-sm text-gray-400 bg-gray-50 border-r border-gray-200 whitespace-nowrap flex-shrink-0">sentimetrx.ai/s/</span>
            <input
              value={slugInput}
              onChange={e => handleSlugChange(e.target.value)}
              onBlur={handleSlugBlur}
              placeholder="your-survey-name"
              className="flex-1 px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent min-w-0"
              spellCheck={false}
              autoComplete="off"
            />
            {slugStatus === 'checking' && <span className="px-3 text-gray-400 text-xs animate-pulse">checking...</span>}
            {slugStatus === 'available' && <span className="px-3 text-green-500 text-sm font-bold">{'\u2713'}</span>}
            {slugStatus === 'taken' && <span className="px-3 text-red-500 text-xs font-semibold">taken</span>}
            {slugStatus === 'invalid' && <span className="px-3 text-amber-500 text-xs font-semibold">3+ chars</span>}
          </div>
          {slugInput && slugStatus === 'available' && (
            <p className="text-xs text-green-600">
              {'\u2713'} Your survey will be available at <strong>sentimetrx.ai/s/{slugInput}</strong>
            </p>
          )}
          {!slugInput && (
            <p className="text-xs text-gray-400">The default UUID link will always work too.</p>
          )}
        </div>
      </Section>

      {/* Bot identity */}
      <Section title="Bot name & emoji">
        <div className="flex gap-3 items-center">
          <Input value={draft.bot_name} onChange={handleBotNameChange} placeholder="e.g. Aria" className="flex-1" />
          <EmojiPickerPopover
            value={draft.bot_emoji || '💬'}
            onChange={handleEmojiSelect}
            industryEmojis={industry && industry !== 'other' ? (INDUSTRY_EMOJIS[industry] || undefined) : undefined}
            industryLabel={industry && industry !== 'other' ? (INDUSTRY_LABELS[industry as Industry] || undefined) : undefined}
            size="md"
          />
        </div>
        <p className="text-gray-400 text-xs">The name and emoji respondents see in the chat.</p>
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

      <Section title="Response limits" description="Control whether respondents can submit more than once from the same device.">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => updateConfig({ allowMultipleResponses: !draft.config.allowMultipleResponses })}
            className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 border-2 border-transparent ${draft.config.allowMultipleResponses ? 'bg-orange-500' : 'bg-gray-200'}`}
          >
            <span className={`inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ${draft.config.allowMultipleResponses ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
          <span className="text-sm text-gray-600">
            {draft.config.allowMultipleResponses
              ? <><strong className="text-gray-800">Multiple responses allowed</strong> — same device can submit again</>
              : <><strong className="text-gray-800">One response per device</strong> — prevents duplicate submissions</>}
          </span>
        </div>
      </Section>

      <Section title="Branding" description="Control the 'by' label shown in the survey header.">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => updateConfig({ showBranding: draft.config.showBranding === false ? true : false })}
            className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 border-2 border-transparent ${draft.config.showBranding !== false ? 'bg-orange-500' : 'bg-gray-200'}`}
          >
            <span className={`inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ${draft.config.showBranding !== false ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
          <span className="text-sm text-gray-600">
            {draft.config.showBranding !== false
              ? <><strong className="text-gray-800">Branding visible</strong> — shows &ldquo;by {draft.config.brandingLabel || 'DATANAUTIX'}&rdquo; in header</>
              : <><strong className="text-gray-800">Branding hidden</strong></>}
          </span>
        </div>
        {draft.config.showBranding !== false && (
          <div className="flex flex-col gap-1.5 mt-2">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Label (max 15 characters)</label>
            <input
              value={draft.config.brandingLabel ?? 'DATANAUTIX'}
              onChange={e => updateConfig({ brandingLabel: e.target.value.slice(0, 15) })}
              placeholder="DATANAUTIX"
              maxLength={15}
              className="w-full max-w-xs px-3 py-2 rounded-lg bg-white border border-gray-300 text-gray-800 text-sm placeholder-gray-400 outline-none focus:border-orange-400 transition-colors"
            />
          </div>
        )}
      </Section>

      <Section title="Survey font size" description="Set the base text size for respondents. Larger sizes improve readability for older audiences.">
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { value: 14, label: 'Small', desc: '14px' },
            { value: 16, label: 'Normal', desc: '16px' },
            { value: 18, label: 'Large', desc: '18px — default' },
            { value: 20, label: 'X-Large', desc: '20px' },
            { value: 22, label: 'XX-Large', desc: '22px' },
          ].map(function(opt) {
            var current = draft.config.surveyFontSize || 18
            var active = current === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={function() { updateConfig({ surveyFontSize: opt.value }) }}
                className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl transition-all"
                style={{
                  background: active ? '#fff4ef' : '#f9fafb',
                  border: '1.5px solid ' + (active ? '#e8622a' : '#e5e7eb'),
                  cursor: 'pointer',
                  minWidth: 64,
                }}
              >
                <span className="font-bold" style={{ fontSize: opt.value, lineHeight: 1.2, color: active ? '#e8622a' : '#374151' }}>Aa</span>
                <span className="text-xs" style={{ color: active ? '#e8622a' : '#6b7280', fontWeight: active ? 600 : 400 }}>{opt.label}</span>
              </button>
            )
          })}
        </div>
        <p className="text-xs text-gray-400 mt-1">
          Preview: all survey text will render at {draft.config.surveyFontSize || 18}px base size
        </p>
      </Section>

      <NavButtons onNext={onNext} nextDisabled={!canNext} nextLabel="Next: Opening" />
    </div>
  )
}
