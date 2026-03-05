'use client'

import { useState } from 'react'
import type { StepProps } from '@/lib/studyDraft'
import { Field, Input, Section, NavButtons, Divider, ExportLabelField } from './CreatorUI'

interface Props extends StepProps { onNext: () => void; onBack: () => void }

export default function StepConversation({ draft, updateConfig, onNext, onBack }: Props) {
  const c = draft.config
  const [newKw, setNewKw] = useState('')
  const [newQ,  setNewQ]  = useState('')

  const canNext =
    c.promoterQ1.trim() && c.passiveQ1.trim() && c.detractorQ1.trim() &&
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

      <Section
        title="First follow-up question"
        description="The bot adapts this question based on how the respondent rated their experience. You can also set a custom label for this column in CSV exports."
      >
        <Field label="For promoters (score 5 — best experience)">
          <Input value={c.promoterQ1} onChange={v => updateConfig({ promoterQ1: v })}
            placeholder="That's wonderful to hear! What stood out most about your experience?"
            multiline rows={2} />
        </Field>
        <Field label="For passives (score 4 — good experience)">
          <Input value={c.passiveQ1} onChange={v => updateConfig({ passiveQ1: v })}
            placeholder="Thanks for sharing that. What would have made it even better?"
            multiline rows={2} />
        </Field>
        <Field label="For detractors (scores 1–3 — poor experience)">
          <Input value={c.detractorQ1} onChange={v => updateConfig({ detractorQ1: v })}
            placeholder="I'm sorry to hear that. What went wrong, and what would have improved things?"
            multiline rows={2} />
        </Field>
        <ExportLabelField
          value={c.q1ExportLabel || ''}
          onChange={v => updateConfig({ q1ExportLabel: v })}
        />
      </Section>

      <Divider />

      <Section title="Second question (Q3)" description="Asked after the first follow-up. Usually a broader or deeper question.">
        <Input value={c.q3} onChange={v => updateConfig({ q3: v })}
          placeholder="Is there anything specific you think we should do differently?"
          multiline rows={2} />
        <ExportLabelField
          value={c.q3ExportLabel || ''}
          onChange={v => updateConfig({ q3ExportLabel: v })}
        />
      </Section>

      <Section title="Third question (Q4)" description="The final open-ended question before psychographic questions.">
        <Input value={c.q4} onChange={v => updateConfig({ q4: v })}
          placeholder="Is there anything else you'd like us to know?"
          multiline rows={2} />
        <ExportLabelField
          value={c.q4ExportLabel || ''}
          onChange={v => updateConfig({ q4ExportLabel: v })}
        />
      </Section>

      <Divider />

      <Section
        title="Clarifying questions"
        description="When a respondent gives a short answer, the bot asks a follow-up to get more detail. Add trigger keywords and the question to ask when that word appears."
      >
        <Field label="Default clarifier (used when no keyword matches)">
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

      <NavButtons onBack={onBack} onNext={onNext} nextDisabled={!canNext} nextLabel="Next: Psychographics" />
    </div>
  )
}
