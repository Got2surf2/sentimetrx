'use client'

import type { StepProps } from '@/lib/studyDraft'
import { Input, Section, NavButtons } from './CreatorUI'
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
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">Opening</h2>
        <p className="text-gray-500 text-sm">How the bot introduces itself and presents the first rating question.</p>
      </div>

      <Section title="Greeting message" description="The very first thing the bot says. Keep it friendly and brief.">
        <Input
          value={c.greeting}
          onChange={v => updateConfig({ greeting: v })}
          placeholder={`Hi there — I'm ${draft.bot_name || 'your bot'} 👋 I'm here to collect your feedback. It'll only take a few minutes!`}
          multiline
          rows={3}
        />
      </Section>

      <Section title="NPS question" description="Shown first -- asks how likely respondents are to recommend you. The label appears on dashboard cards and in CSV exports.">
        <div className="flex gap-3 items-start">
          <div className="flex-1">
            <Input
              value={c.npsPrompt || ''}
              onChange={v => updateConfig({ npsPrompt: v })}
              placeholder="How likely are you to recommend us to a friend or someone you know?"
              multiline
              rows={2}
            />
          </div>
          <div className="flex-shrink-0 w-28">
            <label className="block text-xs font-medium text-gray-500 mb-1">Dashboard label</label>
            <input
              type="text"
              value={c.npsLabel || ''}
              onChange={e => updateConfig({ npsLabel: e.target.value })}
              placeholder="NPS"
              maxLength={20}
              className="w-full px-3 py-2 rounded-xl text-sm text-gray-800 placeholder-gray-400 bg-white border border-gray-300 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors"
            />
          </div>
        </div>
        <p className="text-gray-400 text-xs px-1">Default label is "NPS". Change it to match your context e.g. "Likelihood" or "Would Refer".</p>
      </Section>

      <Section title="Experience rating question" description="Shown after NPS -- asks respondents to rate their experience.">
        <Input
          value={c.ratingPrompt}
          onChange={v => updateConfig({ ratingPrompt: v })}
          placeholder="How would you rate your overall experience with us today?"
          multiline
          rows={2}
        />
      </Section>

      <Section title="Rating scale" description="Five options from worst to best. Edit the emoji and label for each.">
        <div className="flex flex-col gap-2">
          {c.ratingScale.map((r, i) => (
            <div key={i} className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
              <span className="text-gray-400 text-xs font-bold w-4 flex-shrink-0">{r.score}</span>
              <select
                value={r.emoji}
                onChange={e => updateScale(i, 'emoji', e.target.value)}
                className="bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-lg outline-none focus:border-orange-400 cursor-pointer flex-shrink-0"
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
                className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none border-b border-gray-300 focus:border-orange-400 pb-0.5 transition-colors"
              />
            </div>
          ))}
        </div>
        <p className="text-gray-400 text-xs px-1">Score 1 = worst, Score 5 = best. Labels appear below each emoji in the survey.</p>
      </Section>

      <NavButtons onBack={onBack} onNext={onNext} nextDisabled={!canNext} nextLabel="Next: Conversation" />
    </div>
  )
}
