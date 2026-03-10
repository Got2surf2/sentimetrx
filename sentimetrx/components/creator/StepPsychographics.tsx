'use client'

import { useState } from 'react'
import type { StepProps } from '@/lib/studyDraft'
import { Section, NavButtons } from './CreatorUI'
import type { PsychoQuestion } from '@/lib/types'
import { INDUSTRY_DEFAULTS, INDUSTRY_LABELS, type Industry } from '@/lib/industryDefaults'

interface Props extends StepProps { onNext: () => void; onBack: () => void }

// ── Question bank ─────────────────────────────────────────────

type BankCategory = 'behaviour' | 'attitudes' | 'media' | 'decision' | 'industry'

interface BankQuestion {
  key:        string
  q:          string
  opts:       string[]
  exportLabel: string
  categories: BankCategory[]
  industries?: string[]   // if set, only shown for these industries
}

const BANK: BankQuestion[] = [
  // BEHAVIOUR
  { key: 'b_frequency',   q: 'How often do you typically engage with us?',                       opts: ['This is my first time', 'A few times a year', 'Monthly', 'Weekly', 'Daily or almost daily'],       exportLabel: 'Engagement Frequency',   categories: ['behaviour'] },
  { key: 'b_channel',     q: 'What is your preferred way to interact with us?',                   opts: ['In person', 'Website', 'Mobile app', 'Phone', 'Email'],                                             exportLabel: 'Preferred Channel',       categories: ['behaviour'] },
  { key: 'b_duration',    q: 'How long have you been a customer or visitor?',                     opts: ['Less than 6 months', '6–12 months', '1–2 years', '3–5 years', 'More than 5 years'],                exportLabel: 'Customer Tenure',         categories: ['behaviour'] },
  { key: 'b_recency',     q: 'When was your last interaction with us before today?',              opts: ['Today was my first time', 'Within the last week', 'Within the last month', '1–3 months ago', 'More than 3 months ago'], exportLabel: 'Last Interaction',  categories: ['behaviour'] },
  { key: 'b_spend',       q: 'How would you describe your typical spending with us?',             opts: ['Minimal — only essentials', 'Moderate', 'Regular purchaser', 'High value customer'],                exportLabel: 'Spend Level',             categories: ['behaviour'] },
  { key: 'b_device',      q: 'What device do you most often use to interact with us?',            opts: ['Smartphone', 'Tablet', 'Laptop or desktop', 'No preference'],                                       exportLabel: 'Primary Device',          categories: ['behaviour'] },
  { key: 'b_referral',    q: 'How did you first hear about us?',                                  opts: ['Friend or family recommendation', 'Social media', 'Online search', 'Advertisement', 'In person / walked by', 'Other'], exportLabel: 'Referral Source', categories: ['behaviour'] },

  // ATTITUDES & VALUES
  { key: 'a_loyalty',     q: 'Which of the following best describes your loyalty to us?',        opts: ['I use you exclusively', 'You are my main choice but I use others', 'I use several providers equally', 'I have no strong preference'], exportLabel: 'Loyalty Level', categories: ['attitudes'] },
  { key: 'a_trust',       q: 'What matters most to you when choosing a provider like us?',       opts: ['Price / value for money', 'Quality of service', 'Convenience / ease', 'Reputation and trust', 'Personalisation', 'Staff or people'], exportLabel: 'Decision Driver', categories: ['attitudes'] },
  { key: 'a_priority',    q: 'What is most important to you in a great experience?',              opts: ['Speed and efficiency', 'Friendliness and warmth', 'Expertise and knowledge', 'Ease of the process', 'Going above and beyond'], exportLabel: 'Experience Priority', categories: ['attitudes'] },
  { key: 'a_satisfaction', q: 'Which aspect of our service are you most satisfied with?',             opts: ['Staff and people', 'Quality of the product or service', 'Pricing', 'Convenience', 'Communication', 'Overall atmosphere'], exportLabel: 'Satisfaction Driver', categories: ['attitudes'] },
  { key: 'a_improvement', q: 'If you could change one thing about your experience, what would it be?', opts: ['Better pricing', 'Faster service', 'More knowledgeable staff', 'Better communication', 'More personalisation', 'Nothing — it was great'], exportLabel: 'Top Improvement', categories: ['attitudes'] },
  { key: 'a_value',       q: 'How do you feel about the value you get for the price you pay?',   opts: ['Excellent value', 'Good value', 'Fair value', 'Slightly overpriced', 'Poor value'],                 exportLabel: 'Perceived Value',         categories: ['attitudes'] },
  { key: 'a_compare',     q: 'How do we compare to similar providers you have used?',            opts: ['Much better', 'Somewhat better', 'About the same', 'Somewhat worse', 'This is the only one I use'], exportLabel: 'Competitive Comparison',  categories: ['attitudes'] },

  // MEDIA & COMMUNICATION
  { key: 'm_social',      q: 'Which social media platforms do you use most?',                    opts: ['Facebook', 'Instagram', 'TikTok', 'X / Twitter', 'LinkedIn', 'YouTube', 'None'],                   exportLabel: 'Social Platforms',        categories: ['media'] },
  { key: 'm_comms',       q: 'How do you prefer to receive updates and communications from us?', opts: ['Email', 'SMS / text', 'Push notification', 'Social media', 'In person', 'I prefer not to receive updates'], exportLabel: 'Comms Preference', categories: ['media'] },
  { key: 'm_review',      q: 'Where do you typically look for reviews before making a decision like this?', opts: ['Google Reviews', 'Yelp', 'TripAdvisor', 'Facebook', 'Word of mouth', 'I do not look at reviews'], exportLabel: 'Review Source', categories: ['media'] },
  { key: 'm_content',     q: 'What type of content from us would you find most useful?',         opts: ['Offers and promotions', 'How-to guides and tips', 'Behind the scenes content', 'News and updates', 'Customer stories', 'None'], exportLabel: 'Preferred Content', categories: ['media'] },
  { key: 'm_frequency',   q: 'How often would you like to hear from us?',                        opts: ['Daily', 'Weekly', 'Monthly', 'Only for important updates', 'Prefer not to hear from you'],          exportLabel: 'Comms Frequency',         categories: ['media'] },

  // DECISION MAKING
  { key: 'd_influence',   q: 'Who else is typically involved when you decide to use us?',        opts: ['I decide alone', 'Partner or spouse', 'Family', 'Friends or colleagues', 'A manager or employer'],  exportLabel: 'Decision Influencer',     categories: ['decision'] },
  { key: 'd_time',        q: 'How long did you take to decide to use us for the first time?',    opts: ['Immediate — decided on the spot', 'A few days', 'A week or two', 'A month or more'],                exportLabel: 'Decision Timeframe',      categories: ['decision'] },
  { key: 'd_barrier',     q: 'What was the biggest barrier to choosing us initially?',           opts: ['Price', 'Uncertainty about quality', 'Awareness — I did not know about you', 'Location or access', 'Switching from another provider', 'There was no barrier'], exportLabel: 'Initial Barrier', categories: ['decision'] },
  { key: 'd_trigger',     q: 'What triggered your decision to visit or use us today?',           opts: ['Planned in advance', 'Spontaneous decision', 'Recommended by someone', 'Saw an ad or promotion', 'Habit — I always come'], exportLabel: 'Visit Trigger', categories: ['decision'] },

  // INDUSTRY — HEALTHCARE
  { key: 'i_hc_type',     q: 'What type of healthcare visit was this?',                          opts: ['Routine check-up', 'Follow-up appointment', 'Urgent care', 'Specialist consultation', 'Procedure or treatment'], exportLabel: 'Visit Type', categories: ['industry'], industries: ['healthcare'] },
  { key: 'i_hc_insurance',q: 'How do you typically pay for healthcare?',                         opts: ['Private insurance', 'Medicare / Medicaid', 'Self-pay', 'Employer-provided insurance', 'Prefer not to say'], exportLabel: 'Payment Method', categories: ['industry'], industries: ['healthcare'] },
  { key: 'i_hc_access',   q: 'How easy is it for you to access healthcare when you need it?',   opts: ['Very easy', 'Fairly easy', 'Neutral', 'Somewhat difficult', 'Very difficult'],                       exportLabel: 'Healthcare Access',       categories: ['industry'], industries: ['healthcare'] },
  { key: 'i_hc_comms',    q: 'How well does our team keep you informed about your care?',        opts: ['Extremely well', 'Very well', 'Adequately', 'Not well enough', 'Poorly'],                            exportLabel: 'Care Communication',      categories: ['industry'], industries: ['healthcare'] },

  // INDUSTRY — HOSPITALITY
  { key: 'i_ho_purpose',  q: 'What is the primary purpose of your stay?',                        opts: ['Leisure / vacation', 'Business', 'Event or celebration', 'Family visit', 'Other'],                   exportLabel: 'Stay Purpose',            categories: ['industry'], industries: ['hospitality'] },
  { key: 'i_ho_booking',  q: 'How did you book your stay?',                                      opts: ['Direct — hotel website', 'Booking.com', 'Expedia', 'Hotels.com', 'Travel agent', 'Phone or walk-in'], exportLabel: 'Booking Channel', categories: ['industry'], industries: ['hospitality'] },
  { key: 'i_ho_amenities',q: 'Which amenities are most important to you when choosing a hotel?', opts: ['Location', 'Price', 'Room quality', 'Breakfast included', 'Pool or gym', 'Free parking', 'Pet-friendly'], exportLabel: 'Key Amenity', categories: ['industry'], industries: ['hospitality'] },
  { key: 'i_ho_loyalty',  q: 'Are you a member of a hotel loyalty programme?',                   opts: ['Yes — this hotel chain', 'Yes — a competitor', 'No but I am interested', 'No and not interested'],   exportLabel: 'Loyalty Programme',       categories: ['industry'], industries: ['hospitality'] },

  // INDUSTRY — RESTAURANTS
  { key: 'i_rs_occasion', q: 'What best describes the occasion for your visit today?',           opts: ['Casual meal', 'Business lunch or dinner', 'Special occasion / celebration', 'Quick bite', 'Family meal'], exportLabel: 'Dining Occasion', categories: ['industry'], industries: ['restaurants'] },
  { key: 'i_rs_group',    q: 'How large was your dining party today?',                           opts: ['Just me', '2 people', '3–4 people', '5 or more people'],                                              exportLabel: 'Party Size',              categories: ['industry'], industries: ['restaurants'] },
  { key: 'i_rs_order',    q: 'How did you place your order today?',                              opts: ['Dine-in with server', 'Counter order', 'Mobile app', 'Third-party delivery', 'Drive-through'],        exportLabel: 'Order Method',            categories: ['industry'], industries: ['restaurants'] },
  { key: 'i_rs_diet',     q: 'Do you have any dietary preferences we should know about?',        opts: ['No restrictions', 'Vegetarian', 'Vegan', 'Gluten-free', 'Halal', 'Other dietary needs'],             exportLabel: 'Dietary Preference',      categories: ['industry'], industries: ['restaurants'] },

  // INDUSTRY — TRAVEL
  { key: 'i_tr_type',     q: 'What type of trip is this?',                                       opts: ['Solo travel', 'Couple', 'Family with children', 'Group of friends', 'Business travel'],             exportLabel: 'Trip Type',               categories: ['industry'], industries: ['travel'] },
  { key: 'i_tr_duration', q: 'How long is your trip?',                                           opts: ['Day trip', '2–3 nights', '4–7 nights', '1–2 weeks', 'More than 2 weeks'],                          exportLabel: 'Trip Duration',           categories: ['industry'], industries: ['travel'] },
  { key: 'i_tr_plan',     q: 'How far in advance did you plan this trip?',                       opts: ['Last minute (under a week)', '1–4 weeks', '1–3 months', 'More than 3 months'],                      exportLabel: 'Planning Lead Time',      categories: ['industry'], industries: ['travel'] },
  { key: 'i_tr_budget',   q: 'How would you describe your travel budget for this trip?',         opts: ['Budget / backpacker', 'Mid-range', 'Comfortable', 'Luxury'],                                         exportLabel: 'Travel Budget',           categories: ['industry'], industries: ['travel'] },

  // INDUSTRY — POLITICS
  { key: 'i_po_engage',   q: 'How do you most often engage with political issues?',              opts: ['Voting', 'Donating', 'Volunteering', 'Attending events', 'Sharing on social media', 'Following the news'], exportLabel: 'Political Engagement', categories: ['industry'], industries: ['politics'] },
  { key: 'i_po_issues',   q: 'Which issues matter most to you right now?',                       opts: ['Economy and jobs', 'Healthcare', 'Education', 'Public safety', 'Environment', 'Immigration', 'Other'], exportLabel: 'Key Issues', categories: ['industry'], industries: ['politics'] },
  { key: 'i_po_trust',    q: 'How much do you trust elected officials to act in your interest?', opts: ['A great deal', 'A fair amount', 'Not very much', 'Not at all'],                                       exportLabel: 'Institutional Trust',     categories: ['industry'], industries: ['politics'] },

  // INDUSTRY — ENTERTAINMENT
  { key: 'i_en_type',     q: 'What type of event or entertainment brought you here today?',      opts: ['Concert or live music', 'Sports event', 'Theatre or performing arts', 'Film or cinema', 'Festival', 'Exhibit or museum', 'Other'], exportLabel: 'Entertainment Type', categories: ['industry'], industries: ['entertainment'] },
  { key: 'i_en_ticket',   q: 'How did you purchase your ticket or gain access?',                 opts: ['Online in advance', 'At the door / box office', 'Via a third-party app', 'Complimentary / guest list', 'Subscription or membership'], exportLabel: 'Ticket Channel', categories: ['industry'], industries: ['entertainment'] },
  { key: 'i_en_group',    q: 'Who did you come with today?',                                     opts: ['Alone', 'Partner or date', 'Friends', 'Family', 'Work colleagues'],                                   exportLabel: 'Attendance Group',        categories: ['industry'], industries: ['entertainment'] },
]

// ── Category config ───────────────────────────────────────────

const CATEGORIES: { id: BankCategory | 'all'; label: string; emoji: string }[] = [
  { id: 'all',       label: 'All',           emoji: '📋' },
  { id: 'behaviour', label: 'Behaviour',     emoji: '🔄' },
  { id: 'attitudes', label: 'Attitudes',     emoji: '💡' },
  { id: 'media',     label: 'Media',         emoji: '📱' },
  { id: 'decision',  label: 'Decision',      emoji: '🎯' },
  { id: 'industry',  label: 'Industry',      emoji: '🏷️' },
]

// ── Helpers ───────────────────────────────────────────────────

const inputCls = 'w-full px-3 py-2 rounded-lg bg-white border border-gray-300 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-orange-400 transition-colors'
const labelCls = 'block text-xs font-semibold text-gray-500 mb-1'

// ── Custom question card (existing functionality) ─────────────

function CustomQuestionCard({ q, idx, total, onChange, onRemove, onMoveUp, onMoveDown }: {
  q: PsychoQuestion; idx: number; total: number
  onChange: (q: PsychoQuestion) => void
  onRemove: () => void; onMoveUp: () => void; onMoveDown: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  const updateOpt = (i: number, val: string) =>
    onChange({ ...q, opts: q.opts.map((o, j) => j === i ? val : o) })
  const addOpt    = () => { if (q.opts.length < 8) onChange({ ...q, opts: [...q.opts, ''] }) }
  const removeOpt = (i: number) => onChange({ ...q, opts: q.opts.filter((_, j) => j !== i) })

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-col gap-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 flex flex-col gap-2">
          <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Custom question {idx + 1}</div>
          <input type="text" value={q.q} onChange={e => onChange({ ...q, q: e.target.value })}
            placeholder="e.g. Which best describes your relationship with us?"
            className={inputCls} />
          <input type="text" value={(q as any).exportLabel || ''} onChange={e => onChange({ ...q, exportLabel: e.target.value } as any)}
            placeholder="CSV column name (optional)"
            className={inputCls + ' text-xs'} />
        </div>
        <div className="flex flex-col gap-1 flex-shrink-0">
          <button onClick={onMoveUp}   disabled={idx === 0}         className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-xs px-2 py-1 rounded hover:bg-gray-100 transition-colors">↑</button>
          <button onClick={onMoveDown} disabled={idx === total - 1} className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-xs px-2 py-1 rounded hover:bg-gray-100 transition-colors">↓</button>
          {confirmDelete ? (
            <div className="flex flex-col gap-1 items-center">
              <button onClick={onRemove}                  className="text-xs font-bold text-red-500 px-1">Yes</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-400 px-1">No</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="text-gray-400 hover:text-red-400 text-xs px-2 py-1 rounded hover:bg-red-50 transition-colors">✕</button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="text-xs text-gray-500 font-medium">Answer options</div>
        {q.opts.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-gray-400 text-xs w-4 text-center flex-shrink-0">{i + 1}</span>
            <input type="text" value={opt} onChange={e => updateOpt(i, e.target.value)}
              placeholder={'Option ' + (i + 1)} className={inputCls + ' flex-1'} />
            {q.opts.length > 2 && (
              <button onClick={() => removeOpt(i)} className="text-gray-300 hover:text-red-400 transition-colors text-sm flex-shrink-0 w-5">×</button>
            )}
          </div>
        ))}
        {q.opts.length < 8 && (
          <button onClick={addOpt} className="text-xs text-gray-400 hover:text-orange-500 transition-colors text-left px-3 py-1.5 mt-0.5">
            + Add option
          </button>
        )}
      </div>
    </div>
  )
}

//// ── Industry question picker ───────────────────────────────────

type IndustryPickerKey = Exclude<Industry, 'other'>

const SORTED_INDUSTRIES: { key: IndustryPickerKey; label: string }[] = (
  Object.entries(INDUSTRY_LABELS) as [Industry, string][]
).filter(([k]) => k !== 'other')
 .map(([k, v]) => ({ key: k as IndustryPickerKey, label: v }))
 .sort((a, b) => a.label.localeCompare(b.label))

interface PickerQuestion { key: string; q: string; opts: string[]; exportLabel: string }

function IndustryPickerRow({
  pq, selected, onToggle
}: { pq: PickerQuestion; selected: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={'rounded-xl border transition-all ' + (selected ? 'border-orange-300 bg-orange-50' : 'border-gray-200 bg-white')}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={onToggle}
          className={'w-5 h-5 rounded flex-shrink-0 border-2 transition-all flex items-center justify-center ' +
            (selected ? 'bg-orange-500 border-orange-500' : 'bg-white border-gray-300 hover:border-orange-400')}>
          {selected && <span className="text-white text-xs font-bold leading-none">✓</span>}
        </button>
        <span className="flex-1 text-sm text-gray-800">{pq.q}</span>
        <button type="button" onClick={() => setOpen(v => !v)}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0 px-2">
          {open ? 'Hide' : 'Preview'}
        </button>
      </div>
      {open && (
        <div className="px-4 pb-3 flex flex-wrap gap-1.5">
          {pq.opts.map(opt => (
            <span key={opt} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-lg">{opt}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function IndustryQuestionPicker({
  bank, onUpdateBank
}: {
  bank: PsychoQuestion[]
  onUpdateBank: (b: PsychoQuestion[]) => void
}) {
  const [pickedIndustry, setPickedIndustry] = useState<IndustryPickerKey | ''>('')
  const selectedKeys = new Set(bank.map(q => q.key))

  const industryQs: PickerQuestion[] = pickedIndustry
    ? ((INDUSTRY_DEFAULTS[pickedIndustry]?.psychographicBank ?? []) as PickerQuestion[])
    : []

  const allAdded  = industryQs.length > 0 && industryQs.every(q => selectedKeys.has(q.key))
  const someAdded = industryQs.some(q => selectedKeys.has(q.key))

  function toggleQ(pq: PickerQuestion) {
    if (selectedKeys.has(pq.key)) {
      onUpdateBank(bank.filter(q => q.key !== pq.key))
    } else {
      onUpdateBank([...bank, { key: pq.key, q: pq.q, opts: pq.opts, exportLabel: pq.exportLabel }])
    }
  }

  function addAll() {
    const toAdd = industryQs.filter(q => !selectedKeys.has(q.key))
    if (toAdd.length > 0) {
      onUpdateBank([...bank, ...toAdd.map(q => ({ key: q.key, q: q.q, opts: q.opts, exportLabel: q.exportLabel }))])
    }
  }

  function removeAll() {
    const keys = new Set(industryQs.map(q => q.key))
    onUpdateBank(bank.filter(q => !keys.has(q.key)))
  }

  const selectCls = 'w-full px-3 py-2.5 rounded-xl bg-white border border-gray-300 text-sm text-gray-800 outline-none focus:border-orange-400 transition-colors cursor-pointer'

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="text-base font-bold text-gray-800 mb-0.5">Industry question sets</div>
        <div className="text-xs text-gray-400">
          Pick any industry to see its curated questions, then add the ones you want.
        </div>
      </div>
      <div className="p-4 flex flex-col gap-3">
        <select
          value={pickedIndustry}
          onChange={e => setPickedIndustry(e.target.value as IndustryPickerKey | '')}
          className={selectCls}
        >
          <option value="">-- Select an industry to preview its questions --</option>
          {SORTED_INDUSTRIES.map(opt => (
            <option key={opt.key} value={opt.key}>{opt.label}</option>
          ))}
        </select>

        {pickedIndustry && industryQs.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {INDUSTRY_LABELS[pickedIndustry]}
                {someAdded && (
                  <span className="ml-2 text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full normal-case font-semibold">
                    {industryQs.filter(q => selectedKeys.has(q.key)).length} added
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                {someAdded && (
                  <button type="button" onClick={removeAll}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors px-2 py-1">
                    Remove all
                  </button>
                )}
                {!allAdded && (
                  <button type="button" onClick={addAll}
                    className="text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 transition-colors px-3 py-1.5 rounded-lg">
                    Add all
                  </button>
                )}
              </div>
            </div>
            {industryQs.map(pq => (
              <IndustryPickerRow
                key={pq.key}
                pq={pq}
                selected={selectedKeys.has(pq.key)}
                onToggle={() => toggleQ(pq)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

 ── Bank question row ──────────────────────────────────────────

function BankRow({ bq, selected, onToggle }: { bq: BankQuestion; selected: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={'rounded-xl border transition-all ' + (selected ? 'border-orange-300 bg-orange-50' : 'border-gray-200 bg-white')}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={onToggle}
          className={'w-5 h-5 rounded flex-shrink-0 border-2 transition-all flex items-center justify-center ' +
            (selected ? 'bg-orange-500 border-orange-500' : 'bg-white border-gray-300 hover:border-orange-400')}>
          {selected && <span className="text-white text-xs font-bold leading-none">✓</span>}
        </button>
        <span className="flex-1 text-sm text-gray-800">{bq.q}</span>
        <button type="button" onClick={() => setOpen(v => !v)}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0 px-2">
          {open ? 'Hide' : 'Preview'}
        </button>
      </div>
      {open && (
        <div className="px-4 pb-3 flex flex-wrap gap-1.5">
          {bq.opts.map(opt => (
            <span key={opt} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-lg">{opt}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────

export default function StepPsychographics({ draft, updateConfig, onNext, onBack }: Props) {
  const bank   = draft.config.psychographicBank
  const count  = draft.config.psychoCount ?? 3
  const industry = draft.industry

  const [activeCategory, setActiveCategory] = useState<BankCategory | 'all'>('all')
  const [showAllIndustries, setShowAllIndustries] = useState(false)
  const [bankOpen, setBankOpen] = useState(true)

  // Keys that are currently selected from the bank
  const selectedKeys = new Set(bank.map(q => q.key))

  // Questions in the bank that came from the preset bank (have a matching BANK entry)
  const customQuestions = bank.filter(q => !BANK.find(bq => bq.key === q.key))

  // Filter the visible bank questions
  const visibleBank = BANK.filter(bq => {
    if (activeCategory !== 'all' && !bq.categories.includes(activeCategory)) return false
    if (activeCategory === 'industry' || (activeCategory === 'all' && !showAllIndustries)) {
      if (bq.industries && industry && !bq.industries.includes(industry)) return false
    }
    return true
  })

  const toggleBankQ = (bq: BankQuestion) => {
    if (selectedKeys.has(bq.key)) {
      updateConfig({ psychographicBank: bank.filter(q => q.key !== bq.key) })
    } else {
      updateConfig({ psychographicBank: [...bank, { key: bq.key, q: bq.q, opts: bq.opts, exportLabel: bq.exportLabel }] })
    }
  }

  const addCustomQ = () => {
    updateConfig({ psychographicBank: [...bank, { key: 'custom_' + Date.now(), q: '', opts: ['', ''] }] })
  }

  const updateCustomQ = (key: string, q: PsychoQuestion) =>
    updateConfig({ psychographicBank: bank.map(item => item.key === key ? q : item) })

  const removeCustomQ = (key: string) =>
    updateConfig({ psychographicBank: bank.filter(item => item.key !== key) })

  const moveCustomQ = (key: string, dir: 'up' | 'down') => {
    const idx = bank.findIndex(q => q.key === key)
    if (idx < 0) return
    const next = [...bank]
    if (dir === 'up'   && idx > 0)                { [next[idx-1], next[idx]] = [next[idx], next[idx-1]] }
    if (dir === 'down' && idx < next.length - 1)  { [next[idx], next[idx+1]] = [next[idx+1], next[idx]] }
    updateConfig({ psychographicBank: next })
  }

  const selectedFromBank  = bank.filter(q => BANK.find(bq => bq.key === q.key))
  const totalSelected     = selectedFromBank.length + customQuestions.length

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">Psychographic questions</h2>
        <p className="text-gray-500 text-sm">
          Select questions from the bank or write your own. The bot randomly shows a subset to each respondent.
        </p>
      </div>

      {/* Industry question sets */}
      <IndustryQuestionPicker
        bank={bank}
        onUpdateBank={b => updateConfig({ psychographicBank: b })}
      />

      {/* How many to show per session */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm flex items-center gap-5">
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-800 mb-0.5">Questions per respondent</div>
          <div className="text-xs text-gray-400">
            {totalSelected === 0
              ? 'No questions selected yet — add some below'
              : 'Randomly selected from your ' + totalSelected + ' question' + (totalSelected === 1 ? '' : 's')}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button type="button" onClick={() => updateConfig({ psychoCount: Math.max(1, count - 1) })}
            className="w-8 h-8 rounded-xl border border-gray-300 bg-white text-gray-700 font-bold hover:border-orange-400 hover:text-orange-500 transition-all flex items-center justify-center">
            −
          </button>
          <span className="w-8 text-center text-lg font-bold text-gray-800">{count}</span>
          <button type="button" onClick={() => updateConfig({ psychoCount: Math.min(totalSelected || 10, count + 1) })}
            className="w-8 h-8 rounded-xl border border-gray-300 bg-white text-gray-700 font-bold hover:border-orange-400 hover:text-orange-500 transition-all flex items-center justify-center">
            +
          </button>
        </div>
      </div>

      {/* Question bank */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        {/* Bank header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <div className="text-base font-bold text-gray-800">
              Question bank
              {selectedFromBank.length > 0 && (
                <span className="ml-2 text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
                  {selectedFromBank.length} selected
                </span>
              )}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">{BANK.length} curated questions — click to add to your survey</div>
          </div>
          <button type="button" onClick={() => setBankOpen(v => !v)}
            className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            {bankOpen ? 'Collapse' : 'Expand'}
          </button>
        </div>

        {bankOpen && (
          <div className="p-4 flex flex-col gap-4">
            {/* Category tabs */}
            <div className="flex gap-1.5 flex-wrap">
              {CATEGORIES.map(cat => (
                <button key={cat.id} type="button" onClick={() => setActiveCategory(cat.id as any)}
                  className={'px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ' +
                    (activeCategory === cat.id
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-orange-300')}>
                  {cat.emoji} {cat.label}
                </button>
              ))}
            </div>

            {/* Industry filter note */}
            {industry && industry !== 'other' && (
              <div className="flex items-center gap-3 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-xl">
                <span className="text-xs text-blue-700 flex-1">
                  Showing questions relevant to your industry. Industry-specific questions appear in the Industry tab.
                </span>
                <button type="button" onClick={() => setShowAllIndustries(v => !v)}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex-shrink-0 transition-colors">
                  {showAllIndustries ? 'Show my industry only' : 'Show all industries'}
                </button>
              </div>
            )}

            {/* Bank questions */}
            <div className="flex flex-col gap-2">
              {visibleBank.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  {activeCategory === 'industry' && industry === 'other'
                    ? 'Select a specific industry in Step 1 to see industry-specific questions'
                    : 'No questions in this category'}
                </div>
              ) : (
                visibleBank.map(bq => (
                  <BankRow key={bq.key} bq={bq} selected={selectedKeys.has(bq.key)} onToggle={() => toggleBankQ(bq)} />
                ))
              )}
            </div>

            {selectedFromBank.length > 0 && (
              <button type="button" onClick={() => updateConfig({ psychographicBank: customQuestions })}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors self-start px-2 py-1">
                Clear all bank selections
              </button>
            )}
          </div>
        )}
      </div>

      {/* Custom questions */}
      <Section title={'Custom questions' + (customQuestions.length > 0 ? ' (' + customQuestions.length + ')' : '')}
        description="Write your own multiple-choice questions to add alongside the bank selections.">
        {customQuestions.length > 0 && (
          <div className="flex flex-col gap-3 mb-3">
            {customQuestions.map((q, i) => (
              <CustomQuestionCard
                key={q.key}
                q={q}
                idx={i}
                total={customQuestions.length}
                onChange={updated => updateCustomQ(q.key, updated)}
                onRemove={() => removeCustomQ(q.key)}
                onMoveUp={() => moveCustomQ(q.key, 'up')}
                onMoveDown={() => moveCustomQ(q.key, 'down')}
              />
            ))}
          </div>
        )}
        <button type="button" onClick={addCustomQ}
          className="text-sm text-gray-500 hover:text-orange-500 transition-colors px-4 py-2.5 rounded-xl border border-dashed border-gray-300 hover:border-orange-300 w-full">
          + Add custom question
        </button>
      </Section>

      <NavButtons onBack={onBack} onNext={onNext} nextLabel="Next: Review & Publish" />
    </div>
  )
}
