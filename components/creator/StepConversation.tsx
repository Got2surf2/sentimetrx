'use client'

import { useState, useRef } from 'react'
import type { StepProps } from '@/lib/studyDraft'
import { Field, Input, Section, NavButtons } from './CreatorUI'
import type { SurveyQuestion } from '@/lib/types'

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


function ClarifyDepthPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-600">Follow-ups while answer stays vague</span>
      <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
        {[1, 2, 3].map(n => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`px-3 py-1 text-sm font-semibold transition-colors ${value === n ? 'bg-orange-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'} ${n > 1 ? 'border-l border-gray-200' : ''}`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}

function newConvQuestion(type: 'open' | 'radio' | 'checkbox'): SurveyQuestion {
  const id = 'cq_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  return { id, type, prompt: '', exportLabel: '', conversationPosition: true, ...(type !== 'open' ? { options: ['', ''] } : {}) }
}

const inputCls = 'w-full px-4 py-2.5 rounded-xl text-sm text-gray-800 placeholder-gray-400 bg-white border border-gray-300 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors'
const labelCls = 'block text-xs font-semibold text-gray-600 mb-1'

export default function StepConversation({ draft, updateConfig, onNext, onBack }: Props) {
  const c = draft.config
  const q3On = c.q3Enabled !== false  // default true
  const q4On = c.q4Enabled !== false  // default true
  const [showTypePicker, setShowTypePicker] = useState(false)
  const dragConvIdx = useRef<number | null>(null)

  const convExtras = (c.questions ?? []).filter(q => q.conversationPosition)
  const otherQuestions = (c.questions ?? []).filter(q => !q.conversationPosition)

  function setConvExtras(next: SurveyQuestion[]) {
    updateConfig({ questions: [...otherQuestions, ...next] })
  }

  function updateConvQuestion(id: string, patch: Partial<SurveyQuestion>) {
    setConvExtras(convExtras.map(q => q.id === id ? { ...q, ...patch } : q))
  }

  function removeConvQuestion(id: string) {
    setConvExtras(convExtras.filter(q => q.id !== id))
  }

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
              multiline rows={2} enableLinks />
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
              {c.q3Clarify && (
                <ClarifyDepthPicker
                  value={c.q3ClarifyDepth || 1}
                  onChange={n => updateConfig({ q3ClarifyDepth: n })}
                />
              )}
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
              multiline rows={2} enableLinks />
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
              {c.q4Clarify && (
                <ClarifyDepthPicker
                  value={c.q4ClarifyDepth || 1}
                  onChange={n => updateConfig({ q4ClarifyDepth: n })}
                />
              )}
            </div>
          </>
        )}
      </Section>

      {/* Conversation extras */}
      <Section title="Conversation extras (optional)" description="Additional questions shown after Q4, before psychographics. Use for categorical or follow-up questions in the chat flow.">
        <div className="flex flex-col gap-3">
          {convExtras.length === 0 && (
            <p className="text-xs text-gray-400 italic">No extras added yet.</p>
          )}
          {convExtras.map((q, idx) => (
            <div
              key={q.id}
              draggable
              onDragStart={() => { dragConvIdx.current = idx }}
              onDragOver={(e) => {
                e.preventDefault()
                if (dragConvIdx.current === null || dragConvIdx.current === idx) return
                const next = [...convExtras]
                const [moved] = next.splice(dragConvIdx.current, 1)
                next.splice(idx, 0, moved)
                dragConvIdx.current = idx
                setConvExtras(next)
              }}
              onDragEnd={() => { dragConvIdx.current = null }}
              className="border border-gray-200 rounded-xl p-4 bg-white flex flex-col gap-3"
            >
              <div className="flex items-center gap-2">
                <span className="text-gray-300 cursor-grab select-none text-lg leading-none" title="Drag to reorder">⠿</span>
                <span className="text-xs font-semibold text-orange-500 bg-orange-50 px-2 py-0.5 rounded-full">
                  {q.type === 'open' ? 'Open-ended' : q.type === 'radio' ? 'Single choice' : 'Multi-select'}
                </span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => removeConvQuestion(q.id)}
                  className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
                >
                  Remove
                </button>
              </div>
              <div>
                <label className={labelCls}>Question prompt</label>
                <textarea
                  value={q.prompt}
                  onChange={e => updateConvQuestion(q.id, { prompt: e.target.value })}
                  placeholder="Enter your question..."
                  rows={2}
                  className={inputCls + ' resize-none'}
                />
              </div>
              <div>
                <label className={labelCls}>Export label (optional)</label>
                <input
                  type="text"
                  value={q.exportLabel || ''}
                  onChange={e => updateConvQuestion(q.id, { exportLabel: e.target.value })}
                  placeholder="Column name for CSV export"
                  className={inputCls}
                />
              </div>
              {(q.type === 'radio' || q.type === 'checkbox') && (
                <div>
                  <label className={labelCls}>Options</label>
                  <div className="flex flex-col gap-1.5">
                    {(q.options ?? []).map((opt, oi) => (
                      <div key={oi} className="flex gap-2 items-center">
                        <input
                          type="text"
                          value={opt}
                          onChange={e => {
                            const opts = [...(q.options ?? [])]
                            opts[oi] = e.target.value
                            updateConvQuestion(q.id, { options: opts })
                          }}
                          placeholder={`Option ${oi + 1}`}
                          className={inputCls}
                        />
                        {(q.options ?? []).length > 2 && (
                          <button
                            type="button"
                            onClick={() => {
                              const opts = (q.options ?? []).filter((_, i) => i !== oi)
                              updateConvQuestion(q.id, { options: opts })
                            }}
                            className="text-red-400 hover:text-red-600 flex-shrink-0 text-sm"
                          >✕</button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => updateConvQuestion(q.id, { options: [...(q.options ?? []), ''] })}
                      className="text-xs text-orange-500 hover:text-orange-600 font-semibold self-start mt-1"
                    >+ Add option</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="relative mt-3">
          {showTypePicker ? (
            <div className="flex gap-2 flex-wrap">
              {(['open', 'radio', 'checkbox'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setConvExtras([...convExtras, newConvQuestion(t)])
                    setShowTypePicker(false)
                  }}
                  className="text-xs font-semibold text-orange-500 hover:text-orange-600 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg transition-colors border border-orange-200"
                >
                  {t === 'open' ? 'Open-ended' : t === 'radio' ? 'Single choice' : 'Multi-select'}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowTypePicker(false)}
                className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >Cancel</button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowTypePicker(true)}
              className="text-xs font-semibold text-orange-500 hover:text-orange-600 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg transition-colors border border-orange-200"
            >+ Add question</button>
          )}
        </div>
      </Section>

      <NavButtons onBack={onBack} onNext={onNext} nextDisabled={!canNext} nextLabel="Next: Clarifiers" />
    </div>
  )
}
