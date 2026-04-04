'use client'

import type { StepProps } from '@/lib/studyDraft'
import { Field, Input, Section, NavButtons } from './CreatorUI'

interface Props extends StepProps { onNext: () => void; onBack: () => void }

export default function StepClarifiers({ draft, updateConfig, onNext, onBack }: Props) {
  const c = draft.config

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">Clarifiers</h2>
        <p className="text-gray-500 text-sm">
          When a respondent gives a short or vague answer the bot probes for more detail.
          Per-question keyword triggers are configured on each open-ended question in the question bank.
        </p>
      </div>

      {/* AI mode toggle */}
      <Section title="Follow-up mode">
        <div className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-800">AI-powered follow-ups</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Use Claude to generate intelligent, contextual clarifying questions based on study context, sentiment, and prior answers
            </div>
          </div>
          <button
            type="button"
            onClick={() => updateConfig({ useAIClarify: !c.useAIClarify })}
            className={'relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-4 border-2 border-transparent ' + (c.useAIClarify ? 'bg-orange-500' : 'bg-gray-200')}
          >
            <span className={'inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ' + (c.useAIClarify ? 'translate-x-5' : 'translate-x-0')} />
          </button>
        </div>
        {c.useAIClarify && (
          <p className="text-xs text-orange-600 px-1">✦ AI will generate contextual follow-ups. The default fallback is used when AI is unavailable.</p>
        )}
      </Section>

      {/* Default clarifier */}
      <Section
        title="Default fallback"
        description="Used when no per-question keyword trigger fires or AI is disabled."
      >
        <Field label="Fallback question">
          <Input
            value={c.clarifiers.default}
            onChange={v => updateConfig({ clarifiers: { ...c.clarifiers, default: v } })}
            placeholder="Could you tell me a little more about that?"
          />
        </Field>
        {!c.clarifiers.default.trim() && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => updateConfig({ clarifiers: { ...c.clarifiers, default: 'Could you tell me a little more about that?' } })}
              className="text-xs font-semibold text-orange-500 hover:text-orange-600 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              ↺ Use suggested
            </button>
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
              ⚠ Required — grayed text is a suggestion only
            </span>
          </div>
        )}
      </Section>

      <NavButtons onBack={onBack} onNext={onNext} nextDisabled={!c.clarifiers.default.trim()} nextLabel="Next: Custom Questions" />
    </div>
  )
}
