'use client'

import { useRef } from 'react'
import type { StepProps } from '@/lib/studyDraft'
import { Section, NavButtons, TransitionMessagePanel } from './CreatorUI'

interface Props extends StepProps { onNext: () => void; onBack: () => void }

var DEMO_BANK: { key: string; label: string; type: 'select' | 'text'; options?: [string, string][]; enabled: boolean }[] = [
  { key: 'age',        label: 'Age Range',         type: 'select', enabled: true,  options: [['18-24','18-24'],['25-34','25-34'],['35-44','35-44'],['45-54','45-54'],['55-64','55-64'],['65+','65 or over']] },
  { key: 'gender',     label: 'Gender',            type: 'select', enabled: true,  options: [['male','Male'],['female','Female'],['nonbinary','Non-binary'],['other','Prefer to self-describe'],['prefer_not','Prefer not to say']] },
  { key: 'zip',        label: 'ZIP / Postal Code', type: 'text',   enabled: true  },
  { key: 'income',     label: 'Household Income',  type: 'select', enabled: false, options: [['under_25k','Under $25,000'],['25k_50k','$25,000–$49,999'],['50k_75k','$50,000–$74,999'],['75k_100k','$75,000–$99,999'],['100k_150k','$100,000–$149,999'],['150k_plus','$150,000 or more'],['prefer_not','Prefer not to say']] },
  { key: 'education',  label: 'Education Level',   type: 'select', enabled: false, options: [['high_school','High school or less'],['some_college','Some college'],['associates','Associate degree'],['bachelors','Bachelor\'s degree'],['masters','Master\'s degree'],['doctoral','Doctoral or professional'],['prefer_not','Prefer not to say']] },
  { key: 'ethnicity',  label: 'Ethnicity',         type: 'select', enabled: false, options: [['white','White'],['black','Black or African American'],['hispanic','Hispanic or Latino'],['asian','Asian'],['native','Native American or Alaska Native'],['pacific','Native Hawaiian or Pacific Islander'],['multi','Two or more races'],['other','Other'],['prefer_not','Prefer not to say']] },
  { key: 'employment', label: 'Employment Status',  type: 'select', enabled: false, options: [['full_time','Full-time'],['part_time','Part-time'],['self_employed','Self-employed'],['student','Student'],['retired','Retired'],['unemployed','Not employed'],['prefer_not','Prefer not to say']] },
  { key: 'marital',    label: 'Marital Status',     type: 'select', enabled: false, options: [['single','Single'],['married','Married'],['domestic','Domestic partnership'],['divorced','Divorced'],['widowed','Widowed'],['prefer_not','Prefer not to say']] },
  { key: 'household',  label: 'Household Size',     type: 'select', enabled: false, options: [['1','1 person'],['2','2 people'],['3','3 people'],['4','4 people'],['5_plus','5 or more']] },
  { key: 'state',      label: 'State / Region',     type: 'text',   enabled: false },
]

function getMergedFields(currentFields: any[] | undefined) {
  var merged = DEMO_BANK.map(function(bk) {
    if (!currentFields || currentFields.length === 0) return bk
    var match = currentFields.find(function(cf: any) { return cf.key === bk.key })
    return match ? { ...bk, enabled: match.enabled, label: match.label || bk.label } : bk
  })
  if (currentFields) {
    currentFields.forEach(function(cf: any) {
      if (!DEMO_BANK.find(function(bk) { return bk.key === cf.key })) {
        merged.push(cf)
      }
    })
  }
  // Preserve order from currentFields if available
  if (currentFields && currentFields.length > 0) {
    var keyOrder: Record<string, number> = {}
    currentFields.forEach(function(cf: any, i: number) { keyOrder[cf.key] = i })
    merged.sort(function(a, b) {
      var ai = keyOrder[a.key] != null ? keyOrder[a.key] : 999
      var bi = keyOrder[b.key] != null ? keyOrder[b.key] : 999
      return ai - bi
    })
  }
  return merged
}

export default function StepDemographics({ draft, updateConfig, onNext, onBack }: Props) {
  var demoDragIdx = useRef<number | null>(null)
  var merged = getMergedFields(draft.config.demoFields)
  var enabledCount = merged.filter(function(f) { return f.enabled }).length

  function saveMerged(next: any[]) {
    updateConfig({ demoFields: next })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Section transition message */}
      <TransitionMessagePanel
        enabled={draft.config.sectionTransitions?.demographics?.enabled !== false}
        text={draft.config.sectionTransitions?.demographics?.text || ''}
        defaultText="Almost done -- a couple of optional questions about you. Completely up to you."
        onToggle={v => updateConfig({ sectionTransitions: { ...draft.config.sectionTransitions, demographics: { enabled: v, text: draft.config.sectionTransitions?.demographics?.text || '' } } })}
        onTextChange={v => updateConfig({ sectionTransitions: { ...draft.config.sectionTransitions, demographics: { enabled: true, text: v } } })}
      />

      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">Demographics</h2>
        <p className="text-gray-500 text-sm">
          Choose which demographic questions to show respondents at the end of the survey. All fields are optional for respondents. Drag ⠿ to reorder.
        </p>
      </div>

      <Section title={'Active fields (' + enabledCount + ' of ' + merged.length + ')'} description="Toggle fields on or off. Enabled fields appear in the order shown below.">
        <div className="flex flex-col gap-2">
          {merged.map(function(f, idx) {
            return (
              <div key={f.key}
                draggable
                onDragStart={function() { demoDragIdx.current = idx }}
                onDragOver={function(e: any) {
                  e.preventDefault()
                  if (demoDragIdx.current === null || demoDragIdx.current === idx) return
                  var next = merged.slice()
                  var moved = next.splice(demoDragIdx.current, 1)[0]
                  next.splice(idx, 0, moved)
                  demoDragIdx.current = idx
                  saveMerged(next)
                }}
                onDragEnd={function() { demoDragIdx.current = null }}
                className={'flex items-center gap-3 px-4 py-3 rounded-xl border transition-all cursor-grab ' + (f.enabled ? 'border-orange-200 bg-orange-50' : 'border-gray-200 bg-white')}>

                {/* Drag handle */}
                <span className="text-gray-300 text-sm select-none flex-shrink-0">⠿</span>

                {/* Toggle */}
                <button
                  type="button"
                  onClick={function() {
                    var updated = merged.map(function(m) { return m.key === f.key ? { ...m, enabled: !m.enabled } : m })
                    saveMerged(updated)
                  }}
                  className={'relative inline-flex w-10 h-5 rounded-full transition-colors border-2 border-transparent flex-shrink-0 ' + (f.enabled ? 'bg-orange-500' : 'bg-gray-200')}
                >
                  <span className={'inline-block w-4 h-4 bg-white rounded-full shadow-md transition-transform transform ' + (f.enabled ? 'translate-x-5' : 'translate-x-0')} />
                </button>

                {/* Label + preview */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-700">{f.label}</div>
                  <div className="text-xs text-gray-400">
                    {f.type === 'select' && f.options ? f.options.slice(0, 3).map(function(o: any) { return o[1] }).join(', ') + (f.options.length > 3 ? ' ...' : '') : 'Free text input'}
                  </div>
                </div>

                {/* Type badge */}
                <span className="text-xs text-gray-300 flex-shrink-0">{f.type === 'select' ? 'Dropdown' : 'Text'}</span>
              </div>
            )
          })}
        </div>
      </Section>

      <NavButtons onBack={onBack} onNext={onNext} nextLabel="Next: Contact Info" />
    </div>
  )
}
