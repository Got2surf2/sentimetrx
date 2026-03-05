'use client'

import { useState } from 'react'
import type { StepProps } from '@/lib/studyDraft'
import { Input, Section, NavButtons } from './CreatorUI'
import { INDUSTRY_LABELS, INDUSTRY_DEFAULTS, type Industry } from '@/lib/industryDefaults'

const EMOJIS = ['💬','🤝','🍽️','🏨','🎭','⭐','💡','🌟','🎯','📊','🔬','💰','🏥','🌱','🎓','🏆']

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

interface Props extends StepProps { onNext: () => void }

export default function StepBasics({ draft, update, updateConfig, onNext }: Props) {
  const theme = draft.config.theme
  const canNext = draft.name.trim() && draft.bot_name.trim()
  const [industry, setIndustry] = useState<Industry>((draft as any).industry || '' as Industry)
  const [otherIndustry, setOtherIndustry] = useState((draft as any).otherIndustry || '')
  const [applied, setApplied] = useState(false)

  const applyPreset = (p: typeof PRESETS[0]) => {
    updateConfig({
      theme: {
        ...theme,
        primaryColor:      p.primary,
        headerGradient:    p.gradient,
        accentColor:       p.accent,
        botAvatarGradient: p.gradient,
      }
    })
  }

  const applyIndustryDefaults = () => {
    if (!industry || industry === 'other') return
    const defaults = INDUSTRY_DEFAULTS[industry]
    updateConfig(defaults)
    // Store industry on draft so other steps can see it
    ;(update as any)({ industry, otherIndustry })
    setApplied(true)
  }

  const inputCls = 'w-full px-4 py-2.5 rounded-xl text-sm text-gray-800 placeholder-gray-400 bg-white border border-gray-300 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors'

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">Study basics</h2>
        <p className="text-gray-500 text-sm">Name your study, choose an industry, and set up your bot.</p>
      </div>

      {/* Industry — first, so defaults can be applied before filling in other steps */}
      <Section
        title="Industry"
        description="Select your industry and we'll pre-fill sensible defaults for all prompts and psychographic questions. You can edit everything afterwards."
      >
        <select
          value={industry}
          onChange={e => { setIndustry(e.target.value as Industry); setApplied(false) }}
          className={inputCls}
        >
          <option value="">— Select an industry —</option>
          {(Object.keys(INDUSTRY_LABELS) as Industry[]).map(k => (
            <option key={k} value={k}>{INDUSTRY_LABELS[k]}</option>
          ))}
        </select>

        {industry === 'other' && (
          <input
            type="text"
            value={otherIndustry}
            onChange={e => setOtherIndustry(e.target.value)}
            placeholder="Describe your industry or context…"
            className={inputCls}
          />
        )}

        {industry && industry !== 'other' && (
          <div className="flex items-center gap-3">
            <button
              onClick={applyIndustryDefaults}
              disabled={applied}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-all"
              style={{ background: applied ? '#9ca3af' : HERMES }}
            >
              {applied ? '✓ Defaults applied' : '✦ Apply industry defaults'}
            </button>
            {!applied && (
              <p className="text-xs text-gray-400">
                Pre-fills all prompts and psychographic questions for {INDUSTRY_LABELS[industry]}
              </p>
            )}
            {applied && (
              <p className="text-xs text-green-600">
                Defaults applied — customise on the next steps
              </p>
            )}
          </div>
        )}
      </Section>

      {/* Study name */}
      <Section title="Study name">
        <Input
          value={draft.name}
          onChange={v => update({ name: v })}
          placeholder="e.g. Q2 Patient Satisfaction Study"
          hint="Internal name — respondents don't see this"
        />
      </Section>

      {/* Bot identity */}
      <Section title="Bot name & emoji">
        <div className="flex gap-3">
          <Input
            value={draft.bot_name}
            onChange={v => update({ bot_name: v })}
            placeholder="e.g. Aria"
            className="flex-1"
          />
          <select
            value={draft.bot_emoji}
            onChange={e => update({ bot_emoji: e.target.value })}
            className="h-11 px-3 rounded-xl bg-white border border-gray-300 text-xl outline-none focus:border-orange-400 transition-colors cursor-pointer flex-shrink-0"
          >
            {EMOJIS.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <p className="text-gray-400 text-xs">The name and emoji respondents see in the chat.</p>
      </Section>

      {/* Color theme */}
      <Section title="Color theme">
        <div className="grid grid-cols-4 gap-2 mb-3">
          {PRESETS.map(p => (
            <button
              key={p.name}
              onClick={() => applyPreset(p)}
              className={`rounded-xl p-3 text-center transition-all border-2 ${
                theme.primaryColor === p.primary ? 'border-white/70 shadow-md' : 'border-transparent hover:border-white/30'
              }`}
              style={{ background: p.gradient }}
            >
              <span className="text-white text-xs font-semibold drop-shadow">{p.name}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
          <span className="text-gray-700 text-sm font-semibold flex-1">Custom primary color</span>
          <span className="text-gray-400 text-xs font-mono">{theme.primaryColor || '#000000'}</span>
          <input
            type="color"
            value={theme.primaryColor || '#00b4d8'}
            onChange={e => {
              const c = e.target.value
              updateConfig({
                theme: { ...theme, primaryColor: c, headerGradient: `linear-gradient(135deg,${c},${c}cc)`, accentColor: c, botAvatarGradient: `linear-gradient(135deg,${c},${c}cc)` }
              })
            }}
            className="w-10 h-10 rounded-lg cursor-pointer border border-gray-300 bg-white p-0.5"
          />
        </div>
      </Section>

      <NavButtons onNext={onNext} nextDisabled={!canNext} nextLabel="Next: Opening" />
    </div>
  )
}
