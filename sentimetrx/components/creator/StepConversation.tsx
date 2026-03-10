'use client'

import { useState } from 'react'
import type { StepProps } from '@/lib/studyDraft'
import { Field, Input, Section, NavButtons } from './CreatorUI'

interface Props extends StepProps { onNext: () => void; onBack: () => void }

function ExportLabelField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <Field label="CSV export column name (optional)">
      <Input value={value} onChange={onChange} placeholder={placeholder} />
    </Field>
  )
}


export default function StepConversation({ draft, updateConfig, onNext, onBack }: Props) {
  const c = draft.config
  const canNext = c.q3.trim() && c.q4.trim()

  const inputCls = 'w-full px-3 py-2 rounded-lg bg-white border border-gray-300 text-gray-800 text-sm placeholder-gray-400 outline-none focus:border-orange-400 transition-colors'

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">Conversation</h2>
        <p className="text-gray-500 text-sm">The questions the bot asks after the initial rating.</p>
      </div>

      <Section title="Second question (Q3)" description="Asked after the first follow-up. Usually a broader or deeper question.">
        <Input value={c.q3} onChange={v => updateConfig({ q3: v })}
          placeholder="Is there anything specific you think we should do differently?"
          multiline rows={2} />
        <ExportLabelField
          value={c.q3ExportLabel || ''}
          onChange={v => updateConfig({ q3ExportLabel: v })}
          placeholder="Label for this column in exports — e.g. Improvement Suggestion"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => updateConfig({ q3Required: c.q3Required === false ? undefined : false })}
            className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 border-2 border-transparent ${c.q3Required !== false ? 'bg-orange-500' : 'bg-gray-200'}`}
          >
            <span className={`inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ${c.q3Required !== false ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
          <span className="text-sm text-gray-600">
            {c.q3Required !== false ? <><strong className="text-gray-800">Required</strong> — respondents must answer</> : <><strong className="text-gray-800">Optional</strong> — respondents can skip</>}
          </span>
        </div>
      </Section>

      <Section title="Third question (Q4)" description="The final open-ended question before psychographic questions.">
        <Input value={c.q4} onChange={v => updateConfig({ q4: v })}
          placeholder="Is there anything else you'd like us to know?"
          multiline rows={2} />
        <ExportLabelField
          value={c.q4ExportLabel || ''}
          onChange={v => updateConfig({ q4ExportLabel: v })}
          placeholder="Label for this column in exports — e.g. Additional Comments"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => updateConfig({ q4Required: c.q4Required === true ? undefined : true })}
            className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 border-2 border-transparent ${c.q4Required === true ? 'bg-orange-500' : 'bg-gray-200'}`}
          >
            <span className={`inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ${c.q4Required === true ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
          <span className="text-sm text-gray-600">
            {c.q4Required === true ? <><strong className="text-gray-800">Required</strong> — respondents must answer</> : <><strong className="text-gray-800">Optional</strong> — respondents can skip</>}
          </span>
        </div>
      </Section>

      <NavButtons onBack={onBack} onNext={onNext} nextDisabled={!canNext} nextLabel="Next: Clarifiers" />
    </div>
  )
}
