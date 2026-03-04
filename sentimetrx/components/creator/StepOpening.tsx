'use client'

import type { StepProps } from '@/lib/studyDraft'
import { Field, Input, Section, NavButtons } from './CreatorUI'
import type { RatingOption } from '@/lib/types'

const EMOJI_OPTIONS = ['😞','😕','😐','😊','😍','🤷','👀','📖','👍','❤️','⭐','💔','😡','😢','😄','🎉','👎','👌','🙌','💪']

interface Props extends StepProps { onNext: () => void; onBack: () => void }

export default function StepOpening({ draft, updateConfig, onNext, onBack }: Props) {
  const c = draft.config
  const canNext = c.greeting.trim() && c.ratingPrompt.trim() &&
    c.ratingScale.every(r => r.emoji && r.label)

  const updateScale = (idx: number, field: keyof RatingOption, value: string | number) => {
    const next = c.ratingScale.map((r, i) => i === idx ? { ...r, [field]: value } : r)
    updateConfig({ ratingScale: next })
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Opening</h2>
        <p className="text-slate-400 text-sm">How the bot introduces itself and the first rating question.</p>
      </div>

      <Section
        title="Greeting message"
        description="The very first thing the bot says. Keep it friendly and brief."
      >
        <Input
          value={c.greeting}
          onChange={v => updateConfig({ greeting: v })}
          placeholder={`Hi there — I'm ${draft.bot_name || 'your bot'} 👋 I'm here to collect your feedback. It'll only take a few minutes!`}
          multiline
          rows={3}
        />
      </Section>

      <Section
        title="Opening rating question"
        description="Asks respondents to rate their experience before the conversation begins."
      >
        <Input
          value={c.ratingPrompt}
          onChange={v => updateConfig({ ratingPrompt: v })}
          placeholder="How would you rate your overall experience with us today?"
        />
        <Field label="CSV export column name (optional)">
          <Input
            value={c.q1ExportLabel || ''}
            onChange={v => updateConfig({ q1ExportLabel: v })}
            placeholder="e.g. Opening Rating — leave blank to use the question text"
          />
        </Field>
      </Section>

      <Section
        title="Rating scale"
        description="Five options from worst to best. Edit the emoji and label for each."
      >
        <div className="flex flex-col gap-2">
          {c.ratingScale.map((r, i) => (
            <div key={i} className="flex items-center gap-3 bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3">
              <span className="text-slate-500 text-xs font-bold w-4 flex-shrink-0">{r.score}</span>
              <select
                value={r.emoji}
                onChange={e => updateScale(i, 'emoji', e.target.value)}
                className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-lg outline-none focus:border-cyan-500 cursor-pointer flex-shrink-0"
              >
                {EMOJI_OPTIONS.map(e => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
              <input
                type="text"
                value={r.label}
                onChange={e => updateScale(i, 'label', e.target.value)}
                placeholder={`Score ${r.score} label`}
                className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none border-b border-slate-700 focus:border-cyan-500 pb-0.5 transition-colors"
              />
            </div>
          ))}
        </div>
        <p className="text-slate-500 text-xs px-1">
          Score 1 = worst, Score 5 = best. Labels appear below each emoji in the survey.
        </p>
      </Section>

      <NavButtons
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!canNext}
        nextLabel="Next: Conversation"
      />
    </div>
  )
}
