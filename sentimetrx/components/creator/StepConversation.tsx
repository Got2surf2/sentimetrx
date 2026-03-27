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

function Toggle({ on, onToggle, labelOn, labelOff }: { on: boolean; onToggle: () => void; labelOn: string; labelOff: string }) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onToggle}
        className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 border-2 border-transparent ${on ? 'bg-orange-500' : 'bg-gray-200'}`}
      >
        <span className={`inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ${on ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
      <span className="text-sm text-gray-600">
        {on ? <><strong className="text-gray-800">{labelOn}</strong></> : <><strong className="text-gray-800">{labelOff}</strong></>}
      </span>
    </div>
  )
}


export default function StepConversation({ draft, updateConfig, onNext, onBack }: Props) {
  const c = draft.config
  const q3On = c.q3Enabled !== false  // default true
  const q4On = c.q4Enabled !== false  // default true

  // Can proceed if at least one question is enabled and has text, or both are disabled
  const canNext = (!q3On && !q4On) || (q3On && c.q3.trim()) || (q4On && c.q4.trim())

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">Conversation</h2>
        <p className="text-gray-500 text-sm">The questions the bot asks after the initial rating. Toggle each question on or off.</p>
      </div>

      <Section title="Second question (Q3)" description="Asked after the first follow-up. Usually a broader or deeper question.">
        <Toggle
          on={q3On}
          onToggle={() => updateConfig({ q3Enabled: !q3On })}
          labelOn="Enabled — this question will be asked"
          labelOff="Disabled — this question will be skipped"
        />
        {q3On && (
          <>
            <Input value={c.q3} onChange={v => updateConfig({ q3: v })}
              placeholder="Is there anything specific you think we should do differently?"
              multiline rows={2} />
            <ExportLabelField
              value={c.q3ExportLabel || ''}
              onChange={v => updateConfig({ q3ExportLabel: v })}
              placeholder="Label for this column in exports — e.g. Improvement Suggestion"
            />
            <div className="flex items-center gap-6 flex-wrap">
              <Toggle
                on={c.q3Required !== false}
                onToggle={() => updateConfig({ q3Required: c.q3Required === false ? undefined : false })}
                labelOn="Required"
                labelOff="Optional"
              />
              <Toggle
                on={!!c.q3Clarify}
                onToggle={() => updateConfig({ q3Clarify: !c.q3Clarify })}
                labelOn="Clarifier on — bot may ask a follow-up"
                labelOff="No clarifier"
              />
            </div>
          </>
        )}
      </Section>

      <Section title="Third question (Q4)" description="The final open-ended question before psychographic questions.">
        <Toggle
          on={q4On}
          onToggle={() => updateConfig({ q4Enabled: !q4On })}
          labelOn="Enabled — this question will be asked"
          labelOff="Disabled — this question will be skipped"
        />
        {q4On && (
          <>
            <Input value={c.q4} onChange={v => updateConfig({ q4: v })}
              placeholder="Is there anything else you'd like us to know?"
              multiline rows={2} />
            <ExportLabelField
              value={c.q4ExportLabel || ''}
              onChange={v => updateConfig({ q4ExportLabel: v })}
              placeholder="Label for this column in exports — e.g. Additional Comments"
            />
            <div className="flex items-center gap-6 flex-wrap">
              <Toggle
                on={c.q4Required === true}
                onToggle={() => updateConfig({ q4Required: c.q4Required === true ? undefined : true })}
                labelOn="Required"
                labelOff="Optional"
              />
              <Toggle
                on={!!c.q4Clarify}
                onToggle={() => updateConfig({ q4Clarify: !c.q4Clarify })}
                labelOn="Clarifier on — bot may ask a follow-up"
                labelOff="No clarifier"
              />
            </div>
          </>
        )}
      </Section>

      <NavButtons onBack={onBack} onNext={onNext} nextDisabled={!canNext} nextLabel="Next: Clarifiers" />
    </div>
  )
}
