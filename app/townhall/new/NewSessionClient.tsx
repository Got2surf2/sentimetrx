'use client'

import { useState, useRef, useCallback } from 'react'
import TopNav from '@/components/nav/TopNav'
import { useRouter } from 'next/navigation'
import type { TownHallConfig, TownHallGuideTopic } from '@/lib/types'
import { SUPPORTED_LANGUAGES, DEMO_BANK } from '@/lib/types'
import { GENERAL_PSYCHO_BANK } from '@/lib/psychoBank'
import { INDUSTRY_LABELS, INDUSTRY_EMOJIS, INDUSTRY_EMOJI_SETS, type Industry } from '@/lib/industryDefaults'
import EmojiPickerPopover from '@/components/creator/EmojiPickerPopover'
import THCreatorNav, { TH_STEP_LABELS } from '@/components/townhall/THCreatorNav'

interface Props {
  logoUrl?: string
  analyzeEnabled?: boolean
  campaignsEnabled?: boolean
  user: { email: string; fullName?: string; clientName?: string; isAdmin?: boolean }
}

const HERMES = '#E8632A'

function generateId() {
  return 'topic_' + Math.random().toString(36).slice(2, 8)
}

const DEFAULT_TOPIC: () => TownHallGuideTopic = () => ({
  id: generateId(),
  label: '',
  description: '',
  opening_question: '',
  follow_up_angles: [],
  keywords: [],
  response_target: 30,
  enabled: true,
})

const DEFAULT_CONFIG: TownHallConfig = {
  bot_name: 'Town Hall',
  bot_emoji: '\uD83D\uDCAC',
  context: {
    org_name: '',
    event_description: '',
    tone: 'warm, respectful, community-focused',
    sensitive_topics: [],
    priority_areas: [],
  },
  opening_message: 'Welcome! Share your thoughts anonymously — we\'ll have a short conversation to understand your perspective.\n\nWhat\'s on your mind?',
  closing_message: 'Thank you for your time. Your voice matters.',
  engine: {
    theme_detection_mode: 'manual',
    theme_detection_interval_minutes: 10,  // deprecated
    theme_detection_every_n_responses: 20,
    max_turns_per_participant: 20,
    default_response_target: 30,
    max_active_themes: 8,
    ai_timeout_ms: 3000,
  },
  session_end: {
    mode: 'manual',
    duration_minutes: 90,
    inactivity_timeout_minutes: 30,
  },
  display: {
    skip_label: 'I\'d rather not answer that',
    done_label: 'I\'m done sharing',
  },
}

// -- Reusable form components --------------------------------------------------

function Label({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <label className="block mb-1">
      <span className="text-sm font-semibold text-gray-700">{children}</span>
      {sub && <span className="text-xs text-gray-400 ml-1.5">{sub}</span>}
    </label>
  )
}

function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400"
    />
  )
}

function Textarea({ value, onChange, placeholder, rows = 2 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400 resize-none"
    />
  )
}

// -- Description grade pill ----------------------------------------------------

const GRADE_COLORS = [
  '', // 0 unused
  '#dc2626', // 1 red
  '#ea580c', // 2 orange
  '#d97706', // 3 amber
  '#65a30d', // 4 lime
  '#16a34a', // 5 green
]
const GRADE_BG = [
  '',
  '#fef2f2',
  '#fff7ed',
  '#fffbeb',
  '#f7fee7',
  '#f0fdf4',
]
const GRADE_LABELS = ['', 'Needs work', 'Basic', 'Adequate', 'Good', 'Excellent']

function DescGradePill({ score }: { score: number }) {
  const s = Math.max(1, Math.min(5, score))
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ background: GRADE_BG[s], color: GRADE_COLORS[s] }}>
      {'●'.repeat(s)}{'○'.repeat(5 - s)} {GRADE_LABELS[s]}
    </span>
  )
}

// -- Sensitive topic input (auto-fans on add) ---------------------------------

function SensitiveInput({ onAdd, placeholder }: { onAdd: (term: string) => void; placeholder?: string }) {
  const [input, setInput] = useState('')
  const add = () => {
    const term = input.trim().toLowerCase()
    if (term) { onAdd(term); setInput('') }
  }
  return (
    <input type="text" value={input}
      onChange={e => setInput(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
      onBlur={add}
      placeholder={placeholder}
      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400"
    />
  )
}

// -- Expand toggles for keywords / sensitive terms ----------------------------

type ExpansionMap = Record<string, { similar?: string[]; associated?: string[] }>

function ExpandableTerms({ terms, onChange, color = 'purple', context }: {
  terms: string[]
  onChange: (terms: string[]) => void
  color?: 'purple' | 'red'
  context?: string
}) {
  const [expansions, setExpansions] = useState<ExpansionMap>({})
  const [loading, setLoading] = useState<Record<string, string | null>>({})

  const toggleExpand = async (term: string, mode: 'similar' | 'associated') => {
    const current = expansions[term]?.[mode]
    if (current) {
      // Toggle OFF — remove expanded terms
      const toRemove = new Set(current)
      const updated = terms.filter(t => !toRemove.has(t))
      setExpansions(prev => {
        const next = { ...prev }
        if (next[term]) { const e = { ...next[term] }; delete e[mode]; next[term] = e }
        return next
      })
      onChange(updated)
      return
    }
    // Toggle ON — fetch and add
    setLoading(prev => ({ ...prev, [term]: mode }))
    try {
      const res = await fetch('/api/townhall/expand-terms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term, mode, context }),
      })
      const data = await res.json()
      if (data.terms?.length) {
        const existing = new Set(terms.map(t => t.toLowerCase()))
        const newTerms = data.terms.filter((t: string) => !existing.has(t.toLowerCase()) && t.toLowerCase() !== term.toLowerCase())
        if (newTerms.length) {
          setExpansions(prev => ({ ...prev, [term]: { ...prev[term], [mode]: newTerms } }))
          // Insert expanded terms right after the parent term
          const idx = terms.indexOf(term)
          const updated = [...terms]
          updated.splice(idx + 1, 0, ...newTerms)
          onChange(updated)
        }
      }
    } catch {}
    setLoading(prev => ({ ...prev, [term]: null }))
  }

  // Collect all expanded terms so we can style them differently
  const expandedSet = new Set<string>()
  Object.values(expansions).forEach(e => {
    e.similar?.forEach(t => expandedSet.add(t))
    e.associated?.forEach(t => expandedSet.add(t))
  })

  const bg = color === 'red' ? 'bg-red-50' : 'bg-purple-50'
  const text = color === 'red' ? 'text-red-600' : 'text-purple-600'
  const border = color === 'red' ? 'border-red-200' : 'border-purple-200'
  const expandedBg = color === 'red' ? 'bg-red-50/50' : 'bg-purple-50/50'
  const expandedBorder = color === 'red' ? 'border-red-100' : 'border-purple-100'
  const expandedText = color === 'red' ? 'text-red-400' : 'text-purple-400'

  if (terms.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {terms.map(kw => {
        const isExpanded = expandedSet.has(kw)
        const isParent = !!expansions[kw] && (!!expansions[kw].similar || !!expansions[kw].associated)
        const hasSimilar = !!expansions[kw]?.similar
        const hasAssociated = !!expansions[kw]?.associated
        const isLoading = loading[kw]

        return (
          <span key={kw} className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${isExpanded ? `${expandedBg} ${expandedText} ${expandedBorder}` : `${bg} ${text} ${border}`}`}>
            {kw}
            {!isExpanded && (
              <>
                <button onClick={() => toggleExpand(kw, 'similar')}
                  disabled={!!isLoading}
                  className={`px-1 py-0 rounded text-[8px] font-bold leading-none transition-colors ${hasSimilar ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-500 hover:bg-blue-200 hover:text-blue-600'}`}
                  title={hasSimilar ? 'Remove similar terms' : 'Add similar word forms (lemmas, plurals, tenses)'}>
                  {isLoading === 'similar' ? '·' : 'S'}
                </button>
                <button onClick={() => toggleExpand(kw, 'associated')}
                  disabled={!!isLoading}
                  className={`px-1 py-0 rounded text-[8px] font-bold leading-none transition-colors ${hasAssociated ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-500 hover:bg-emerald-200 hover:text-emerald-600'}`}
                  title={hasAssociated ? 'Remove associated terms' : 'Add associated/related terms'}>
                  {isLoading === 'associated' ? '·' : 'A'}
                </button>
              </>
            )}
            <button onClick={() => {
              // Also clean up any expansion state for this term
              if (expansions[kw]) {
                const toRemove = new Set([...(expansions[kw].similar || []), ...(expansions[kw].associated || [])])
                setExpansions(prev => { const next = { ...prev }; delete next[kw]; return next })
                onChange(terms.filter(t => t !== kw && !toRemove.has(t)))
              } else {
                onChange(terms.filter(t => t !== kw))
              }
            }} className={`${isExpanded ? expandedText : text} opacity-50 hover:opacity-100 hover:text-red-500`}>&times;</button>
          </span>
        )
      })}
    </div>
  )
}

// -- Topic card ---------------------------------------------------------------

function TopicCard({ topic, index, onChange, onRemove, industry, orgName, eventDesc, expectedAttendees }: {
  topic: TownHallGuideTopic
  index: number
  onChange: (t: TownHallGuideTopic) => void
  onRemove: () => void
  industry?: string
  orgName?: string
  eventDesc?: string
  expectedAttendees?: number
}) {
  const [anglesText, setAnglesText] = useState(topic.follow_up_angles.join('\n'))
  const [generating, setGenerating] = useState(false)

  const generateWithAI = async () => {
    if (!topic.label.trim()) return
    setGenerating(true)
    try {
      const res = await fetch('/api/townhall/suggest-topic', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: topic.label, industry, org_name: orgName, event_description: eventDesc }),
      })
      const data = await res.json()
      if (data.error) return
      onChange({
        ...topic,
        description: data.description || topic.description,
        opening_question: data.opening_question || topic.opening_question,
        follow_up_angles: data.follow_up_angles?.length ? data.follow_up_angles : topic.follow_up_angles,
        keywords: data.keywords?.length ? data.keywords : topic.keywords,
      })
      if (data.follow_up_angles?.length) setAnglesText(data.follow_up_angles.join('\n'))
    } catch {}
    setGenerating(false)
  }

  const enabled = topic.enabled !== false

  return (
    <div className={'border rounded-xl p-4 transition-opacity ' + (enabled ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60')}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button onClick={() => onChange({ ...topic, enabled: !enabled })}
            className="w-8 h-4 rounded-full relative transition-colors flex-shrink-0"
            style={{ background: enabled ? '#22c55e' : '#d1d5db' }}
            title={enabled ? 'Disable topic' : 'Enable topic'}>
            <div className="w-3 h-3 rounded-full bg-white absolute top-0.5 transition-all"
              style={{ left: enabled ? 17 : 2 }} />
          </button>
          <span className="text-xs font-bold text-gray-400 uppercase">Topic {index + 1}</span>
          {!enabled && <span className="text-[10px] text-gray-400 italic">Disabled</span>}
        </div>
        <button onClick={onRemove} className="text-xs text-red-400 hover:text-red-600 font-medium">Remove</button>
      </div>

      <div className="space-y-3">
        <div>
          <Label>Label</Label>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input value={topic.label} onChange={v => onChange({ ...topic, label: v })} placeholder="e.g. Transportation" />
            </div>
            <button onClick={generateWithAI} disabled={generating || !topic.label.trim()}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 flex-shrink-0 flex items-center gap-1.5"
              style={{ background: '#7c3aed' }}
              title="AI fills in description, question, keywords, and follow-up angles">
              {generating ? 'Generating...' : '\u2728 Generate'}
            </button>
          </div>
        </div>

        <div>
          <Label sub="Brief context for the AI">Description</Label>
          <Input value={topic.description} onChange={v => onChange({ ...topic, description: v })} placeholder="e.g. How people get around, traffic, public transit" />
        </div>

        <div>
          <Label>Opening question</Label>
          <Textarea
            value={topic.opening_question}
            onChange={v => onChange({ ...topic, opening_question: v })}
            placeholder="e.g. What's your experience with transportation in this area?"
          />
        </div>

        <div>
          <Label sub="One per line — hints for the AI, not rigid scripts">Follow-up angles</Label>
          <Textarea
            value={anglesText}
            onChange={v => {
              setAnglesText(v)
              onChange({ ...topic, follow_up_angles: v.split('\n').map(s => s.trim()).filter(Boolean) })
            }}
            placeholder={"What specific changes would help most?\nHow does this affect your daily routine?"}
            rows={3}
          />
        </div>

        {/* Keywords */}
        <div>
          <Label sub="Used for theme matching — click S (similar word forms) or A (associated terms) to expand">Keywords</Label>
          {topic.keywords?.length > 0 ? (
            <ExpandableTerms
              terms={topic.keywords}
              onChange={kws => onChange({ ...topic, keywords: kws })}
              color="purple"
              context={topic.description || topic.label}
            />
          ) : (
            <p className="text-[11px] text-gray-400 italic">Click Generate to add keywords</p>
          )}
        </div>

        <div>
          <Label sub="How many responses to collect on this topic">Response target</Label>
          <div className="flex items-center gap-3">
            {expectedAttendees && expectedAttendees > 0 ? (
              <>
                <select
                  value={topic.target_mode || 'fixed'}
                  onChange={e => {
                    const mode = e.target.value as 'fixed' | 'percentage'
                    if (mode === 'percentage') {
                      const pct = topic.target_pct || 30
                      onChange({ ...topic, target_mode: mode, target_pct: pct, response_target: Math.round(expectedAttendees * pct / 100) })
                    } else {
                      onChange({ ...topic, target_mode: mode })
                    }
                  }}
                  className="px-2 py-2 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-orange-200 bg-white"
                >
                  <option value="fixed">Fixed count</option>
                  <option value="percentage">% of attendees</option>
                </select>
                {(topic.target_mode || 'fixed') === 'percentage' ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min={5} max={100}
                      value={topic.target_pct || 30}
                      onChange={e => {
                        const pct = parseInt(e.target.value) || 30
                        onChange({ ...topic, target_pct: pct, response_target: Math.round(expectedAttendees * pct / 100) })
                      }}
                      className="w-16 px-2 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                    />
                    <span className="text-xs text-gray-400">% = {topic.response_target} responses</span>
                  </div>
                ) : (
                  <input
                    type="number" min={5} max={5000}
                    value={topic.response_target}
                    onChange={e => onChange({ ...topic, response_target: parseInt(e.target.value) || 30 })}
                    className="w-24 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                  />
                )}
              </>
            ) : (
              <input
                type="number" min={5} max={5000}
                value={topic.response_target}
                onChange={e => onChange({ ...topic, response_target: parseInt(e.target.value) || 30 })}
                className="w-24 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// -- Tags input ---------------------------------------------------------------

function TagsInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState('')

  const addTag = () => {
    const tag = input.trim()
    if (tag && !value.includes(tag)) {
      onChange([...value, tag])
      setInput('')
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {value.map((tag, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-xs text-gray-600">
            {tag}
            <button onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500">&times;</button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
        onBlur={addTag}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400"
      />
    </div>
  )
}

// -- Main component -----------------------------------------------------------

export default function NewSessionClient({ logoUrl, analyzeEnabled, campaignsEnabled, user }: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [config, setConfig] = useState<TownHallConfig>({
    ...DEFAULT_CONFIG,
    context: { ...DEFAULT_CONFIG.context, org_name: user.clientName || '' },
  })
  const [guide, setGuide] = useState<TownHallGuideTopic[]>([DEFAULT_TOPIC()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Description grader
  const [descGrade, setDescGrade] = useState<{ score: number; suggestion: string } | null>(null)
  const [grading, setGrading] = useState(false)
  const gradeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const gradeDescription = useCallback((desc: string, industry?: string) => {
    if (gradeTimer.current) clearTimeout(gradeTimer.current)
    if (!desc.trim()) { setDescGrade(null); return }
    gradeTimer.current = setTimeout(async () => {
      setGrading(true)
      try {
        const res = await fetch('/api/townhall/grade-description', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: desc, industry }),
        })
        const data = await res.json()
        setDescGrade({ score: data.score || 0, suggestion: data.suggestion || '' })
      } catch {}
      setGrading(false)
    }, 1200)
  }, [])

  // Sensitive topics AI
  const [suggestingTopics, setSuggestingTopics] = useState(false)
  const [suggestedCategories, setSuggestedCategories] = useState<{ name: string; terms: string[] }[] | null>(null)
  const suggestSensitiveTopics = async () => {
    setSuggestingTopics(true)
    setSuggestedCategories(null)
    try {
      const res = await fetch('/api/townhall/suggest-sensitive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: config.context.event_description,
          industry: config.industry,
          org_name: config.context.org_name,
          existing: config.context.sensitive_topics,
        }),
      })
      const data = await res.json()
      if (data.categories) setSuggestedCategories(data.categories)
    } catch {}
    setSuggestingTopics(false)
  }

  // Discussion guide AI
  const [generatingGuide, setGeneratingGuide] = useState(false)
  const [guideGenerated, setGuideGenerated] = useState(false)

  const generateGuide = async () => {
    if (!config.context.event_description?.trim()) return
    setGeneratingGuide(true)
    try {
      const res = await fetch('/api/townhall/suggest-guide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: config.context.event_description, industry: config.industry, org_name: config.context.org_name }),
      })
      const data = await res.json()
      if (data.topics?.length) {
        setGuide(data.topics.map((t: any) => ({
          id: generateId(),
          label: t.label || '',
          description: t.description || '',
          opening_question: t.opening_question || '',
          follow_up_angles: t.follow_up_angles || [],
          keywords: t.keywords || [],
          response_target: 30,
        })))
        setGuideGenerated(true)
      }
    } catch {}
    setGeneratingGuide(false)
  }

  // Step management (6 steps: Basics, Topics, Sensitive Topics, Conversation, Post-Session, Review)
  const [step, setStep] = useState(0)
  const [highestVisited, setHighestVisited] = useState(0)
  const goToStep = (i: number) => {
    setStep(i)
    setHighestVisited(prev => Math.max(prev, i))
  }

  const updateContext = (partial: Partial<TownHallConfig['context']>) => {
    setConfig(c => ({ ...c, context: { ...c.context, ...partial } }))
  }
  const updateEngine = (partial: Partial<TownHallConfig['engine']>) => {
    setConfig(c => ({ ...c, engine: { ...c.engine, ...partial } }))
  }
  const updateEnd = (partial: Partial<TownHallConfig['session_end']>) => {
    setConfig(c => ({ ...c, session_end: { ...c.session_end, ...partial } }))
  }
  const updateDisplay = (partial: Partial<TownHallConfig['display']>) => {
    setConfig(c => ({ ...c, display: { ...c.display, ...partial } }))
  }
  const updateSafety = (partial: Record<string, boolean>) => {
    setConfig(c => {
      const prev = c.content_safety || {}
      const cs = { profanity: true, slurs: true, threats: true, sexual: true, insults: true, spam: true, ...prev, ...partial }
      if (cs.enabled === undefined) cs.enabled = true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { ...c, content_safety: cs } as any
    })
  }

  const updateTopic = (idx: number, topic: TownHallGuideTopic) => {
    setGuide(g => g.map((t, i) => i === idx ? topic : t))
  }
  const removeTopic = (idx: number) => {
    setGuide(g => g.filter((_, i) => i !== idx))
  }
  const addTopic = () => {
    setGuide(g => [...g, DEFAULT_TOPIC()])
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('Session name is required'); return }
    if (!config.opening_message.trim()) { setError('Opening message is required'); return }
    if (guide.length === 0) { setError('Add at least one discussion topic'); return }
    if (guide.some(t => !t.label.trim() || !t.opening_question.trim())) {
      setError('All topics need a label and opening question'); return
    }

    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/townhall/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), slug: slug.trim() || undefined, config, discussion_guide: guide }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to create session')
        setSaving(false)
        return
      }
      const { id } = await res.json()
      router.push('/townhall/' + id)
    } catch {
      setError('Network error')
      setSaving(false)
    }
  }

  const canProceed = () => {
    if (step === 0) return !!name.trim() && !!config.opening_message.trim()
    if (step === 1) return guide.length > 0 && guide.every(t => t.label.trim() && t.opening_question.trim())
    return true // steps 2-5 always ok
  }

  return (
    <>
      <TopNav
        logoUrl={logoUrl}
        orgName={user.clientName}
        isAdmin={user.isAdmin}
        userEmail={user.email}
        fullName={user.fullName}
        analyzeEnabled={analyzeEnabled}
        campaignsEnabled={campaignsEnabled}
        currentPage="townhall"
      />

      <main className="pt-14 flex flex-col" style={{ height: 'calc(100vh - 56px)' }}>
        {/* Fixed header + step pills */}
        <div className="flex-shrink-0 border-b border-gray-100 bg-white px-5 py-3">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <button onClick={() => router.push('/townhall')} className="text-sm text-gray-400 hover:text-gray-600">&larr;</button>
                <h1 className="text-lg font-bold text-gray-900">New Town Hall</h1>
              </div>
            </div>
            <THCreatorNav
              name={name}
              config={config}
              guide={guide}
              currentStep={step}
              highestVisited={highestVisited}
              onStepClick={i => { if (i <= highestVisited || canProceed()) goToStep(i) }}
              onSave={handleSave}
              saving={saving}
            />
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-5 py-6">

          {/* Step 0: Basics */}
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <Label>Session name</Label>
                <Input value={name} onChange={setName} placeholder="e.g. Neighborhood Planning Town Hall — April 2026" />
              </div>

              <div>
                <Label sub="Custom link — lowercase letters, numbers, and hyphens">Participant link</Label>
                <div className="flex items-center gap-0">
                  <span className="text-sm text-gray-400 bg-gray-50 border border-r-0 border-gray-200 rounded-l-lg px-3 py-2">/th/</span>
                  <input type="text" value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder="e.g. neighborhood-meeting"
                    className="flex-1 px-3 py-2 rounded-r-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400" />
                </div>
              </div>

              <div>
                <Label>Industry</Label>
                <select
                  value={config.industry || ''}
                  onChange={e => setConfig(c => ({ ...c, industry: e.target.value || undefined }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400 bg-white"
                >
                  <option value="">Select industry (optional)</option>
                  {(Object.keys(INDUSTRY_LABELS) as Industry[]).sort((a, b) => INDUSTRY_LABELS[a].localeCompare(INDUSTRY_LABELS[b])).map(k => (
                    <option key={k} value={k}>{INDUSTRY_EMOJIS[k]} {INDUSTRY_LABELS[k]}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Bot name</Label>
                  <Input value={config.bot_name} onChange={v => setConfig(c => ({ ...c, bot_name: v }))} placeholder="e.g. CommunityBot" />
                </div>
                <div>
                  <Label>Bot emoji</Label>
                  <div className="flex items-center gap-2">
                    <EmojiPickerPopover
                      value={config.bot_emoji || '💬'}
                      onChange={v => setConfig(c => ({ ...c, bot_emoji: v }))}
                      industryEmojis={config.industry && config.industry !== 'other' ? (INDUSTRY_EMOJI_SETS[config.industry] || undefined) : undefined}
                      industryLabel={config.industry && config.industry !== 'other' ? (INDUSTRY_LABELS[config.industry as Industry] || undefined) : undefined}
                    />
                    <span className="text-xs text-gray-400">Click to pick</span>
                  </div>
                </div>
              </div>

              <div>
                <Label sub="Drives how the AI addresses participants and references peers">Session type</Label>
                <select value={config.session_type || 'community'}
                  onChange={e => setConfig(c => ({ ...c, session_type: e.target.value as any }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-300">
                  <option value="community">Community (residents, community)</option>
                  <option value="employee">Employee (team members, organization)</option>
                  <option value="customer">Customer (customers, customer base)</option>
                  <option value="student">Student (students, school community)</option>
                  <option value="member">Member (members, membership)</option>
                  <option value="other">Other (participants, group)</option>
                </select>
              </div>

              <div>
                <Label sub="Used to calculate % response targets per topic">Expected attendees</Label>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={config.expected_attendees || ''}
                  onChange={e => setConfig(c => ({ ...c, expected_attendees: parseInt(e.target.value) || undefined }))}
                  placeholder="e.g. 200"
                  className="w-32 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
              </div>

              <div>
                <Label>Organization name</Label>
                <Input value={config.context.org_name} onChange={v => updateContext({ org_name: v })} placeholder="e.g. City of Springfield Planning Department" />
              </div>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Label>Event description</Label>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-600">Most important field</span>
                  {grading && <span className="text-[10px] text-gray-400">Grading...</span>}
                  {!grading && descGrade && descGrade.score > 0 && (
                    <DescGradePill score={descGrade.score} />
                  )}
                </div>
                <p className="text-[11px] text-gray-400 mb-1.5">This description drives the AI moderator's context, topic suggestions, and sensitive topic detection. The more detail you provide, the better the AI performs.</p>
                <Textarea
                  value={config.context.event_description}
                  onChange={v => { updateContext({ event_description: v }); gradeDescription(v, config.industry) }}
                  placeholder="e.g. Community input session for the 2027 Neighborhood Development Plan. We're gathering resident feedback on transportation, parks, housing density, and school zoning. Audience is ~200 neighborhood residents. Goal: prioritize which projects to fund in the 2027-2029 capital budget."
                  rows={4}
                />
                {!grading && descGrade?.suggestion && (
                  <p className="text-[11px] text-amber-600 mt-1">{'\u2728'} {descGrade.suggestion}</p>
                )}
              </div>

              <div>
                <Label sub="Welcome text + opening question shown when a participant joins">Opening Message</Label>
                <Textarea
                  value={config.opening_message}
                  onChange={v => setConfig(c => ({ ...c, opening_message: v }))}
                  placeholder="e.g. Welcome! We'd love to hear your thoughts.\n\nWhat's the most important issue facing our neighborhood right now?"
                  rows={3}
                />
              </div>

              <div>
                <Label sub="Shown when the session ends or a participant finishes">Closing Message</Label>
                <Textarea
                  value={config.closing_message}
                  onChange={v => setConfig(c => ({ ...c, closing_message: v }))}
                  placeholder="Thank you for your time. Your voice matters."
                  rows={2}
                />
              </div>

              <div>
                <Label sub="How should the AI moderator sound?">Tone</Label>
                <Input value={config.context.tone} onChange={v => updateContext({ tone: v })} placeholder="e.g. warm, respectful, community-focused" />
              </div>

            </div>
          )}

          {/* Step 1: Seed Topics (Discussion Guide) */}
          {step === 1 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-gray-500">
                  Define the topics you want to explore. Participants will be assigned different starting topics
                  to ensure broad coverage across the room.
                </p>
                <button onClick={generateGuide} disabled={generatingGuide || !config.context.event_description?.trim()}
                  className="flex-shrink-0 ml-4 px-3 py-2 rounded-lg text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
                  style={{ background: '#7c3aed' }}
                  title="AI generates topics from your event description">
                  {generatingGuide ? 'Generating...' : '\u2728 Generate from Description'}
                </button>
              </div>

              <div className="space-y-4">
                {guide.map((topic, i) => (
                  <TopicCard
                    key={topic.id}
                    topic={topic}
                    index={i}
                    onChange={t => updateTopic(i, t)}
                    onRemove={() => removeTopic(i)}
                    industry={config.industry}
                    orgName={config.context.org_name}
                    eventDesc={config.context.event_description}
                    expectedAttendees={config.expected_attendees}
                  />
                ))}
              </div>

              <button
                onClick={addTopic}
                className="mt-4 px-4 py-2 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-orange-300 hover:text-orange-600 transition-colors w-full">
                + Add Topic
              </button>
            </div>
          )}

          {/* Step 2: Sensitive Topics */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Label sub="Topics the AI should never ask about">Sensitive topics</Label>
                  <button onClick={suggestSensitiveTopics}
                    disabled={suggestingTopics || (!config.context.event_description?.trim() && !config.industry)}
                    className="text-[10px] font-semibold px-2.5 py-1 rounded-lg text-white hover:opacity-90 disabled:opacity-50"
                    style={{ background: '#7c3aed' }}>
                    {suggestingTopics ? 'Suggesting...' : '\u2728 AI Suggest'}
                  </button>
                </div>

                {/* AI suggested categories */}
                {suggestedCategories && suggestedCategories.length > 0 && (
                  <div className="mb-3 p-3 rounded-xl border-2 border-purple-200 bg-purple-50/50 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-purple-600 uppercase">AI Suggestions — click to add</span>
                      <button onClick={() => setSuggestedCategories(null)} className="text-[10px] text-gray-400 hover:text-gray-600">&times; Close</button>
                    </div>
                    {suggestedCategories.map((cat, ci) => (
                      <div key={ci}>
                        <span className="text-[10px] font-bold text-gray-500">{cat.name}</span>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {cat.terms.map(term => {
                            const added = config.context.sensitive_topics.includes(term)
                            return (
                              <button key={term} disabled={added}
                                onClick={() => { if (!added) updateContext({ sensitive_topics: [...config.context.sensitive_topics, term] }) }}
                                className="text-[10px] px-2 py-0.5 rounded-full border transition-all disabled:opacity-40"
                                style={{ background: added ? '#e9d5ff' : 'white', borderColor: added ? '#c084fc' : '#e5e7eb', color: added ? '#7c3aed' : '#6b7280', cursor: added ? 'default' : 'pointer' }}>
                                {added ? '\u2713 ' : '+ '}{term}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                    <button onClick={() => {
                      const all = suggestedCategories.flatMap(c => c.terms)
                      const existing = new Set(config.context.sensitive_topics.map(t => t.toLowerCase()))
                      const newTerms = all.filter(t => !existing.has(t.toLowerCase()))
                      updateContext({ sensitive_topics: [...config.context.sensitive_topics, ...newTerms] })
                    }} className="text-[10px] font-semibold text-purple-600 hover:text-purple-800 mt-1">
                      + Add all suggestions
                    </button>
                  </div>
                )}

                {/* Current tags with expand toggles */}
                <div className="mb-1.5">
                  <ExpandableTerms
                    terms={config.context.sensitive_topics}
                    onChange={terms => updateContext({ sensitive_topics: terms })}
                    color="red"
                    context={config.context.event_description}
                  />
                </div>
                <SensitiveInput
                  onAdd={(term) => {
                    if (!config.context.sensitive_topics.includes(term)) {
                      updateContext({ sensitive_topics: [...config.context.sensitive_topics, term] })
                    }
                  }}
                  placeholder="Type a term and press Enter"
                />
              </div>

              <div>
                <Label sub="Topics to prioritize if they come up — press Enter to add">Priority areas</Label>
                <TagsInput value={config.context.priority_areas} onChange={v => updateContext({ priority_areas: v })} placeholder="e.g. issues affecting families with children" />
              </div>
            </div>
          )}

          {/* Step 3: Conversation Settings */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h3 className="text-sm font-bold text-gray-700 mb-4">Conversation Settings</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Max turns per participant</Label>
                    <input type="number" min={2} max={20} value={config.engine.max_turns_per_participant}
                      onChange={e => updateEngine({ max_turns_per_participant: parseInt(e.target.value) || 8 })}
                      className="w-24 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
                  </div>
                  <div>
                    <Label>Default response target</Label>
                    <input type="number" min={5} max={500} value={config.engine.default_response_target}
                      onChange={e => updateEngine({ default_response_target: parseInt(e.target.value) || 30 })}
                      className="w-24 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
                  </div>
                  <div>
                    <Label>AI timeout (ms)</Label>
                    <input type="number" min={1000} max={10000} step={500} value={config.engine.ai_timeout_ms}
                      onChange={e => updateEngine({ ai_timeout_ms: parseInt(e.target.value) || 3000 })}
                      className="w-28 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
                  </div>
                </div>

                {/* Testing mode */}
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-800">Testing Mode</div>
                      <div className="text-xs text-gray-500 mt-0.5">Show AI thinking process inline — useful for demos</div>
                    </div>
                    <button type="button" onClick={() => setConfig(prev => ({ ...prev, testing: !prev.testing }))}
                      className={'relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-4 border-2 border-transparent ' + ((config as any).testing ? 'bg-amber-500' : 'bg-gray-200')}>
                      <span className={'inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ' + ((config as any).testing ? 'translate-x-5' : 'translate-x-0')} />
                    </button>
                  </div>
                  <p className="text-[10px] text-amber-700 mt-1">Debug mode: type <code className="bg-white/60 px-1 rounded">#debug SESSION_ID</code> in chat or add <code className="bg-white/60 px-1 rounded">?debug=SESSION_ID</code> to the participant URL. The session ID (shown on the session card) is the password.</p>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h3 className="text-sm font-bold text-gray-700 mb-4">Session End</h3>
                <div className="space-y-3">
                  <div>
                    <Label>End mode</Label>
                    <select value={config.session_end.mode}
                      onChange={e => updateEnd({ mode: e.target.value as 'manual' | 'timed' | 'inactivity' })}
                      className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200">
                      <option value="manual">Manual — facilitator ends it</option>
                      <option value="timed">Timed — auto-end after duration</option>
                      <option value="inactivity">Inactivity — auto-end after quiet period</option>
                    </select>
                  </div>
                  {config.session_end.mode === 'timed' && (
                    <div>
                      <Label>Duration (minutes)</Label>
                      <input type="number" min={5} max={480} value={config.session_end.duration_minutes || 90}
                        onChange={e => updateEnd({ duration_minutes: parseInt(e.target.value) || 90 })}
                        className="w-24 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
                    </div>
                  )}
                  {config.session_end.mode === 'inactivity' && (
                    <div>
                      <Label>Inactivity timeout (minutes)</Label>
                      <input type="number" min={5} max={120} value={config.session_end.inactivity_timeout_minutes || 30}
                        onChange={e => updateEnd({ inactivity_timeout_minutes: parseInt(e.target.value) || 30 })}
                        className="w-24 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h3 className="text-sm font-bold text-gray-700 mb-4">Button Labels</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Skip button text</Label>
                    <Input value={config.display.skip_label} onChange={v => updateDisplay({ skip_label: v })} />
                  </div>
                  <div>
                    <Label>Done button text</Label>
                    <Input value={config.display.done_label} onChange={v => updateDisplay({ done_label: v })} />
                  </div>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-gray-700">Content Safety</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Filter and bleep inappropriate content. Participants get warnings and may be shut down after repeated severe violations.</p>
                  </div>
                  <button type="button" onClick={() => {
                    const on = config.content_safety?.enabled !== false
                    updateSafety({ enabled: !on, profanity: !on, slurs: !on, threats: !on, sexual: !on, insults: !on, spam: !on })
                  }}
                    className={'relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-4 border-2 border-transparent ' + (config.content_safety?.enabled !== false ? 'bg-green-500' : 'bg-gray-200')}>
                    <span className={'inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ' + (config.content_safety?.enabled !== false ? 'translate-x-5' : 'translate-x-0')} />
                  </button>
                </div>
                {config.content_safety?.enabled !== false && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-3 mb-2">
                      <button type="button" onClick={() => updateSafety({ profanity: true, slurs: true, threats: true, sexual: true, insults: true, spam: true })}
                        className="text-[10px] font-semibold text-orange-600 hover:text-orange-800">Select All</button>
                      <button type="button" onClick={() => updateSafety({ profanity: false, slurs: false, threats: false, sexual: false, insults: false, spam: false })}
                        className="text-[10px] font-semibold text-gray-400 hover:text-gray-600">Select None</button>
                    </div>
                    {[
                      { key: 'profanity', label: 'Profanity', desc: 'Block/bleep swear words' },
                      { key: 'slurs', label: 'Slurs', desc: 'Block racial and identity slurs' },
                      { key: 'threats', label: 'Threats & Violence', desc: 'Block violent language and threats' },
                      { key: 'sexual', label: 'Sexual Content', desc: 'Block explicit sexual language' },
                      { key: 'insults', label: 'Insults & Rudeness', desc: 'Gentle nudge when participants are rude' },
                      { key: 'spam', label: 'URLs / Spam', desc: 'Block links and URLs' },
                    ].map(opt => {
                      const on = (config.content_safety as any)?.[opt.key] !== false
                      return (
                        <button key={opt.key} type="button" onClick={() => updateSafety({ [opt.key]: !on })}
                          className="flex items-center gap-2 w-full text-left px-3 py-1.5 rounded-lg text-sm transition-all"
                          style={{ background: on ? '#f0fdf4' : '#f9fafb', border: '1.5px solid ' + (on ? '#22c55e' : '#e5e7eb') }}>
                          <span className="w-4 h-4 rounded border flex items-center justify-center text-[10px] flex-shrink-0"
                            style={{ borderColor: on ? '#22c55e' : '#d1d5db', background: on ? '#22c55e' : 'white', color: on ? 'white' : 'transparent' }}>
                            {on ? '\u2713' : ''}
                          </span>
                          <span className="flex-1">
                            <span style={{ color: on ? '#166534' : '#6b7280', fontWeight: on ? 600 : 400 }}>{opt.label}</span>
                            <span className="text-[10px] text-gray-400 ml-2">{opt.desc}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
                {config.content_safety?.enabled === false && (
                  <p className="text-[10px] text-amber-600">All content filtering is OFF. Suitable for employee feedback or clinical research settings.</p>
                )}
              </div>
            </div>
          )}

          {/* Step 4: Post-Session */}
          {step === 4 && (
            <div className="space-y-6">
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h3 className="text-sm font-bold text-gray-700 mb-4">Languages</h3>
                <p className="text-xs text-gray-400 mb-3">Select the languages participants can use. If multiple are selected, participants will choose their language before joining.</p>
                <div className="flex flex-wrap gap-2">
                  {SUPPORTED_LANGUAGES.map(l => {
                    const checked = (config.languages || []).includes(l.code)
                    const isEn = l.code === 'en'
                    return (
                      <button key={l.code} type="button" disabled={isEn} onClick={() => {
                        const current = config.languages || []
                        const next = checked ? current.filter((c: string) => c !== l.code) : [...current, l.code]
                        setConfig(c => ({ ...c, languages: next }))
                      }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all"
                        style={{
                          background: checked ? '#fff4ef' : '#f9fafb',
                          border: '1.5px solid ' + (checked ? HERMES : '#e5e7eb'),
                          cursor: isEn ? 'default' : 'pointer',
                          opacity: isEn ? 0.7 : 1,
                        }}>
                        <span className="w-4 h-4 rounded border flex items-center justify-center text-[10px] flex-shrink-0"
                          style={{
                            borderColor: checked ? HERMES : '#d1d5db',
                            background: checked ? HERMES : 'white',
                            color: checked ? 'white' : 'transparent',
                          }}>
                          {checked ? '\u2713' : ''}
                        </span>
                        <span style={{ color: checked ? HERMES : '#6b7280', fontWeight: checked ? 600 : 400 }}>
                          {l.nativeName}
                        </span>
                        {l.name !== l.nativeName && <span className="text-xs" style={{ color: '#9ca3af' }}>{l.name}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h3 className="text-sm font-bold text-gray-700 mb-2">When to Ask</h3>
                <p className="text-xs text-gray-400 mb-3">Should demographic and psychographic questions be asked before or after the conversation?</p>
                <div className="flex gap-2">
                  {(['before', 'after'] as const).map(pos => {
                    const active = (config.questionPosition || 'after') === pos
                    return (
                      <button key={pos} type="button" onClick={() => setConfig(c => ({ ...c, questionPosition: pos }))}
                        className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
                        style={{
                          background: active ? '#fff4ef' : '#f9fafb',
                          border: '1.5px solid ' + (active ? HERMES : '#e5e7eb'),
                          color: active ? HERMES : '#6b7280',
                        }}>
                        {pos === 'before' ? 'Before conversation' : 'After conversation'}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h3 className="text-sm font-bold text-gray-700 mb-2">Demographics</h3>
                <p className="text-xs text-gray-400 mb-4">{(config.questionPosition || 'after') === 'before' ? 'Before the conversation starts, participants can optionally answer these questions.' : 'After the conversation ends, participants can optionally answer these questions.'}</p>
                <div className="space-y-1">
                  {DEMO_BANK.map(d => {
                    const current = config.demoFields || DEMO_BANK.map(b => ({ ...b, enabled: b.key === 'age' || b.key === 'gender' || b.key === 'zip' }))
                    const enabled = current.find(f => f.key === d.key)?.enabled ?? false
                    return (
                      <button key={d.key} type="button" onClick={() => {
                        const next = current.map(f => f.key === d.key ? { ...f, enabled: !enabled } : f)
                        setConfig(c => ({ ...c, demoFields: next }))
                      }}
                        className="flex items-center gap-2 w-full text-left px-3 py-1.5 rounded-lg text-sm transition-all"
                        style={{ background: enabled ? '#fff4ef' : '#f9fafb', border: '1.5px solid ' + (enabled ? HERMES : '#e5e7eb') }}>
                        <span className="w-4 h-4 rounded border flex items-center justify-center text-[10px] flex-shrink-0"
                          style={{ borderColor: enabled ? HERMES : '#d1d5db', background: enabled ? HERMES : 'white', color: enabled ? 'white' : 'transparent' }}>
                          {enabled ? '\u2713' : ''}
                        </span>
                        <span style={{ color: enabled ? HERMES : '#6b7280', fontWeight: enabled ? 600 : 400 }}>{d.label}</span>
                        <span className="text-[10px] text-gray-400 ml-auto">{d.type}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h3 className="text-sm font-bold text-gray-700 mb-2">Psychographic Questions</h3>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs text-gray-400">Show</span>
                  <input type="number" min={0} max={15} value={config.psychoCount || 3}
                    onChange={e => setConfig(c => ({ ...c, psychoCount: parseInt(e.target.value) || 0 }))}
                    className="w-16 px-2 py-1 rounded border border-gray-200 text-xs" />
                  <span className="text-xs text-gray-400">random questions per participant</span>
                </div>
                <div className="space-y-1">
                  {GENERAL_PSYCHO_BANK.map(pq => {
                    const inBank = (config.psychographicBank || []).some((b: any) => b.key === pq.key)
                    return (
                      <button key={pq.key} type="button" onClick={() => {
                        const current = config.psychographicBank || []
                        const next = inBank ? current.filter((b: any) => b.key !== pq.key) : [...current, { key: pq.key, q: pq.q, opts: pq.opts }]
                        setConfig(c => ({ ...c, psychographicBank: next }))
                      }}
                        className="flex items-center gap-2 w-full text-left px-3 py-1.5 rounded-lg text-sm transition-all"
                        style={{ background: inBank ? '#fff4ef' : '#f9fafb', border: '1.5px solid ' + (inBank ? HERMES : '#e5e7eb') }}>
                        <span className="w-4 h-4 rounded border flex items-center justify-center text-[10px] flex-shrink-0"
                          style={{ borderColor: inBank ? HERMES : '#d1d5db', background: inBank ? HERMES : 'white', color: inBank ? 'white' : 'transparent' }}>
                          {inBank ? '\u2713' : ''}
                        </span>
                        <span className="flex-1" style={{ color: inBank ? HERMES : '#6b7280', fontWeight: inBank ? 600 : 400 }}>{pq.q}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Review */}
          {step === 5 && (
            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h3 className="text-sm font-bold text-gray-700 mb-2">Session</h3>
                <p className="text-sm text-gray-600">{name || '(no name)'}</p>
                <p className="text-xs text-gray-400 mt-1">{config.context.org_name} &middot; {config.context.tone}</p>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h3 className="text-sm font-bold text-gray-700 mb-3">Seed Topics ({guide.length} topic{guide.length !== 1 ? 's' : ''})</h3>
                <div className="space-y-2">
                  {guide.map((t, i) => (
                    <div key={t.id} className="flex items-start gap-2">
                      <span className="text-xs font-bold text-gray-400 mt-0.5">{i + 1}.</span>
                      <div>
                        <span className="text-sm font-medium text-gray-700">{t.label}</span>
                        <p className="text-xs text-gray-400">{t.opening_question}</p>
                        <span className="text-[10px] text-gray-300">Target: {t.response_target} responses</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h3 className="text-sm font-bold text-gray-700 mb-2">Settings</h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                  <span className="text-gray-400">Opening question</span>
                  <span className="text-gray-600 whitespace-pre-wrap">{config.opening_message || '(not set)'}</span>
                  <span className="text-gray-400">Max turns</span>
                  <span className="text-gray-600">{config.engine.max_turns_per_participant}</span>
                  <span className="text-gray-400">End mode</span>
                  <span className="text-gray-600">{config.session_end.mode}{config.session_end.mode === 'timed' ? (' (' + config.session_end.duration_minutes + ' min)') : ''}</span>
                </div>
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>
              )}
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-8 pt-5 border-t border-gray-100">
            <button
              onClick={() => goToStep(Math.max(0, step - 1))}
              disabled={step === 0}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed">
              &larr; Back
            </button>

            {step < TH_STEP_LABELS.length - 1 ? (
              <button
                onClick={() => goToStep(step + 1)}
                disabled={!canProceed()}
                className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: HERMES }}>
                Next &rarr;
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                style={{ background: HERMES }}>
                {saving ? 'Creating...' : 'Create Session'}
              </button>
            )}
          </div>
          </div>
        </div>
      </main>
    </>
  )
}
