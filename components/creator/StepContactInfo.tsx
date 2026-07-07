'use client'

import { useRef } from 'react'
import type { DragEvent } from 'react'
import type { StepProps } from '@/lib/studyDraft'
import { Section, NavButtons, TransitionMessagePanel } from './CreatorUI'
import { CONTACT_BANK, type ContactField, type SectionKey } from '@/lib/types'

interface Props extends StepProps { onNext: () => void; onBack: () => void }

const SECTION_LABELS: Record<SectionKey, string> = {
  customQuestions: 'Custom Questions',
  psychographics: 'Psychographics',
  demographics:   'Demographics',
  contact:        'Contact Info',
}

const DEFAULT_ORDER: SectionKey[] = ['customQuestions', 'psychographics', 'demographics', 'contact']

function getMergedFields(currentFields: ContactField[] | undefined): ContactField[] {
  var merged = CONTACT_BANK.map(function(bk) {
    if (!currentFields || currentFields.length === 0) return { ...bk }
    var match = currentFields.find(function(cf) { return cf.key === bk.key })
    return match ? { ...bk, enabled: match.enabled, required: match.required, label: match.label || bk.label } : { ...bk }
  })
  if (currentFields) {
    currentFields.forEach(function(cf) {
      if (!CONTACT_BANK.find(function(bk) { return bk.key === cf.key })) {
        merged.push(cf)
      }
    })
    // Preserve order from currentFields
    var keyOrder: Record<string, number> = {}
    currentFields.forEach(function(cf, i) { keyOrder[cf.key] = i })
    merged.sort(function(a, b) {
      var ai = keyOrder[a.key] != null ? keyOrder[a.key] : 999
      var bi = keyOrder[b.key] != null ? keyOrder[b.key] : 999
      return ai - bi
    })
  }
  return merged
}

function typeLabel(type: string) {
  switch (type) {
    case 'email':    return 'Email'
    case 'phone':    return 'Phone'
    case 'zip_code': return 'ZIP Code'
    case 'us_state': return 'Dropdown (50 states)'
    case 'text':     return 'Text'
    default:         return type
  }
}

export default function StepContactInfo({ draft, updateConfig, onNext, onBack }: Props) {
  var fieldDragIdx = useRef<number | null>(null)
  var sectionDragIdx = useRef<number | null>(null)
  var merged = getMergedFields(draft.config.contactFields)
  var enabledCount = merged.filter(function(f) { return f.enabled }).length

  var sectionOrder: SectionKey[] = draft.config.sectionOrder || DEFAULT_ORDER

  function saveFields(next: ContactField[]) {
    updateConfig({ contactFields: next })
  }

  function saveSectionOrder(next: SectionKey[]) {
    updateConfig({ sectionOrder: next })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Section transition message */}
      <TransitionMessagePanel
        enabled={draft.config.contactTransition?.enabled !== false}
        text={draft.config.contactTransition?.text || ''}
        defaultText="If you'd like us to follow up, please share your contact details below. Completely optional."
        onToggle={v => updateConfig({ contactTransition: { enabled: v, text: draft.config.contactTransition?.text || '' } })}
        onTextChange={v => updateConfig({ contactTransition: { enabled: true, text: v } })}
      />

      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">Contact Info</h2>
        <p className="text-gray-500 text-sm">
          Collect respondent contact and address information. All fields include validation. Drag &#x2807; to reorder.
        </p>
      </div>

      <Section title={'Contact fields (' + enabledCount + ' of ' + merged.length + ')'} description="Toggle fields on or off. Fields with validation show input hints to respondents.">
        <div className="flex flex-col gap-2">
          {merged.map(function(f, idx) {
            return (
              <div key={f.key}
                draggable
                onDragStart={function() { fieldDragIdx.current = idx }}
                onDragOver={function(e: DragEvent) {
                  e.preventDefault()
                  if (fieldDragIdx.current === null || fieldDragIdx.current === idx) return
                  var next = merged.slice()
                  var moved = next.splice(fieldDragIdx.current, 1)[0]
                  next.splice(idx, 0, moved)
                  fieldDragIdx.current = idx
                  saveFields(next)
                }}
                onDragEnd={function() { fieldDragIdx.current = null }}
                className={'flex items-center gap-3 px-4 py-3 rounded-xl border transition-all cursor-grab ' + (f.enabled ? 'border-orange-200 bg-orange-50' : 'border-gray-200 bg-white')}>

                {/* Drag handle */}
                <span className="text-gray-300 text-sm select-none flex-shrink-0">&#x2807;</span>

                {/* Toggle */}
                <button
                  type="button"
                  onClick={function() {
                    var updated = merged.map(function(m) { return m.key === f.key ? { ...m, enabled: !m.enabled } : m })
                    saveFields(updated)
                  }}
                  className={'relative inline-flex w-10 h-5 rounded-full transition-colors border-2 border-transparent flex-shrink-0 ' + (f.enabled ? 'bg-orange-500' : 'bg-gray-200')}
                >
                  <span className={'inline-block w-4 h-4 bg-white rounded-full shadow-md transition-transform transform ' + (f.enabled ? 'translate-x-5' : 'translate-x-0')} />
                </button>

                {/* Label + placeholder */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-700">{f.label}</div>
                  {f.placeholder && (
                    <div className="text-xs text-gray-400">{f.placeholder}</div>
                  )}
                </div>

                {/* Required toggle (only when enabled) */}
                {f.enabled && (
                  <button
                    type="button"
                    onClick={function() {
                      var updated = merged.map(function(m) { return m.key === f.key ? { ...m, required: !m.required } : m })
                      saveFields(updated)
                    }}
                    className={'text-xs px-2 py-0.5 rounded-full border font-medium transition-all ' +
                      (f.required ? 'bg-red-50 text-red-600 border-red-200' : 'bg-gray-50 text-gray-400 border-gray-200 hover:text-gray-600')}
                  >
                    {f.required ? 'Required' : 'Optional'}
                  </button>
                )}

                {/* Type badge */}
                <span className="text-xs text-gray-300 flex-shrink-0">{typeLabel(f.type)}</span>
              </div>
            )
          })}
        </div>
      </Section>

      {/* Section ordering */}
      <Section title="Survey section order" description="Drag to reorder the post-conversation sections. This controls the order respondents see them.">
        <div className="flex flex-col gap-2">
          {sectionOrder.map(function(key, idx) {
            return (
              <div key={key}
                draggable
                onDragStart={function() { sectionDragIdx.current = idx }}
                onDragOver={function(e: DragEvent) {
                  e.preventDefault()
                  if (sectionDragIdx.current === null || sectionDragIdx.current === idx) return
                  var next = sectionOrder.slice()
                  var moved = next.splice(sectionDragIdx.current, 1)[0]
                  next.splice(idx, 0, moved)
                  sectionDragIdx.current = idx
                  saveSectionOrder(next)
                }}
                onDragEnd={function() { sectionDragIdx.current = null }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 bg-white cursor-grab hover:border-orange-200 transition-all">
                <span className="text-gray-300 text-sm select-none flex-shrink-0">&#x2807;</span>
                <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center text-xs font-bold flex-shrink-0">{idx + 1}</span>
                <span className="text-sm font-medium text-gray-700">{SECTION_LABELS[key]}</span>
              </div>
            )
          })}
        </div>
      </Section>

      <NavButtons onBack={onBack} onNext={onNext} nextLabel="Next: Review &amp; Publish" />
    </div>
  )
}
