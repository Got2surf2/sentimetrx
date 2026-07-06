'use client'

// app/bots/new/page.tsx
// Bot creator/editor — create or edit a branded chatbot

import { useState, useEffect, useRef, Suspense } from 'react'
import GhostTextarea from '@/components/ui/GhostTextarea'
import { useRouter, useSearchParams } from 'next/navigation'
import LottieLoader from '@/components/ui/LottieLoader'
import TransferOrg from '@/components/ui/TransferOrg'
import EmojiPickerPopover from '@/components/creator/EmojiPickerPopover'
import { SUPPORTED_LANGUAGES } from '@/lib/types'
import ContentSafetyEditor, { type ContentSafetyConfigValue } from '@/components/agent/ContentSafetyEditor'

const HERMES = '#E8632A'

const HERMES_LIGHT = '#fff7ed'

const STEP_LABELS = ['Identity', 'Knowledge', 'Competitors', 'Controls', 'Monitoring']

interface BotConfig {
  name: string
  subtitle: string
  avatarLetter: string
  headerGradient: string
  avatarGradient: string
  avatarTextColor: string
  accentColor: string
  pageBg: string
  userBubbleBg: string
  websiteUrl: string
  websiteLabel: string
  placeholder: string
  fontFamily: string
  initialMessage: string
  suggestions: string[]
  language: string
  languages: string[]
  askName: string
  dynamicChips?: boolean
  content_safety?: ContentSafetyConfigValue
}

const DEFAULT_CONFIG: BotConfig = {
  name: '',
  subtitle: '',
  avatarLetter: '',
  headerGradient: 'linear-gradient(135deg, #0a1628, #1a2d4a)',
  avatarGradient: 'linear-gradient(135deg, #00b4d8, #0077a8)',
  avatarTextColor: '',
  accentColor: '#00b4d8',
  pageBg: '#f8fafc',
  userBubbleBg: '#0a1628',
  websiteUrl: '',
  websiteLabel: '',
  placeholder: 'Ask me anything...',
  fontFamily: '',
  initialMessage: "Hi! How can I help you today?",
  suggestions: [],
  language: 'en',
  languages: ['en'],
  askName: 'true',
  dynamicChips: false,
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 10 }}>{title}</h3>
      {children}
    </div>
  )
}

function InfoTip({ text }: { text: string }) {
  var [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={function(e) { e.stopPropagation(); setOpen(!open) }}
        onMouseEnter={function() { setOpen(true) }}
        onMouseLeave={function() { setOpen(false) }}
        style={{
          width: 20, height: 20, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.4)',
          background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.8)',
          fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center', fontStyle: 'italic', fontFamily: 'Georgia, serif',
        }}>i</button>
      {open && (
        <div style={{
          position: 'absolute', top: 28, left: '50%', transform: 'translateX(-50%)',
          background: '#1F2937', color: '#F9FAFB', padding: '10px 14px', borderRadius: 10,
          fontSize: 12, lineHeight: 1.5, width: 280, zIndex: 50, boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          whiteSpace: 'normal',
        }}>
          <div style={{ position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)', width: 12, height: 12, background: '#1F2937', rotate: '45deg', borderRadius: 2 }} />
          {text}
        </div>
      )}
    </span>
  )
}

function Group({ title, subtitle, color, info, children }: { title: string; subtitle: string; color: string; info?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ background: color, borderRadius: '12px 12px 0 0', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'white' }}>{title}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>{subtitle}</div>
        </div>
        {info && <InfoTip text={info} />}
      </div>
      <div style={{ background: 'white', borderRadius: '0 0 12px 12px', border: '1px solid #e5e7eb', borderTop: 'none', padding: 24 }}>
        {children}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text', small }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; small?: boolean
}) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={function(e) { onChange(e.target.value) }}
        placeholder={placeholder}
        style={{
          display: 'block', width: '100%', marginTop: 4,
          padding: small ? '6px 10px' : '8px 12px', borderRadius: 8,
          border: '1px solid #d1d5db', fontSize: 13, outline: 'none',
        }}
      />
    </label>
  )
}

export default function EditAgentClient() {
  return <Suspense fallback={<div className="flex items-center justify-center py-32"><LottieLoader size={80} /></div>}><BotCreatorInner /></Suspense>
}

function BotCreatorInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editId = searchParams.get('edit')

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [loadedUpdatedAt, setLoadedUpdatedAt] = useState<string | null>(null)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [personality, setPersonality] = useState('')
  const [knowledgeBase, setKnowledgeBase] = useState('')
  const [trainingUrls, setTrainingUrls] = useState('')
  const [fetchingUrls, setFetchingUrls] = useState(false)
  const [reviewInterval, setReviewInterval] = useState<string>('')
  const [config, setConfig] = useState<BotConfig>(DEFAULT_CONFIG)
  const [suggestions, setSuggestions] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(!!editId)
  const [researchQuery, setResearchQuery] = useState('')
  const [researching, setResearching] = useState(false)
  const [researchSources, setResearchSources] = useState<string[]>([])
  const [crawlUrl, setCrawlUrl] = useState('')
  const [crawling, setCrawling] = useState(false)
  const [crawlResult, setCrawlResult] = useState<{ pages: number; sites: number } | null>(null)
  const [faq, setFaq] = useState<{ question: string; answer: string }[]>([])
  const [facts, setFacts] = useState<string[]>([])
  const [guardrails, setGuardrails] = useState<string[]>([])
  const [subject, setSubject] = useState('')
  const [negativeContentMode, setNegativeContentMode] = useState('deflect')
  const [opponents, setOpponents] = useState<{ name: string; details: string }[]>([])
  const [contrastMode, setContrastMode] = useState('user_triggered')
  const [sensitiveTopics, setSensitiveTopics] = useState<string[]>([])
  const [focusTopics, setFocusTopics] = useState<string[]>([])
  const [deflectionEnabled, setDeflectionEnabled] = useState(true)
  const [deflectionMessage, setDeflectionMessage] = useState('')
  const [askProfile, setAskProfile] = useState(false)
  const [profileQuestion, setProfileQuestion] = useState('')
  const [newSensitiveTopic, setNewSensitiveTopic] = useState('')
  const [newFocusTopic, setNewFocusTopic] = useState('')
  const [intents, setIntents] = useState<{ label: string; description: string; keywords: string; url: string; message: string; enabled: boolean }[]>([])
  const [focuses, setFocuses] = useState<{ slug: string; label: string; description: string; enabled: boolean }[]>([])
  const [suggestingFocuses, setSuggestingFocuses] = useState(false)
  // Research probes (BOTS.md §14) — editor rows carry the raw JSONB object so
  // fields the compact UI doesn't expose (topic triggers, field window, …)
  // survive a save. origQuestion powers the §14.2 rule-7 version auto-bump.
  interface ProbeRow { raw: Record<string, unknown>; id: string; question: string; origQuestion: string; mode: 'verbatim' | 'concept'; construct: string; answerSchema: string; followUp: boolean; samplePct: number; targetN: number; minTurns: number; enabled: boolean }
  const [researchProbes, setResearchProbes] = useState<ProbeRow[]>([])
  const [demographicInference, setDemographicInference] = useState(false)
  const [builderMode, setBuilderMode] = useState<'assisted' | 'expert'>(editId ? 'expert' : 'assisted')
  const [step, setStep] = useState(0)
  const [showBehavior, setShowBehavior] = useState(false)
  // Tracks whether ANY persisted field has changed since the page loaded
  // (or since the last successful save). Drives the Save button's enabled
  // state in the sticky header. Set true by the watcher useEffect on every
  // change, reset to false on initial load completion + after a successful
  // save. Skips the very first effect fire so loading defaults doesn't
  // mark the form dirty.
  const [dirty, setDirty] = useState(false)
  const dirtyInitRef = useRef(true)

  // Load existing bot if editing
  useEffect(function() {
    if (!editId) return
    fetch('/api/bots/' + editId).then(function(r) { return r.json() }).then(function(bot) {
      // Re-arm the dirty watcher INSIDE .then() (not before the fetch) —
      // by the time we get here, the watcher has already consumed its
      // mount-time swallow, so we need a fresh arm right before the setter
      // cascade. Otherwise loading the bot's own values would falsely mark
      // the form dirty — orange Save button before the user has typed.
      dirtyInitRef.current = true
      if (bot.updated_at) setLoadedUpdatedAt(bot.updated_at as string)
      setName(bot.name || '')
      setSlug(bot.slug || '')
      setSystemPrompt(bot.system_prompt || '')
      setPersonality(bot.personality || '')
      setKnowledgeBase(bot.knowledge_base || '')
      setTrainingUrls((bot.training_urls || []).join('\n'))
      setSuggestions((bot.config?.suggestions || []).join('\n'))
      setConfig({ ...DEFAULT_CONFIG, ...bot.config })
      if (bot.review_interval_hours) setReviewInterval(String(bot.review_interval_hours))
      if (bot.subject) setSubject(bot.subject)
      if (bot.negative_content_mode) setNegativeContentMode(bot.negative_content_mode)
      if (Array.isArray(bot.opponents)) setOpponents(bot.opponents)
      if (bot.contrast_mode) setContrastMode(bot.contrast_mode)
      if (Array.isArray(bot.faq)) setFaq(bot.faq)
      if (Array.isArray(bot.facts)) setFacts(bot.facts.map(function(f: any) { return typeof f === 'string' ? f : f.text || '' }))
      if (Array.isArray(bot.guardrails)) setGuardrails(bot.guardrails.map(function(g: any) { return typeof g === 'string' ? g : g.rule || g.text || '' }))
      if (Array.isArray(bot.sensitive_topics)) setSensitiveTopics(bot.sensitive_topics)
      if (Array.isArray(bot.focus_topics)) setFocusTopics(bot.focus_topics)
      if (bot.deflection_enabled === false) setDeflectionEnabled(false)
      if (bot.deflection_message) setDeflectionMessage(bot.deflection_message)
      if (bot.ask_profile) setAskProfile(true)
      if (bot.profile_question) setProfileQuestion(bot.profile_question)
      if (bot.demographic_inference) setDemographicInference(true)
      if (Array.isArray(bot.intents)) setIntents(bot.intents.map(function(i: any) {
        return { label: i.label || '', description: i.description || '', keywords: (i.keywords || []).join(', '), url: i.url || '', message: i.message || '', enabled: i.enabled !== false }
      }))
      if (Array.isArray(bot.focuses)) setFocuses(bot.focuses.map(function(f: any) {
        return { slug: f.slug || '', label: f.label || '', description: f.description || '', enabled: f.enabled !== false }
      }))
      if (Array.isArray(bot.research_probes)) setResearchProbes(bot.research_probes.map(function(p: { id?: string; question?: string; mode?: string; construct?: string; answer_schema?: string; follow_up?: number; enabled?: boolean; sampling?: { sample_pct?: number; target_n?: number }; eligibility?: { min_user_turns?: number } }) {
        return {
          raw: p as Record<string, unknown>, id: p.id || '', question: p.question || '', origQuestion: p.question || '',
          mode: p.mode === 'concept' ? 'concept' as const : 'verbatim' as const, construct: p.construct || '',
          answerSchema: p.answer_schema || 'open', followUp: p.follow_up === 1,
          samplePct: p.sampling?.sample_pct ?? 25, targetN: p.sampling?.target_n ?? 0,
          minTurns: p.eligibility?.min_user_turns ?? 3, enabled: p.enabled !== false,
        }
      }))
    }).catch(function() {
      setError('Failed to load agent')
    }).finally(function() {
      setLoading(false)
      // After load, snap back to clean: dirtyInitRef will swallow the
      // setter cascade above, but in case any setters fire later we
      // explicitly clear.
      setDirty(false)
    })
  }, [editId])

  // Watcher — flips `dirty` to true on any change to a persisted field.
  // Skips the very first fire (initial mount + the load effect), which is
  // what dirtyInitRef gates. Reset to false after save success.
  useEffect(function() {
    if (dirtyInitRef.current) { dirtyInitRef.current = false; return }
    setDirty(true)
  }, [name, slug, systemPrompt, personality, knowledgeBase, trainingUrls, suggestions, config,
      reviewInterval, faq, facts, guardrails, subject, negativeContentMode, opponents,
      contrastMode, sensitiveTopics, focusTopics, deflectionEnabled, deflectionMessage,
      askProfile, profileQuestion, intents, focuses, demographicInference])

  function autoSlug(n: string) {
    return n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
  }

  function updateConfig(key: keyof BotConfig, value: string | boolean) {
    setConfig(function(prev) { return { ...prev, [key]: value } })
  }

  async function runResearch() {
    if (!researchQuery.trim()) return
    setResearching(true)
    setError('')
    setResearchSources([])
    try {
      var res = await fetch('/api/bots/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: researchQuery.trim() }),
      })
      var data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Research failed')
      setKnowledgeBase(function(prev) {
        return (prev ? prev + '\n\n' : '') + '--- RESEARCH: ' + researchQuery.trim() + ' ---\n' + data.knowledge
      })
      setResearchSources(data.sources || [])
    } catch (err: any) {
      setError(err.message || 'Research failed')
    }
    setResearching(false)
  }

  async function runDeepCrawl() {
    if (!crawlUrl.trim()) return
    setCrawling(true)
    setError('')
    setCrawlResult(null)
    try {
      var res = await fetch('/api/bots/deep-crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: crawlUrl.trim() }),
      })
      var data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Crawl failed')
      setKnowledgeBase(function(prev) {
        return (prev ? prev + '\n\n' : '') + data.text
      })
      setCrawlResult({ pages: data.pages_crawled, sites: data.sites_crawled || 1 })
    } catch (err: any) {
      setError(err.message || 'Deep crawl failed')
    }
    setCrawling(false)
  }

  async function fetchTrainingContent() {
    var urls = trainingUrls.split('\n').map(function(u) { return u.trim() }).filter(Boolean)
    if (urls.length === 0) return

    setFetchingUrls(true)
    setError('')
    var extracted: string[] = []

    for (var i = 0; i < urls.length; i++) {
      try {
        var res = await fetch('/api/bots/fetch-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: urls[i] }),
        })
        var data = await res.json()
        if (data.text) extracted.push('--- ' + urls[i] + ' ---\n' + data.text)
      } catch {
        extracted.push('--- ' + urls[i] + ' --- (failed to fetch)')
      }
    }

    setKnowledgeBase(function(prev) {
      return (prev ? prev + '\n\n' : '') + extracted.join('\n\n')
    })
    setFetchingUrls(false)
  }

  async function save() {
    if (!name.trim()) { setError('Name is required'); return }
    if (!slug.trim()) { setError('URL slug is required'); return }

    setSaving(true)
    setError('')

    var fullConfig = {
      ...config,
      name: name,
      avatarLetter: config.avatarLetter || name.charAt(0).toUpperCase(),
      suggestions: suggestions.split('\n').map(function(s) { return s.trim() }).filter(Boolean),
      initialMessage: config.initialMessage,
    }

    var riHours = parseInt(reviewInterval) || null
    var cleanFaq = faq.filter(function(f) { return f.question.trim() && f.answer.trim() })
    var cleanFacts = facts.filter(function(f) { return f.trim() })
    var cleanGuardrails = guardrails.filter(function(g) { return g.trim() })
    var payload: any = {
      name: name.trim(),
      slug: slug.trim(),
      config: fullConfig,
      system_prompt: systemPrompt,
      personality: personality,
      knowledge_base: knowledgeBase,
      training_urls: trainingUrls.split('\n').map(function(u) { return u.trim() }).filter(Boolean),
      review_interval_hours: riHours,
      faq: cleanFaq,
      facts: cleanFacts,
      guardrails: cleanGuardrails,
      subject: subject.trim(),
      negative_content_mode: negativeContentMode,
      opponents: opponents.filter(function(o) { return o.name.trim() }),
      contrast_mode: contrastMode,
      sensitive_topics: sensitiveTopics,
      focus_topics: focusTopics,
      deflection_enabled: deflectionEnabled,
      deflection_message: deflectionMessage,
      ask_profile: askProfile,
      profile_question: profileQuestion,
      demographic_inference: demographicInference,
      intents: intents.filter(function(i) { return i.label.trim() }).map(function(i) {
        return { label: i.label.trim(), description: i.description.trim(), keywords: i.keywords.split(',').map(function(k) { return k.trim() }).filter(Boolean), url: i.url.trim(), message: i.message.trim(), enabled: i.enabled }
      }),
      focuses: focuses.filter(function(f) { return f.slug.trim() && f.label.trim() }).map(function(f) {
        return { slug: autoSlug(f.slug), label: f.label.trim(), description: f.description.trim(), enabled: f.enabled }
      }),
      research_probes: researchProbes.filter(function(p) { return p.id.trim() && p.question.trim() }).map(function(p) {
        // Any wording change mints a new version (§14.2 rule 7) — analysis
        // and quota counters only aggregate within a version.
        var version = (p.raw.version as number) || 1
        if (p.origQuestion && p.question.trim() !== p.origQuestion) version = version + 1
        return {
          ...p.raw,
          id: autoSlug(p.id), version, mode: p.mode, question: p.question.trim(),
          construct: p.construct.trim() || undefined, answer_schema: p.answerSchema,
          follow_up: p.followUp ? 1 : 0, enabled: p.enabled,
          eligibility: { ...(p.raw.eligibility || {}), min_user_turns: p.minTurns },
          sampling: { ...(p.raw.sampling || {}), sample_pct: p.samplePct, target_n: p.targetN > 0 ? p.targetN : undefined },
        }
      }),
    }
    if (riHours) payload.next_review_at = new Date(Date.now() + riHours * 3600000).toISOString()

    try {
      var url = editId ? '/api/bots/' + editId : '/api/bots'
      var method = editId ? 'PATCH' : 'POST'
      var res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      var data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')

      // Auto-chunk knowledge base + FAQ + facts for RAG search (replaces old chunks)
      var botId = editId || data.id
      if (botId) {
        try {
          await fetch('/api/bots/' + botId + '/knowledge', { method: 'DELETE' })
          // Build combined text: knowledge base + FAQ pairs + facts
          var chunkParts: string[] = []
          if (knowledgeBase.trim().length > 20) chunkParts.push(knowledgeBase)
          if (cleanFaq.length > 0) {
            var faqText = '## Frequently Asked Questions\n\n' + cleanFaq.map(function(f) {
              return '### ' + f.question + '\n' + f.answer
            }).join('\n\n')
            chunkParts.push(faqText)
          }
          if (cleanFacts.length > 0) {
            var factsText = '## Key Facts\n\n' + cleanFacts.map(function(f, i) {
              return '### Fact ' + (i + 1) + '\n' + f
            }).join('\n\n')
            chunkParts.push(factsText)
          }
          if (chunkParts.length > 0) {
            await fetch('/api/bots/' + botId + '/knowledge', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: chunkParts.join('\n\n') }),
            })
          }
          // Chunk opponent research separately (so it gets tagged with opponent metadata)
          var cleanOpponents = opponents.filter(function(o) { return o.name.trim() && o.details.trim() })
          if (cleanOpponents.length > 0) {
            var oppoText = '## Opponent Research\n\n' + cleanOpponents.map(function(o) {
              return '### ' + o.name.trim() + ' (Opponent)\n' + o.details
            }).join('\n\n')
            await fetch('/api/bots/' + botId + '/knowledge', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: oppoText }),
            })
          }
        } catch {} // non-fatal — bot still works with full-text fallback
      }

      setDirty(false)
      router.push('/bots')
    } catch (err: any) {
      setError(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center py-32"><LottieLoader size={80} /></div>

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb' }}>
      {/* Fixed editor header — Cancel + Save always visible at top so the
         user doesn't have to scroll to either. Save is greyed until any
         persisted field changes (dirty=true), then becomes the primary
         action. Sits below the global TopNav (top: 56px). Position is
         fixed (not sticky) because the page wrapper is a flex column
         which interferes with sticky containment in some browsers. The
         spacer div below this header reserves equivalent vertical space
         so the form content isn't covered. */}
      <div style={{ position: 'fixed', top: 56, left: 0, right: 0, zIndex: 30, background: 'white', borderBottom: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{editId ? 'Edit Agent' : 'Create Agent'}{name ? ' — ' + name : ''}</h1>
            <p style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
              {dirty ? 'Unsaved changes' : (editId ? 'No changes yet' : 'Configure your branded AI agent')}
              {editId && loadedUpdatedAt && (
                <span style={{ marginLeft: 8, color: '#9ca3af' }} title={new Date(loadedUpdatedAt).toLocaleString()}>
                  · Last updated {(function() {
                    var ms = Date.now() - new Date(loadedUpdatedAt).getTime()
                    if (ms < 60000) return 'just now'
                    if (ms < 3600000) return Math.floor(ms / 60000) + 'm ago'
                    if (ms < 86400000) return Math.floor(ms / 3600000) + 'h ago'
                    var days = Math.floor(ms / 86400000)
                    if (days < 30) return days + 'd ago'
                    return new Date(loadedUpdatedAt).toLocaleDateString()
                  })()}
                </span>
              )}
              {editId && (
                <a href={'/bots/' + editId + '/history'} style={{ marginLeft: 8, color: '#3b82f6', textDecoration: 'none', fontSize: 11 }}>View history →</a>
              )}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {/* Mode toggle */}
            <div style={{ display: 'flex', borderRadius: 20, border: '1px solid #d1d5db', overflow: 'hidden' }}>
              <button onClick={function() { setBuilderMode('assisted'); setStep(0) }}
                style={{ padding: '5px 14px', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  background: builderMode === 'assisted' ? HERMES : 'white', color: builderMode === 'assisted' ? 'white' : '#6b7280' }}>
                Assisted
              </button>
              <button onClick={function() { setBuilderMode('expert') }}
                style={{ padding: '5px 14px', border: 'none', borderLeft: '1px solid #d1d5db', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  background: builderMode === 'expert' ? HERMES : 'white', color: builderMode === 'expert' ? 'white' : '#6b7280' }}>
                Expert
              </button>
            </div>
            <button onClick={function() {
              if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return
              router.push('/bots')
            }}
              style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={() => { void save() }} disabled={saving || !dirty}
              style={{
                padding: '7px 18px', borderRadius: 8, border: 'none',
                background: (saving || !dirty) ? '#e5e7eb' : HERMES,
                color: (saving || !dirty) ? '#9ca3af' : 'white',
                fontSize: 12, fontWeight: 700,
                cursor: (saving || !dirty) ? 'not-allowed' : 'pointer',
                transition: 'background .12s, color .12s',
              }}>
              {saving ? 'Saving…' : editId ? 'Save changes' : 'Create agent'}
            </button>
          </div>
        </div>
      </div>

      {/* Spacer to reserve the vertical space the now-fixed header occupies.
          Header padding 14px top + 14px bottom + ~40px content row = ~68px.
          Round to 72 for breathing room. */}
      <div style={{ height: 72 }} aria-hidden="true" />

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 24px 32px' }}>

        {/* Stepper (assisted mode) */}
        {builderMode === 'assisted' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 24 }}>
            {STEP_LABELS.map(function(label, i) {
              var isActive = i === step
              var isDone = i < step
              return (
                <button key={i} onClick={function() { setStep(i) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', background: 'none', border: 'none', padding: '4px 2px' }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700,
                    background: isActive ? HERMES : isDone ? '#10B981' : '#E5E7EB',
                    color: isActive || isDone ? 'white' : '#9CA3AF',
                    transition: 'all 0.2s',
                  }}>
                    {isDone ? '\u2713' : i + 1}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: isActive ? 600 : 400, color: isActive ? '#111827' : '#9CA3AF', display: i === step || window.innerWidth > 640 ? 'inline' : 'none' }}>
                    {label}
                  </span>
                  {i < STEP_LABELS.length - 1 && <span style={{ width: 20, height: 1, background: '#D1D5DB', display: 'block' }} />}
                </button>
              )
            })}
          </div>
        )}

        {error && <p style={{ color: '#dc2626', fontSize: 13, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', marginBottom: 16 }}>{error}</p>}

        {/* ═══ GROUP 1: IDENTITY & APPEARANCE ═══ */}
        {(builderMode === 'expert' || step === 0) && <Group title="Identity & Appearance" subtitle="Who is this agent and how does it look?" color="#0A1628"
          info="Set up your agent's name, personality, visual branding, and conversation openers. This defines the first impression users get when they start chatting.">
          <Section title="Agent Identity">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Agent name" value={name} onChange={function(v) { setName(v); if (!editId) setSlug(autoSlug(v)) }} placeholder="e.g., ACLU Rights Agent" />
              <Field label="URL slug" value={slug} onChange={setSlug} placeholder="e.g., aclu-rights" />
            </div>
            <p style={{ fontSize: 11, color: '#9ca3af', marginTop: -8, marginBottom: 12 }}>Public URL: /b/{slug || 'your-slug'}</p>
            <Field label="Subtitle" value={config.subtitle} onChange={function(v) { updateConfig('subtitle', v) }} placeholder="e.g., Know Your Rights Assistant" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'end' }}>
              <label style={{ display: 'block', marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Avatar</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <EmojiPickerPopover
                    value={config.avatarLetter || '🤖'}
                    onChange={function(v) { updateConfig('avatarLetter', v) }}
                    size="md"
                  />
                  <input
                    type="text"
                    value={config.avatarLetter}
                    onChange={function(e) {
                      var val = e.target.value
                      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
                        var segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
                        var segments = Array.from(segmenter.segment(val), function(s) { return s.segment })
                        updateConfig('avatarLetter', segments.length > 0 ? segments[segments.length - 1] : '')
                      } else {
                        updateConfig('avatarLetter', val.slice(-1) || '')
                      }
                    }}
                    placeholder="A"
                    style={{ width: 56, padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 18, outline: 'none', textAlign: 'center' }}
                  />
                </div>
              </label>
              <Field label="Initial message" value={config.initialMessage} onChange={function(v) { updateConfig('initialMessage', v) }} placeholder="Hi! How can I help you?" />
            </div>
          </Section>

          <Section title="Personality & Voice">
            <GhostTextarea
              value={personality}
              onChange={setPersonality}
              surface="bot-personality"
              context={{ botName: name, botSubject: subject }}
              placeholder={"Describe who this agent emulates and how it should communicate.\n\ne.g., Emulates Alex Vindman — retired Army lieutenant colonel, direct and measured communication style. Uses military precision in language. Approachable but serious.\n\ne.g., Friendly customer support rep for a SaaS product. Casual, uses first names, explains technical concepts simply."}
              style={{ width: '100%', minHeight: 100, padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box', outline: 'none' }}
            />
          </Section>

          <Section title="Conversation Openers">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={config.askName !== 'false'} onChange={function(e) { updateConfig('askName', e.target.checked ? 'true' : 'false') }} style={{ width: 16, height: 16, accentColor: HERMES }} />
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Ask user's name</span>
                    <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>Prompts "What should I call you?"</p>
                  </div>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={config.dynamicChips === true} onChange={function(e) { updateConfig('dynamicChips', e.target.checked) }} style={{ width: 16, height: 16, accentColor: HERMES }} />
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Show follow-up pills</span>
                    <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>Turns the agent's choice-style questions into clickable buttons</p>
                  </div>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={askProfile} onChange={function(e) { setAskProfile(e.target.checked) }} style={{ width: 16, height: 16, accentColor: HERMES }} />
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Profile users</span>
                    <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>Adapts tone to each user's persona</p>
                  </div>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={demographicInference} onChange={function(e) { setDemographicInference(e.target.checked) }} style={{ width: 16, height: 16, accentColor: HERMES }} />
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Infer demographics</span>
                    <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>Estimates age, gender, education, SES from conversation</p>
                  </div>
                </label>
              </div>
              <div>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Suggestion chips</span>
                <textarea
                  value={suggestions}
                  onChange={function(e) { setSuggestions(e.target.value) }}
                  placeholder={"One per line:\nWhat do you do?\nHow can you help me?"}
                  rows={3}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 12, resize: 'vertical' }}
                />
              </div>
            </div>
            {askProfile && (
              <div style={{ marginTop: 12, padding: '12px 14px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>Custom profile question</span>
                <textarea
                  value={profileQuestion}
                  onChange={function(e) { setProfileQuestion(e.target.value) }}
                  placeholder="Tell me a bit about yourself so I can make our conversation more relevant to you."
                  rows={2}
                  style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 12, resize: 'vertical' }}
                />
                <p style={{ fontSize: 10, color: '#9ca3af', marginTop: 4, margin: 0 }}>Extracts life stage, occupation, location, and concerns. Adapts vocabulary and tone automatically.</p>
              </div>
            )}
          </Section>

          <Section title="Branding">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
              <Field label="Accent color" value={config.accentColor} onChange={function(v) { updateConfig('accentColor', v) }} placeholder="#00b4d8" small />
              <Field label="Page background" value={config.pageBg} onChange={function(v) { updateConfig('pageBg', v) }} placeholder="#f8fafc" small />
              <Field label="User bubble" value={config.userBubbleBg} onChange={function(v) { updateConfig('userBubbleBg', v) }} placeholder="#0a1628" small />
              <Field label="Avatar text" value={config.avatarTextColor} onChange={function(v) { updateConfig('avatarTextColor', v) }} placeholder="white" small />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Header gradient" value={config.headerGradient} onChange={function(v) { updateConfig('headerGradient', v) }} placeholder="linear-gradient(135deg, #0a1628, #1a2d4a)" small />
              <Field label="Avatar gradient" value={config.avatarGradient} onChange={function(v) { updateConfig('avatarGradient', v) }} placeholder="linear-gradient(135deg, #00b4d8, #0077a8)" small />
              <Field label="Website URL" value={config.websiteUrl} onChange={function(v) { updateConfig('websiteUrl', v) }} placeholder="https://www.example.com" small />
              <Field label="Website label" value={config.websiteLabel} onChange={function(v) { updateConfig('websiteLabel', v) }} placeholder="example.com" small />
            </div>
            <div style={{ marginTop: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Languages</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {SUPPORTED_LANGUAGES.map(function(l) {
                  var isEn = l.code === 'en'
                  var langs: string[] = config.languages || ['en']
                  var isActive = isEn || langs.includes(l.code)
                  return (
                    <button key={l.code} type="button"
                      onClick={function() {
                        if (isEn) return
                        var prev: string[] = config.languages || ['en']
                        var next = prev.includes(l.code) ? prev.filter(function(c) { return c !== l.code }) : [...prev, l.code]
                        if (!next.includes('en')) next.unshift('en')
                        setConfig(function(p) { return { ...p, languages: next, language: next.length === 1 ? 'en' : next[next.length - 1] } })
                      }}
                      style={{
                        padding: '4px 10px', borderRadius: 14, fontSize: 11, fontWeight: 500,
                        border: isActive ? '1.5px solid ' + HERMES : '1px solid #d1d5db',
                        background: isActive ? HERMES_LIGHT : 'white', color: isActive ? HERMES : '#6b7280',
                        cursor: isEn ? 'default' : 'pointer', opacity: isEn ? 0.7 : 1,
                      }}>
                      {l.nativeName}
                    </button>
                  )
                })}
              </div>
            </div>
          </Section>
        </Group>}

        {/* ═══ GROUP 2: PRIMARY KNOWLEDGE ═══ */}
        {(builderMode === 'expert' || step === 1) && <Group title="Primary Knowledge" subtitle="What does this agent know? Train it on your subject." color="#0F7173"
          info="Build the agent's knowledge from multiple sources — crawl websites, run web research, paste content, or add curated FAQ and facts. Everything feeds into a unified searchable index.">
          <Section title="Subject">
            <Field label="Who or what does this agent represent?" value={subject} onChange={setSubject} placeholder="e.g., Alex Vindman, ACLU, Tesla, Orlando Hindu Temple" />
            <p style={{ fontSize: 11, color: '#9ca3af', marginTop: -8 }}>Used for content filtering — negative content about this subject is automatically handled.</p>
          </Section>

          <Section title="Knowledge Sources">
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>Build the agent's knowledge base from multiple sources. All content feeds into a unified searchable index.</p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              {/* Deep Crawl */}
              <div style={{ padding: '14px', background: '#f9fafb', borderRadius: 10, border: '1px solid #e5e7eb' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Website Crawl</span>
                <p style={{ fontSize: 11, color: '#9ca3af', margin: '0 0 8px' }}>Crawl all pages from a website. Follows internal links.</p>
                <textarea
                  value={crawlUrl}
                  onChange={function(e) { setCrawlUrl(e.target.value) }}
                  placeholder={"https://example.com\nhttps://example.com/about"}
                  rows={2}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, resize: 'vertical', marginBottom: 6 }}
                />
                <button onClick={() => { void runDeepCrawl() }} disabled={crawling || !crawlUrl.trim()}
                  style={{ padding: '5px 14px', borderRadius: 14, border: 'none', background: crawling ? '#9ca3af' : '#0F7173', color: 'white', fontSize: 11, fontWeight: 600, cursor: crawling ? 'not-allowed' : 'pointer' }}>
                  {crawling ? 'Crawling...' : 'Crawl'}
                </button>
                {crawlResult && <p style={{ fontSize: 10, color: '#059669', marginTop: 4, marginBottom: 0 }}>Crawled {crawlResult.pages} page{crawlResult.pages !== 1 ? 's' : ''}</p>}
              </div>

              {/* Web Research */}
              <div style={{ padding: '14px', background: '#f9fafb', borderRadius: 10, border: '1px solid #e5e7eb' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Web Research</span>
                <p style={{ fontSize: 11, color: '#9ca3af', margin: '0 0 8px' }}>Search the web and auto-summarize top results.</p>
                <input type="text" value={researchQuery} onChange={function(e) { setResearchQuery(e.target.value) }}
                  onKeyDown={function(e) { if (e.key === 'Enter' && !researching) void runResearch() }}
                  placeholder="e.g., ACLU, Tesla Cybertruck"
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, marginBottom: 6 }} />
                <button onClick={() => { void runResearch() }} disabled={researching || !researchQuery.trim()}
                  style={{ padding: '5px 14px', borderRadius: 14, border: 'none', background: researching ? '#9ca3af' : '#0F7173', color: 'white', fontSize: 11, fontWeight: 600, cursor: researching ? 'not-allowed' : 'pointer' }}>
                  {researching ? 'Researching...' : 'Research'}
                </button>
                {researchSources.length > 0 && <p style={{ fontSize: 10, color: '#059669', marginTop: 4, marginBottom: 0 }}>{researchSources.length} source{researchSources.length !== 1 ? 's' : ''} added</p>}
              </div>
            </div>

            {/* Training URLs */}
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Training URLs</span>
              <p style={{ fontSize: 11, color: '#9ca3af', margin: '2px 0 6px' }}>Individual pages to fetch and add to knowledge base.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <textarea value={trainingUrls} onChange={function(e) { setTrainingUrls(e.target.value) }}
                  placeholder={"https://example.com/about\nhttps://example.com/faq"} rows={3}
                  style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, resize: 'vertical' }} />
                <button onClick={() => { void fetchTrainingContent() }} disabled={fetchingUrls || !trainingUrls.trim()}
                  style={{ padding: '5px 14px', borderRadius: 14, border: '1px solid #d1d5db', background: fetchingUrls ? '#f3f4f6' : 'white', color: '#374151', fontSize: 11, fontWeight: 500, cursor: fetchingUrls ? 'not-allowed' : 'pointer', alignSelf: 'flex-start', whiteSpace: 'nowrap' }}>
                  {fetchingUrls ? 'Fetching...' : 'Fetch'}
                </button>
              </div>
            </div>

            {/* Knowledge base */}
            <div>
              <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Knowledge Base</span>
              <p style={{ fontSize: 11, color: '#9ca3af', margin: '2px 0 6px' }}>All fetched, crawled, and researched content accumulates here. You can also paste or edit directly.</p>
              <textarea value={knowledgeBase} onChange={function(e) { setKnowledgeBase(e.target.value) }}
                placeholder="Paste or type the content your agent should know about..."
                rows={10}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 12, resize: 'vertical', fontFamily: 'monospace', lineHeight: 1.5 }} />
              <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{knowledgeBase.length.toLocaleString()} characters</p>
            </div>
          </Section>

          <Section title="Curated Knowledge">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* FAQ Pairs */}
              <div>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>FAQ Pairs</span>
                <p style={{ fontSize: 11, color: '#9ca3af', margin: '0 0 8px' }}>High-confidence Q&A matching.</p>
                {faq.map(function(pair, i) {
                  return (
                    <div key={i} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, marginBottom: 8, position: 'relative' }}>
                      <button onClick={function() { setFaq(function(prev) { return prev.filter(function(_, idx) { return idx !== i }) }) }}
                        style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>&times;</button>
                      <input type="text" value={pair.question}
                        onChange={function(e) { var v = e.target.value; setFaq(function(prev) { var n = [...prev]; n[i] = { ...n[i], question: v }; return n }) }}
                        placeholder="Question" style={{ display: 'block', width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 11, marginBottom: 5 }} />
                      <textarea value={pair.answer}
                        onChange={function(e) { var v = e.target.value; setFaq(function(prev) { var n = [...prev]; n[i] = { ...n[i], answer: v }; return n }) }}
                        placeholder="Answer" rows={2} style={{ display: 'block', width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 11, resize: 'vertical' }} />
                    </div>
                  )
                })}
                <button onClick={function() { setFaq(function(prev) { return [...prev, { question: '', answer: '' }] }) }}
                  style={{ padding: '4px 12px', borderRadius: 14, border: '1px dashed #d1d5db', background: 'white', color: '#6b7280', fontSize: 11, cursor: 'pointer' }}>+ Add FAQ</button>
              </div>

              {/* Key Facts */}
              <div>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Key Facts & Talking Points</span>
                <p style={{ fontSize: 11, color: '#9ca3af', margin: '0 0 8px' }}>Important details the agent must know.</p>
                {facts.map(function(fact, i) {
                  return (
                    <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <textarea value={fact} onChange={function(e) { var v = e.target.value; setFacts(function(prev) { var n = [...prev]; n[i] = v; return n }) }}
                        placeholder="e.g., Founded in 2003..." rows={2}
                        style={{ flex: 1, padding: '5px 8px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 11, resize: 'vertical' }} />
                      <button onClick={function() { setFacts(function(prev) { return prev.filter(function(_, idx) { return idx !== i }) }) }}
                        style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}>&times;</button>
                    </div>
                  )
                })}
                <button onClick={function() { setFacts(function(prev) { return [...prev, ''] }) }}
                  style={{ padding: '4px 12px', borderRadius: 14, border: '1px dashed #d1d5db', background: 'white', color: '#6b7280', fontSize: 11, cursor: 'pointer' }}>+ Add fact</button>
              </div>
            </div>
          </Section>
        </Group>}

        {/* ═══ GROUP 3: COMPETITIVE INTELLIGENCE ═══ */}
        {(builderMode === 'expert' || step === 2) && <Group title="Competitive Intelligence" subtitle="How the agent handles competitors, opponents, and criticism" color="#E85A1A"
          info="Control how the agent responds to criticism, attacks, and competitor mentions. Add opponents with their positions for factual contrast messaging.">
          <Section title="Negative Content Strategy">
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>When users ask about criticism, attacks, or scandals</span>
              <select value={negativeContentMode} onChange={function(e) { setNegativeContentMode(e.target.value) }}
                style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, outline: 'none', background: 'white' }}>
                <option value="deflect">Deflect — redirect to platform and positions (safest)</option>
                <option value="pivot">Acknowledge &amp; pivot — briefly acknowledge, then redirect to subject's record</option>
              </select>
            </label>
          </Section>

          <Section title="Opponents & Contrast">
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>Add competitors or opponents. The agent can draw direct comparisons when users ask — factual, on-message, sourced.</p>
            {opponents.map(function(opp, i) {
              return (
                <div key={i} style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 10, padding: 14, marginBottom: 10, position: 'relative' }}>
                  <button onClick={function() { setOpponents(function(prev) { return prev.filter(function(_, idx) { return idx !== i }) }) }}
                    style={{ position: 'absolute', top: 8, right: 10, background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>&times;</button>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                    <label style={{ display: 'block' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>Name</span>
                      <input type="text" value={opp.name}
                        onChange={function(e) { var v = e.target.value; setOpponents(function(prev) { var n = [...prev]; n[i] = { ...n[i], name: v }; return n }) }}
                        placeholder="e.g., Jane Smith" style={{ display: 'block', width: '100%', marginTop: 3, padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }} />
                    </label>
                    <label style={{ display: 'block' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>Key positions / research</span>
                      <textarea value={opp.details}
                        onChange={function(e) { var v = e.target.value; setOpponents(function(prev) { var n = [...prev]; n[i] = { ...n[i], details: v }; return n }) }}
                        placeholder="Voting record, policy positions, public statements..."
                        rows={2} style={{ display: 'block', width: '100%', marginTop: 3, padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, resize: 'vertical' }} />
                    </label>
                  </div>
                </div>
              )
            })}
            <button onClick={function() { setOpponents(function(prev) { return [...prev, { name: '', details: '' }] }) }}
              style={{ padding: '5px 14px', borderRadius: 14, border: '1px dashed #FED7AA', background: '#FFF7ED', color: HERMES, fontSize: 12, fontWeight: 500, cursor: 'pointer', marginBottom: 8 }}>+ Add competitor / opponent</button>

            {opponents.length > 0 && (
              <label style={{ display: 'block', marginTop: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Contrast mode</span>
                <select value={contrastMode} onChange={function(e) { setContrastMode(e.target.value) }}
                  style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, outline: 'none', background: 'white' }}>
                  <option value="off">Off — never contrast</option>
                  <option value="user_triggered">User-triggered — contrast when user asks or mentions opponent</option>
                  <option value="always">Always — include contrast on every relevant answer</option>
                </select>
              </label>
            )}
          </Section>
        </Group>}

        {/* ═══ GROUP 4: CONVERSATION CONTROLS ═══ */}
        {(builderMode === 'expert' || step === 3) && <Group title="Conversation Controls" subtitle="Guardrails, topic management, and deflection rules" color="#7C3AED"
          info="Define what the agent should focus on, what it should avoid, and how it handles off-topic questions. Add hard rules the AI cannot break.">
          <Section title="Focus & Boundaries">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#2563eb', display: 'block', marginBottom: 4 }}>Focus Topics</span>
                <p style={{ fontSize: 11, color: '#9ca3af', margin: '0 0 6px' }}>What the agent should prioritize. Press Enter to add.</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                  {focusTopics.map(function(t, i) {
                    return (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 14, background: '#DBEAFE', color: '#2563eb', fontSize: 11, fontWeight: 500 }}>
                        {t}
                        <button onClick={function() { setFocusTopics(function(prev) { return prev.filter(function(_, idx) { return idx !== i }) }) }}
                          style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}>&times;</button>
                      </span>
                    )
                  })}
                </div>
                <input type="text" value={newFocusTopic} onChange={function(e) { setNewFocusTopic(e.target.value) }}
                  onKeyDown={function(e) { if (e.key === 'Enter' && newFocusTopic.trim()) { e.preventDefault(); setFocusTopics(function(prev) { return [...prev, newFocusTopic.trim()] }); setNewFocusTopic('') } }}
                  onBlur={function() { if (newFocusTopic.trim()) { setFocusTopics(function(prev) { return [...prev, newFocusTopic.trim()] }); setNewFocusTopic('') } }}
                  placeholder="e.g., healthcare, education" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }} />
              </div>
              <div>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', display: 'block', marginBottom: 4 }}>Sensitive Topics to Avoid</span>
                <p style={{ fontSize: 11, color: '#9ca3af', margin: '0 0 6px' }}>Automatically redirected. Press Enter to add.</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                  {sensitiveTopics.map(function(t, i) {
                    return (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 14, background: '#FEE2E2', color: '#dc2626', fontSize: 11, fontWeight: 500 }}>
                        {t}
                        <button onClick={function() { setSensitiveTopics(function(prev) { return prev.filter(function(_, idx) { return idx !== i }) }) }}
                          style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}>&times;</button>
                      </span>
                    )
                  })}
                </div>
                <input type="text" value={newSensitiveTopic} onChange={function(e) { setNewSensitiveTopic(e.target.value) }}
                  onKeyDown={function(e) { if (e.key === 'Enter' && newSensitiveTopic.trim()) { e.preventDefault(); setSensitiveTopics(function(prev) { return [...prev, newSensitiveTopic.trim()] }); setNewSensitiveTopic('') } }}
                  onBlur={function() { if (newSensitiveTopic.trim()) { setSensitiveTopics(function(prev) { return [...prev, newSensitiveTopic.trim()] }); setNewSensitiveTopic('') } }}
                  placeholder="e.g., salary, lawsuits" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }} />
              </div>
            </div>
          </Section>

          <Section title="Deflection">
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={deflectionEnabled} onChange={function(e) { setDeflectionEnabled(e.target.checked) }} style={{ width: 16, height: 16, accentColor: '#7C3AED' }} />
              <div>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Auto-redirect off-topic and sensitive messages</span>
                <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>AI distinguishes genuine feedback from irrelevant questions. Feedback is welcomed; off-topic questions are gently redirected.</p>
              </div>
            </label>
            {deflectionEnabled && (
              <div style={{ marginLeft: 26, maxWidth: 'calc(100% - 26px)' }}>
                <GhostTextarea
                  value={deflectionMessage}
                  onChange={setDeflectionMessage}
                  surface="bot-deflection-message"
                  context={{ botName: name, botSubject: subject, botPersonality: personality }}
                  placeholder="Custom redirect message (optional). Leave empty for AI-generated redirects."
                  style={{ width: '100%', minHeight: 56, padding: '6px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 12, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box', outline: 'none' }}
                />
              </div>
            )}
          </Section>

          <Section title="Intents & Actions">
            <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 10 }}>Detect user interests and direct them to the right place. Describe what to look for — the AI will pick up on subtle signals, not just exact keywords.</p>
            {intents.map(function(intent, i) {
              return (
                <div key={i} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginBottom: 10, position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input type="checkbox" checked={intent.enabled}
                        onChange={function(e) { var v = e.target.checked; setIntents(function(prev) { var n = [...prev]; n[i] = { ...n[i], enabled: v }; return n }) }}
                        style={{ width: 14, height: 14, accentColor: '#7C3AED' }} />
                      <input type="text" value={intent.label}
                        onChange={function(e) { var v = e.target.value; setIntents(function(prev) { var n = [...prev]; n[i] = { ...n[i], label: v }; return n }) }}
                        placeholder="Intent name (e.g., Donate, Volunteer, Purchase)"
                        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, fontWeight: 600, width: 250 }} />
                    </label>
                    <button onClick={function() { setIntents(function(prev) { return prev.filter(function(_, idx) { return idx !== i }) }) }}
                      style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 16 }}>&times;</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <label style={{ display: 'block' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#374151' }}>What to look for</span>
                      <textarea value={intent.description}
                        onChange={function(e) { var v = e.target.value; setIntents(function(prev) { var n = [...prev]; n[i] = { ...n[i], description: v }; return n }) }}
                        placeholder="e.g., Any indication they want to donate, contribute money, or support financially"
                        rows={2}
                        style={{ display: 'block', width: '100%', marginTop: 2, padding: '5px 8px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 11, resize: 'vertical' }} />
                    </label>
                    <label style={{ display: 'block' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#374151' }}>Fast-match keywords (optional, comma-separated)</span>
                      <textarea value={intent.keywords}
                        onChange={function(e) { var v = e.target.value; setIntents(function(prev) { var n = [...prev]; n[i] = { ...n[i], keywords: v }; return n }) }}
                        placeholder="e.g., donate, contribution, give money"
                        rows={2}
                        style={{ display: 'block', width: '100%', marginTop: 2, padding: '5px 8px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 11, resize: 'vertical' }} />
                    </label>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <label style={{ display: 'block' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#374151' }}>Action URL (where to send them)</span>
                      <input type="text" value={intent.url}
                        onChange={function(e) { var v = e.target.value; setIntents(function(prev) { var n = [...prev]; n[i] = { ...n[i], url: v }; return n }) }}
                        placeholder="https://example.com/donate"
                        style={{ display: 'block', width: '100%', marginTop: 2, padding: '5px 8px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 11 }} />
                    </label>
                    <label style={{ display: 'block' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#374151' }}>Response message</span>
                      <input type="text" value={intent.message}
                        onChange={function(e) { var v = e.target.value; setIntents(function(prev) { var n = [...prev]; n[i] = { ...n[i], message: v }; return n }) }}
                        placeholder="That's great to hear! Here's how you can contribute:"
                        style={{ display: 'block', width: '100%', marginTop: 2, padding: '5px 8px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 11 }} />
                    </label>
                  </div>
                </div>
              )
            })}
            <button onClick={function() { setIntents(function(prev) { return [...prev, { label: '', description: '', keywords: '', url: '', message: '', enabled: true }] }) }}
              style={{ padding: '5px 14px', borderRadius: 14, border: '1px dashed #c4b5fd', background: '#F5F3FF', color: '#7C3AED', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>+ Add intent</button>
          </Section>

          <Section title="Prompt Focuses">
            <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 10 }}>Topics the agent is expected to cover. After each reply, an AI classifier tags which focus(es) the response addressed — so you can later filter conversations by &quot;people who got an answer about X.&quot; Different from Intents (which are user-side signals); Focuses are bot-side coverage.</p>
            {editId && (
              <div style={{ marginBottom: 12 }}>
                <button onClick={() => { void (async function() {
                  if (suggestingFocuses) return
                  if (!systemPrompt || systemPrompt.length < 100) { alert('System prompt is too short to suggest focuses from. Add a system prompt first.'); return }
                  if (focuses.length > 0 && !confirm('This will replace your current ' + focuses.length + ' focus(es) with AI-suggested ones. Continue?')) return
                  setSuggestingFocuses(true)
                  try {
                    var r = await fetch('/api/bots/' + editId + '/focuses-suggest', { method: 'POST' })
                    var d = await r.json()
                    if (!r.ok) { alert(d.error || 'Failed to suggest focuses'); return }
                    if (Array.isArray(d.focuses)) {
                      setFocuses(d.focuses.map(function(f: any) { return { slug: f.slug || '', label: f.label || '', description: f.description || '', enabled: true } }))
                    }
                  } catch { alert('Failed to suggest focuses') }
                  finally { setSuggestingFocuses(false) }
                })() }} disabled={suggestingFocuses} style={{ padding: '5px 14px', borderRadius: 14, border: '1px solid #0E7B7B', background: suggestingFocuses ? '#f3f4f6' : '#ECFEFF', color: '#0E7B7B', fontSize: 12, fontWeight: 600, cursor: suggestingFocuses ? 'wait' : 'pointer' }}>
                  {suggestingFocuses ? 'Analyzing prompt…' : '✨ Suggest focuses from system prompt'}
                </button>
                <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 8 }}>Saves nothing until you click Save Agent.</span>
              </div>
            )}
            {focuses.map(function(focus, i) {
              return (
                <div key={i} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginBottom: 10, position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                      <input type="checkbox" checked={focus.enabled}
                        onChange={function(e) { var v = e.target.checked; setFocuses(function(prev) { var n = [...prev]; n[i] = { ...n[i], enabled: v }; return n }) }}
                        style={{ width: 14, height: 14, accentColor: '#0E7B7B' }} />
                      <input type="text" value={focus.label}
                        onChange={function(e) { var v = e.target.value; setFocuses(function(prev) { var n = [...prev]; n[i] = { ...n[i], label: v, slug: prev[i].slug || autoSlug(v) }; return n }) }}
                        placeholder="Label (e.g., Study Area Boundaries)"
                        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, fontWeight: 600, width: 260 }} />
                      <input type="text" value={focus.slug}
                        onChange={function(e) { var v = e.target.value; setFocuses(function(prev) { var n = [...prev]; n[i] = { ...n[i], slug: v }; return n }) }}
                        onBlur={function(e) { var v = autoSlug(e.target.value); setFocuses(function(prev) { var n = [...prev]; n[i] = { ...n[i], slug: v }; return n }) }}
                        placeholder="slug"
                        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 11, fontFamily: 'monospace', color: '#6b7280', width: 200 }} />
                    </label>
                    <button onClick={function() { setFocuses(function(prev) { return prev.filter(function(_, idx) { return idx !== i }) }) }}
                      style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 16 }}>&times;</button>
                  </div>
                  <label style={{ display: 'block' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#374151' }}>What this focus covers (used by the classifier)</span>
                    <textarea value={focus.description}
                      onChange={function(e) { var v = e.target.value; setFocuses(function(prev) { var n = [...prev]; n[i] = { ...n[i], description: v }; return n }) }}
                      placeholder="e.g., Questions about the geographic limits of the study area — north, south, east, west boundaries"
                      rows={2}
                      style={{ display: 'block', width: '100%', marginTop: 2, padding: '5px 8px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 11, resize: 'vertical' }} />
                  </label>
                </div>
              )
            })}
            <button onClick={function() { setFocuses(function(prev) { return [...prev, { slug: '', label: '', description: '', enabled: true }] }) }}
              style={{ padding: '5px 14px', borderRadius: 14, border: '1px dashed #99f6e4', background: '#ECFEFF', color: '#0E7B7B', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>+ Add focus</button>
          </Section>

          <Section title="Research Probes">
            <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 10 }}>Market-research questions the agent weaves into ordinary conversations — sampled deterministically, capped at one probe per conversation, every assignment outcome-accounted (asked/answered/declined/never-fit). While any probe is enabled, the public chat shows a required disclosure line (&quot;Chats may include occasional feedback questions&quot;). Changing a question&apos;s wording automatically starts a new version — results are only compared within a version.</p>
            {researchProbes.map(function(p, i) {
              var upd = function(patch: Partial<typeof p>) { setResearchProbes(function(prev) { var n = [...prev]; n[i] = { ...n[i], ...patch }; return n }) }
              return (
                <div key={i} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                      <input type="checkbox" checked={p.enabled} onChange={function(e) { upd({ enabled: e.target.checked }) }} style={{ width: 14, height: 14, accentColor: '#0E7B7B' }} />
                      <input type="text" value={p.id} onChange={function(e) { upd({ id: e.target.value }) }} onBlur={function(e) { upd({ id: autoSlug(e.target.value) }) }}
                        placeholder="probe-id (stable slug)"
                        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 11, fontFamily: 'monospace', color: '#6b7280', width: 220 }} />
                      <span style={{ fontSize: 10, color: '#9ca3af' }}>v{(p.raw.version as number) || 1}{p.origQuestion && p.question.trim() !== p.origQuestion ? ' → v' + (((p.raw.version as number) || 1) + 1) + ' on save (wording changed)' : ''}</span>
                    </label>
                    <button onClick={function() { setResearchProbes(function(prev) { return prev.filter(function(_, idx) { return idx !== i }) }) }}
                      style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 16 }}>&times;</button>
                  </div>
                  <label style={{ display: 'block', marginBottom: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#374151' }}>The question</span>
                    <textarea value={p.question} onChange={function(e) { upd({ question: e.target.value }) }}
                      placeholder="e.g., If you were starting this season over today, would you get the games the same way?"
                      rows={2}
                      style={{ display: 'block', width: '100%', marginTop: 2, padding: '5px 8px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 12, resize: 'vertical' }} />
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
                    <label style={{ fontSize: 10, fontWeight: 600, color: '#374151' }}>Delivery
                      <select value={p.mode} onChange={function(e) { upd({ mode: e.target.value as 'verbatim' | 'concept' }) }}
                        style={{ display: 'block', marginTop: 2, padding: '4px 6px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 11 }}>
                        <option value="verbatim">Verbatim (exact wording, comparable)</option>
                        <option value="concept">Concept (AI adapts wording)</option>
                      </select>
                    </label>
                    <label style={{ fontSize: 10, fontWeight: 600, color: '#374151' }}>Answer format
                      <select value={p.answerSchema} onChange={function(e) { upd({ answerSchema: e.target.value }) }}
                        style={{ display: 'block', marginTop: 2, padding: '4px 6px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 11 }}>
                        <option value="open">Open-ended</option>
                        <option value="yes_no">Yes / No</option>
                      </select>
                    </label>
                    <label style={{ fontSize: 10, fontWeight: 600, color: '#374151' }}>Ask
                      <span style={{ display: 'block', marginTop: 2 }}>
                        <input type="number" min={1} max={100} value={p.samplePct} onChange={function(e) { upd({ samplePct: Math.max(1, Math.min(100, Number(e.target.value) || 1)) }) }}
                          style={{ width: 54, padding: '4px 6px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 11 }} />
                        <span style={{ fontSize: 10, color: '#6b7280' }}> % of conversations</span>
                      </span>
                    </label>
                    <label style={{ fontSize: 10, fontWeight: 600, color: '#374151' }}>Stop after
                      <span style={{ display: 'block', marginTop: 2 }}>
                        <input type="number" min={0} value={p.targetN} onChange={function(e) { upd({ targetN: Math.max(0, Number(e.target.value) || 0) }) }}
                          style={{ width: 64, padding: '4px 6px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 11 }} />
                        <span style={{ fontSize: 10, color: '#6b7280' }}> answers (0 = no cap)</span>
                      </span>
                    </label>
                    <label style={{ fontSize: 10, fontWeight: 600, color: '#374151' }}>Earliest turn
                      <input type="number" min={1} max={20} value={p.minTurns} onChange={function(e) { upd({ minTurns: Math.max(1, Number(e.target.value) || 1) }) }}
                        style={{ display: 'block', marginTop: 2, width: 54, padding: '4px 6px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 11 }} />
                    </label>
                    <label style={{ fontSize: 10, fontWeight: 600, color: '#374151', display: 'flex', alignItems: 'center', gap: 5, paddingBottom: 4 }}>
                      <input type="checkbox" checked={p.followUp} onChange={function(e) { upd({ followUp: e.target.checked }) }} style={{ width: 13, height: 13, accentColor: '#0E7B7B' }} />
                      One neutral follow-up
                    </label>
                  </div>
                  {p.mode === 'concept' && (
                    <label style={{ display: 'block', marginTop: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#374151' }}>Construct being measured (guides the AI&apos;s adapted wording)</span>
                      <input type="text" value={p.construct} onChange={function(e) { upd({ construct: e.target.value }) }}
                        placeholder="e.g., latent regret about auto-renewal"
                        style={{ display: 'block', width: '100%', marginTop: 2, padding: '5px 8px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 11 }} />
                    </label>
                  )}
                </div>
              )
            })}
            <button onClick={function() { setResearchProbes(function(prev) { return [...prev, { raw: {}, id: '', question: '', origQuestion: '', mode: 'verbatim' as const, construct: '', answerSchema: 'open', followUp: false, samplePct: 25, targetN: 0, minTurns: 3, enabled: true }] }) }}
              style={{ padding: '5px 14px', borderRadius: 14, border: '1px dashed #99f6e4', background: '#ECFEFF', color: '#0E7B7B', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>+ Add research probe</button>
          </Section>

          <Section title="Hard Rules">
            <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>Rules injected directly into the AI's instructions. The agent cannot ignore these.</p>
            {guardrails.map(function(rule, i) {
              return (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, width: 20, textAlign: 'center', flexShrink: 0 }}>{i + 1}.</span>
                  <input type="text" value={rule}
                    onChange={function(e) { var v = e.target.value; setGuardrails(function(prev) { var n = [...prev]; n[i] = v; return n }) }}
                    placeholder="e.g., Never discuss competitor pricing"
                    style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }} />
                  <button onClick={function() { setGuardrails(function(prev) { return prev.filter(function(_, idx) { return idx !== i }) }) }}
                    style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}>&times;</button>
                </div>
              )
            })}
            <button onClick={function() { setGuardrails(function(prev) { return [...prev, ''] }) }}
              style={{ padding: '4px 12px', borderRadius: 14, border: '1px dashed #d1d5db', background: 'white', color: '#6b7280', fontSize: 11, cursor: 'pointer' }}>+ Add rule</button>
          </Section>

          <Section title="Advanced: System Prompt">
            <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>Direct instructions for the AI. Personality, guardrails, and knowledge are injected automatically — use this only for additional custom behavior.</p>
            <GhostTextarea
              value={systemPrompt}
              onChange={setSystemPrompt}
              surface="bot-system-prompt"
              context={{ botName: name, botSubject: subject, botPersonality: personality }}
              placeholder={"Optional. Most agents don't need this.\n\nYou should:\n- Be friendly and concise\n- Only discuss topics related to [subject]"}
              style={{ width: '100%', minHeight: 140, padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 12, resize: 'vertical', fontFamily: 'monospace', lineHeight: 1.5, boxSizing: 'border-box', outline: 'none' }}
            />
          </Section>

          <Section title="Content Safety">
            <ContentSafetyEditor value={config.content_safety} onChange={function(patch) {
              setConfig(function(prev) { return { ...prev, content_safety: { ...(prev.content_safety || {}), ...patch } } })
            }} />
          </Section>
        </Group>}

        {/* ═══ GROUP 5: MONITORING ═══ */}
        {(builderMode === 'expert' || step === 4) && <Group title="Monitoring" subtitle="Automatic conversation review and quality control" color="#0D2B45"
          info="Schedule automatic AI reviews of conversations. The system detects theme drift, surfaces common questions, and identifies gaps in the agent's knowledge.">
          <Section title="Scheduled Review">
            <label style={{ display: 'block' }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>AI review interval</span>
              <select value={reviewInterval} onChange={function(e) { setReviewInterval(e.target.value) }}
                style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, outline: 'none', background: 'white' }}>
                <option value="">Disabled</option>
                <option value="24">Every 24 hours</option>
                <option value="48">Every 2 days</option>
                <option value="168">Weekly</option>
              </select>
              <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>AI analyzes recent conversations and flags theme drift, common questions, and knowledge gaps. Results appear on the Chats page.</p>
            </label>
          </Section>
        </Group>}

        {/* Agent Behavior Summary */}
        <button onClick={function() { setShowBehavior(!showBehavior) }}
          style={{
            width: '100%', padding: '12px 20px', borderRadius: showBehavior ? '12px 12px 0 0' : 12,
            border: '1px solid #e5e7eb', background: showBehavior ? '#0A1628' : 'white',
            color: showBehavior ? 'white' : '#374151', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showBehavior ? 0 : 0,
            transition: 'all 0.2s',
          }}>
          <span>Agent Behavior Summary</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>{showBehavior ? 'Hide' : 'Review what this agent will do'}</span>
        </button>
        {showBehavior && (
          <div style={{ background: 'white', border: '1px solid #e5e7eb', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: 20, marginBottom: 0, fontSize: 12, lineHeight: 1.7, color: '#374151' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#111827', marginBottom: 8 }}>Identity</div>
                <p><strong>Name:</strong> {name || '(not set)'}</p>
                <p><strong>URL:</strong> /b/{slug || '...'}</p>
                {config.subtitle && <p><strong>Subtitle:</strong> {config.subtitle}</p>}
                <p><strong>Ask name:</strong> {config.askName !== 'false' ? 'Yes' : 'No'}</p>
                <p><strong>Profile users:</strong> {askProfile ? 'Yes' : 'No'}</p>
                <p><strong>Infer demographics:</strong> {demographicInference ? 'Yes' : 'No'}</p>
                <p><strong>Languages:</strong> {(config.languages || ['en']).join(', ')}</p>

                <div style={{ fontWeight: 700, fontSize: 13, color: '#111827', marginBottom: 8, marginTop: 16 }}>Personality</div>
                {personality ? <p style={{ fontStyle: 'italic', color: '#6b7280' }}>{personality.length > 200 ? personality.slice(0, 200) + '...' : personality}</p> : <p style={{ color: '#9ca3af' }}>(not set)</p>}

                <div style={{ fontWeight: 700, fontSize: 13, color: '#111827', marginBottom: 8, marginTop: 16 }}>Conversation Controls</div>
                <p><strong>Focus topics:</strong> {focusTopics.length > 0 ? focusTopics.join(', ') : '(none)'}</p>
                <p><strong>Sensitive topics:</strong> {sensitiveTopics.length > 0 ? sensitiveTopics.join(', ') : '(none)'}</p>
                <p><strong>Deflection:</strong> {deflectionEnabled ? (deflectionMessage ? 'Custom message' : 'AI-generated') : 'Disabled'}</p>
                <p><strong>Hard rules:</strong> {guardrails.filter(function(g) { return g.trim() }).length || '(none)'}</p>
                {systemPrompt && <p><strong>System prompt:</strong> {systemPrompt.length} chars</p>}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#111827', marginBottom: 8 }}>Knowledge</div>
                <p><strong>Subject:</strong> {subject || '(not set)'}</p>
                <p><strong>Knowledge base:</strong> {knowledgeBase.length > 0 ? knowledgeBase.length.toLocaleString() + ' chars' : '(empty)'}</p>
                <p><strong>FAQ pairs:</strong> {faq.filter(function(f) { return f.question.trim() }).length}</p>
                <p><strong>Key facts:</strong> {facts.filter(function(f) { return f.trim() }).length}</p>

                <div style={{ fontWeight: 700, fontSize: 13, color: '#111827', marginBottom: 8, marginTop: 16 }}>Competitive Intelligence</div>
                <p><strong>Negative content:</strong> {negativeContentMode === 'deflect' ? 'Deflect (safest)' : 'Acknowledge & pivot'}</p>
                <p><strong>Opponents:</strong> {opponents.filter(function(o) { return o.name.trim() }).length > 0 ? opponents.filter(function(o) { return o.name.trim() }).map(function(o) { return o.name }).join(', ') : '(none)'}</p>
                {opponents.length > 0 && <p><strong>Contrast mode:</strong> {contrastMode === 'off' ? 'Off' : contrastMode === 'always' ? 'Always' : 'User-triggered'}</p>}

                <div style={{ fontWeight: 700, fontSize: 13, color: '#111827', marginBottom: 8, marginTop: 16 }}>Monitoring</div>
                <p><strong>Review interval:</strong> {reviewInterval ? (reviewInterval === '24' ? 'Daily' : reviewInterval === '48' ? 'Every 2 days' : 'Weekly') : 'Disabled'}</p>

                <div style={{ fontWeight: 700, fontSize: 13, color: '#111827', marginBottom: 8, marginTop: 16 }}>Opening Flow</div>
                <p style={{ color: '#6b7280' }}>
                  1. Bot says: "{config.initialMessage || 'Hi! How can I help you today?'}"
                  {config.askName !== 'false' && <><br />2. Asks for name</>}
                  {askProfile && <><br />{config.askName !== 'false' ? '3' : '2'}. Asks profile question</>}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Transfer org (admin only, edit mode only) */}
        {editId && (
          <TransferOrg
            resourceName={name || 'Agent'}
            resourceLabel="agent"
            apiUrl={'/api/bots/' + editId}
          />
        )}

        {/* Navigation (assisted mode) or Save (expert mode) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 20 }}>
          <div>
            {builderMode === 'assisted' && step > 0 && (
              <button onClick={function() { setStep(step - 1) }}
                style={{ padding: '10px 24px', borderRadius: 20, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                Back
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={function() { router.push('/bots') }}
              style={{ padding: '10px 24px', borderRadius: 20, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              Cancel
            </button>
            {builderMode === 'assisted' && step < STEP_LABELS.length - 1 ? (
              <button onClick={function() { setStep(step + 1) }}
                style={{
                  padding: '10px 28px', borderRadius: 20, border: 'none',
                  background: HERMES, color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}>
                Next
              </button>
            ) : (
              <button onClick={() => { void save() }} disabled={saving}
                style={{
                  padding: '10px 28px', borderRadius: 20, border: 'none',
                  background: saving ? '#9ca3af' : HERMES, color: 'white', fontSize: 13, fontWeight: 600,
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}>
                {saving ? 'Saving...' : editId ? 'Save Changes' : 'Create Agent'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
