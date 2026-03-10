'use client'

import { useState } from 'react'
import type { StepProps } from '@/lib/studyDraft'
import { Field, Input, Section, NavButtons, Divider } from './CreatorUI'

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
  const [newKw, setNewKw] = useState('')
  const [newQ,  setNewQ]  = useState('')

  const canNext =
    c.q3.trim() && c.q4.trim() && c.clarifiers.default.trim()

  const addClarifier = () => {
    const kw = newKw.trim().toLowerCase().replace(/\s+/g, '_')
    const q  = newQ.trim()
    if (!kw || !q) return
    updateConfig({ clarifiers: { ...c.clarifiers, [kw]: q } })
    setNewKw('')
    setNewQ('')
  }

  const removeClarifier = (key: string) => {
    const next = { ...c.clarifiers }
    delete next[key]
    updateConfig({ clarifiers: next })
  }

  const clarifierEntries = Object.entries(c.clarifiers).filter(([k]) => k !== 'default')

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

      <Divider />

      <Section
        title="Clarifying questions"
        description="When a respondent gives a short answer, the bot asks a follow-up to get more detail."
      >
        {/* AI clarify toggle */}
        <div className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-800">AI-powered follow-ups</div>
            <div className="text-xs text-gray-500 mt-0.5">Use Claude to generate intelligent, contextual clarifying questions instead of keyword matching</div>
          </div>
          <button
            type="button"
            onClick={() => updateConfig({ useAIClarify: !c.useAIClarify })}
            className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-4 border-2 border-transparent ${c.useAIClarify ? 'bg-orange-500' : 'bg-gray-200'}`}
          >
            <span className={`inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ${c.useAIClarify ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
        {!c.useAIClarify && (
          <p className="text-xs text-gray-400 px-1">Keyword matching active — add triggers below or enable AI for smarter follow-ups.</p>
        )}
        {c.useAIClarify && (
          <p className="text-xs text-orange-600 px-1">✦ AI will generate follow-ups using study context, sentiment, and prior answers. Keyword rules below are used as fallback.</p>
        )}
        <Field label="Default clarifier (used as fallback when no keyword matches)">
          <Input
            value={c.clarifiers.default}
            onChange={v => updateConfig({ clarifiers: { ...c.clarifiers, default: v } })}
            placeholder="Could you tell me a little more about that?"
          />
        </Field>

        {clarifierEntries.length > 0 && (
          <div className="flex flex-col gap-2 mt-1">
            {clarifierEntries.map(([kw, q]) => (
              <div key={kw} className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono text-orange-500 mb-1">keyword: {kw}</div>
                  <div className="text-sm text-gray-700 whitespace-pre-wrap">{q as string}</div>
                </div>
                <button onClick={() => removeClarifier(kw)}
                  className="text-gray-400 hover:text-red-500 transition-colors text-lg flex-shrink-0 leading-none">×</button>
              </div>
            ))}
          </div>
        )}

        <div className="bg-gray-50 border border-gray-200 border-dashed rounded-xl p-4 flex flex-col gap-3">
          <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide">Add keyword clarifier</p>
          <input type="text" value={newKw} onChange={e => setNewKw(e.target.value)}
            placeholder="Trigger keyword (e.g. price)"
            className={inputCls} />
          <input type="text" value={newQ} onChange={e => setNewQ(e.target.value)}
            placeholder="Clarifying question to ask when this word appears"
            className={inputCls}
            onKeyDown={e => e.key === 'Enter' && addClarifier()} />
          <button onClick={addClarifier} disabled={!newKw.trim() || !newQ.trim()}
            className="self-start px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 disabled:opacity-40 text-gray-700 text-sm font-medium transition-all">
            Add clarifier
          </button>
        </div>
      </Section>

      <NavButtons onBack={onBack} onNext={onNext} nextDisabled={!canNext} nextLabel="Next: Custom Questions" />
    </div>
  )
}
