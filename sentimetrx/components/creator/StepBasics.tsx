'use client'

import type { StepProps } from '@/lib/studyDraft'
import { Field, Label, Input, Section, NavButtons } from './CreatorUI'

const EMOJIS = ['💬','🤝','🍽️','🏨','🎭','⭐','💡','🌟','🎯','📊','🔬','💰','🏥','🌱','🎓','🏆']

const PRESETS = [
  { name: 'Ocean',    primary: '#00b4d8', gradient: 'linear-gradient(135deg,#00b4d8,#0077a8)', accent: '#00d4ff' },
  { name: 'Forest',   primary: '#1a7a4a', gradient: 'linear-gradient(135deg,#1a7a4a,#0d4a2a)', accent: '#4ade80' },
  { name: 'Sunset',   primary: '#e85d04', gradient: 'linear-gradient(135deg,#e85d04,#9d0208)', accent: '#ffba08' },
  { name: 'Violet',   primary: '#7c3aed', gradient: 'linear-gradient(135deg,#7c3aed,#4c1d95)', accent: '#a78bfa' },
  { name: 'Rose',     primary: '#e11d48', gradient: 'linear-gradient(135deg,#e11d48,#9f1239)', accent: '#fb7185' },
  { name: 'Slate',    primary: '#475569', gradient: 'linear-gradient(135deg,#475569,#1e293b)', accent: '#94a3b8' },
  { name: 'Gold',     primary: '#d97706', gradient: 'linear-gradient(135deg,#d97706,#92400e)', accent: '#fbbf24' },
  { name: 'Custom',   primary: '',        gradient: '',                                         accent: '' },
]

interface Props extends StepProps { onNext: () => void }

export default function StepBasics({ draft, update, updateConfig, onNext }: Props) {
  const theme = draft.config.theme

  const canNext = draft.name.trim() && draft.bot_name.trim()

  const applyPreset = (p: typeof PRESETS[0]) => {
    if (p.name === 'Custom') return
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

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Study basics</h2>
        <p className="text-slate-400 text-sm">Name your study and set up the bot identity.</p>
      </div>

      <Section title="Study name">
        <Input
          value={draft.name}
          onChange={v => update({ name: v })}
          placeholder="e.g. Coalition Donor Feedback 2026"
          hint="Internal name — respondents don't see this"
        />
      </Section>

      <Section title="Bot name & emoji">
        <div className="flex gap-3">
          <Input
            value={draft.bot_name}
            onChange={v => update({ bot_name: v })}
            placeholder="e.g. Charity"
            className="flex-1"
          />
          <div className="flex-shrink-0">
            <select
              value={draft.bot_emoji}
              onChange={e => update({ bot_emoji: e.target.value })}
              className="h-11 px-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-xl outline-none focus:border-cyan-500 transition-colors cursor-pointer"
            >
              {EMOJIS.map(e => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-slate-500 text-xs mt-1.5">The name and emoji respondents will see in the chat.</p>
      </Section>

      <Section title="Color theme">
        <div className="grid grid-cols-4 gap-2 mb-3">
          {PRESETS.filter(p => p.name !== 'Custom').map(p => (
            <button
              key={p.name}
              onClick={() => applyPreset(p)}
              className={`rounded-xl p-3 text-center transition-all border-2 ${
                theme.primaryColor === p.primary
                  ? 'border-white/60'
                  : 'border-transparent hover:border-white/20'
              }`}
              style={{ background: p.gradient }}
            >
              <span className="text-white text-xs font-medium">{p.name}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-3 items-center">
          <Label>Custom primary color</Label>
          <input
            type="color"
            value={theme.primaryColor || '#00b4d8'}
            onChange={e => {
              const c = e.target.value
              updateConfig({
                theme: {
                  ...theme,
                  primaryColor:      c,
                  headerGradient:    `linear-gradient(135deg, ${c}, ${c}cc)`,
                  accentColor:       c,
                  botAvatarGradient: `linear-gradient(135deg, ${c}, ${c}cc)`,
                }
              })
            }}
            className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent"
          />
        </div>
      </Section>

      <NavButtons
        onNext={onNext}
        nextDisabled={!canNext}
        nextLabel="Next: Opening"
      />
    </div>
  )
}
