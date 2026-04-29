'use client'

// app/bots/new/page.tsx
// Bot creator/editor — create or edit a branded chatbot

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import LottieLoader from '@/components/ui/LottieLoader'
import EmojiPickerPopover from '@/components/creator/EmojiPickerPopover'
import { SUPPORTED_LANGUAGES } from '@/lib/types'

const HERMES = '#E8632A'

const HERMES_LIGHT = '#fff7ed'

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
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 10 }}>{title}</h3>
      {children}
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

export default function BotCreatorPage() {
  return <Suspense fallback={<div className="flex items-center justify-center py-32"><LottieLoader size={80} /></div>}><BotCreatorInner /></Suspense>
}

function BotCreatorInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editId = searchParams.get('edit')

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
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

  // Load existing bot if editing
  useEffect(function() {
    if (!editId) return
    fetch('/api/bots/' + editId).then(function(r) { return r.json() }).then(function(bot) {
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
    }).catch(function() {
      setError('Failed to load agent')
    }).finally(function() { setLoading(false) })
  }, [editId])

  function autoSlug(n: string) {
    return n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
  }

  function updateConfig(key: keyof BotConfig, value: string) {
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
      name: config.name || name,
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
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>{editId ? 'Edit Agent' : 'Create Agent'}</h1>
            <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Configure your branded AI agent</p>
          </div>
          <button onClick={function() { router.push('/bots') }}
            style={{ padding: '6px 16px', borderRadius: 16, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>

        {error && <p style={{ color: '#dc2626', fontSize: 13, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', marginBottom: 16 }}>{error}</p>}

        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', padding: 24 }}>
          <Section title="Identity">
            <Field label="Agent name" value={name} onChange={function(v) { setName(v); if (!editId) setSlug(autoSlug(v)) }} placeholder="e.g., ACLU Rights Agent" />
            <Field label="URL slug" value={slug} onChange={setSlug} placeholder="e.g., aclu-rights" />
            <p style={{ fontSize: 11, color: '#9ca3af', marginTop: -8, marginBottom: 12 }}>Public URL: /b/{slug || 'your-slug'}</p>
            <Field label="Subtitle" value={config.subtitle} onChange={function(v) { updateConfig('subtitle', v) }} placeholder="e.g., Know Your Rights Assistant" />
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Avatar letter or emoji</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <EmojiPickerPopover
                  value={config.avatarLetter || '🤖'}
                  onChange={function(v) { updateConfig('avatarLetter', v) }}
                  size="md"
                />
                <span style={{ fontSize: 11, color: '#9ca3af' }}>or type/paste:</span>
                <input
                  type="text"
                  value={config.avatarLetter}
                  onChange={function(e) {
                    var val = e.target.value
                    // Use Intl.Segmenter to correctly handle multi-codepoint emojis (skin tones, ZWJ sequences)
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={(config as any).askName !== false}
                onChange={function(e) { updateConfig('askName' as any, e.target.checked ? 'true' : 'false') }}
                style={{ width: 16, height: 16, accentColor: HERMES }}
              />
              <div>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Ask user's name</span>
                <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>Prompts "What should I call you?" before chat starts. Names are checked for inappropriate content.</p>
              </div>
            </label>
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Languages</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {SUPPORTED_LANGUAGES.map(function(l) {
                  var isEn = l.code === 'en'
                  var langs: string[] = (config as any).languages || ['en']
                  var isActive = isEn || langs.includes(l.code)
                  return (
                    <button
                      key={l.code}
                      type="button"
                      onClick={function() {
                        if (isEn) return
                        var prev: string[] = (config as any).languages || ['en']
                        var next = prev.includes(l.code) ? prev.filter(function(c) { return c !== l.code }) : [...prev, l.code]
                        if (!next.includes('en')) next.unshift('en')
                        setConfig(function(p) { return { ...p, languages: next as any, language: next.length === 1 ? 'en' : next[next.length - 1] } })
                      }}
                      style={{
                        padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: 500,
                        border: isActive ? '1.5px solid ' + HERMES : '1px solid #d1d5db',
                        background: isActive ? HERMES_LIGHT : 'white',
                        color: isActive ? HERMES : '#6b7280',
                        cursor: isEn ? 'default' : 'pointer',
                        opacity: isEn ? 0.7 : 1,
                      }}
                    >
                      {l.nativeName} <span style={{ color: '#9ca3af', fontSize: 10 }}>{l.name !== l.nativeName ? l.name : ''}</span>
                    </button>
                  )
                })}
              </div>
              <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
                {((config as any).languages || ['en']).length > 1
                  ? 'Users will choose their language before chatting. The agent will respond in their selected language.'
                  : 'English only. Select additional languages to let users chat in their preferred language.'}
              </p>
            </div>
          </Section>

          <Section title="Branding">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Accent color" value={config.accentColor} onChange={function(v) { updateConfig('accentColor', v) }} placeholder="#00b4d8" small />
              <Field label="Page background" value={config.pageBg} onChange={function(v) { updateConfig('pageBg', v) }} placeholder="#f8fafc" small />
              <Field label="User bubble color" value={config.userBubbleBg} onChange={function(v) { updateConfig('userBubbleBg', v) }} placeholder="#0a1628" small />
              <Field label="Avatar text color" value={config.avatarTextColor} onChange={function(v) { updateConfig('avatarTextColor', v) }} placeholder="white" small />
            </div>
            <Field label="Header gradient" value={config.headerGradient} onChange={function(v) { updateConfig('headerGradient', v) }} placeholder="linear-gradient(135deg, #0a1628, #1a2d4a)" />
            <Field label="Avatar gradient" value={config.avatarGradient} onChange={function(v) { updateConfig('avatarGradient', v) }} placeholder="linear-gradient(135deg, #00b4d8, #0077a8)" />
            <Field label="Website URL" value={config.websiteUrl} onChange={function(v) { updateConfig('websiteUrl', v) }} placeholder="https://www.example.com" />
            <Field label="Website label" value={config.websiteLabel} onChange={function(v) { updateConfig('websiteLabel', v) }} placeholder="example.com" />
          </Section>

          <Section title="Suggestion chips">
            <textarea
              value={suggestions}
              onChange={function(e) { setSuggestions(e.target.value) }}
              placeholder={"One suggestion per line, e.g.:\nWhat do you do?\nHow can you help me?\nTell me about pricing"}
              rows={4}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical' }}
            />
          </Section>

          <Section title="Personality">
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Describe who this agent emulates and how it should communicate. This shapes tone, vocabulary, and style automatically.</p>
            <textarea
              value={personality}
              onChange={function(e) { setPersonality(e.target.value) }}
              placeholder={"e.g., Emulates Alex Vindman — retired Army lieutenant colonel, direct and measured communication style. Uses military precision in language. Patriotic but nonpartisan. Speaks with authority on national security and civil-military relations. Approachable but serious."}
              rows={4}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical' }}
            />
          </Section>

          <Section title="Content Protection">
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Specify who or what this agent represents. Crawled content that is negative toward the subject will be automatically flagged and filtered from responses.</p>
            <Field label="Subject (person, organization, or brand)" value={subject} onChange={setSubject} placeholder="e.g., Alex Vindman, ACLU, Tesla" />
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Negative content handling</span>
              <select
                value={negativeContentMode}
                onChange={function(e) { setNegativeContentMode(e.target.value) }}
                style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, outline: 'none', background: 'white' }}>
                <option value="deflect">Deflect — redirect to platform and positions (safest)</option>
                <option value="pivot">Acknowledge &amp; pivot — briefly acknowledge, then redirect to subject's own position</option>
              </select>
              <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Controls how the agent responds when users ask about criticism, scandals, or negative coverage.</p>
            </label>

            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16, marginTop: 16 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Opponents / Contrast</p>
              <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Add opponents for contrast messaging. When enabled, the agent can draw policy contrasts after presenting the subject's position.</p>
              {opponents.map(function(opp, i) {
                return (
                  <div key={i} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginBottom: 10, position: 'relative' }}>
                    <button
                      onClick={function() { setOpponents(function(prev) { return prev.filter(function(_, idx) { return idx !== i }) }) }}
                      style={{ position: 'absolute', top: 8, right: 10, background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
                      title="Remove"
                    >&times;</button>
                    <label style={{ display: 'block', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>Opponent name</span>
                      <input
                        type="text"
                        value={opp.name}
                        onChange={function(e) { var v = e.target.value; setOpponents(function(prev) { var n = [...prev]; n[i] = { ...n[i], name: v }; return n }) }}
                        placeholder="e.g., Jane Smith"
                        style={{ display: 'block', width: '100%', marginTop: 3, padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, outline: 'none' }}
                      />
                    </label>
                    <label style={{ display: 'block' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>Key positions / oppo research (optional)</span>
                      <textarea
                        value={opp.details}
                        onChange={function(e) { var v = e.target.value; setOpponents(function(prev) { var n = [...prev]; n[i] = { ...n[i], details: v }; return n }) }}
                        placeholder="e.g., Voted against infrastructure bill, supports defunding education..."
                        rows={3}
                        style={{ display: 'block', width: '100%', marginTop: 3, padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, resize: 'vertical' }}
                      />
                    </label>
                  </div>
                )
              })}
              <button
                onClick={function() { setOpponents(function(prev) { return [...prev, { name: '', details: '' }] }) }}
                style={{ padding: '6px 14px', borderRadius: 16, border: '1px dashed #d1d5db', background: 'white', color: '#6b7280', fontSize: 12, cursor: 'pointer', marginBottom: 12 }}
              >+ Add opponent</button>

              {opponents.length > 0 && (
                <label style={{ display: 'block', marginTop: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Contrast mode</span>
                  <select
                    value={contrastMode}
                    onChange={function(e) { setContrastMode(e.target.value) }}
                    style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, outline: 'none', background: 'white' }}>
                    <option value="off">Off — never contrast</option>
                    <option value="user_triggered">User-triggered — contrast when user asks or mentions opponent (default)</option>
                    <option value="always">Always — include contrast on every policy answer</option>
                  </select>
                  <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Controls when the agent draws contrasts with opponents after presenting the subject's position.</p>
                </label>
              )}
            </div>
          </Section>

          <Section title="FAQ Pairs">
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Add common questions and approved answers. These get embedded in the knowledge base for high-confidence matching.</p>
            {faq.map(function(pair, i) {
              return (
                <div key={i} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginBottom: 10, position: 'relative' }}>
                  <button
                    onClick={function() { setFaq(function(prev) { return prev.filter(function(_, idx) { return idx !== i }) }) }}
                    style={{ position: 'absolute', top: 8, right: 10, background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
                    title="Remove"
                  >&times;</button>
                  <label style={{ display: 'block', marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>Question</span>
                    <input
                      type="text"
                      value={pair.question}
                      onChange={function(e) { var v = e.target.value; setFaq(function(prev) { var n = [...prev]; n[i] = { ...n[i], question: v }; return n }) }}
                      placeholder="e.g., What are your hours?"
                      style={{ display: 'block', width: '100%', marginTop: 3, padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, outline: 'none' }}
                    />
                  </label>
                  <label style={{ display: 'block' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>Answer</span>
                    <textarea
                      value={pair.answer}
                      onChange={function(e) { var v = e.target.value; setFaq(function(prev) { var n = [...prev]; n[i] = { ...n[i], answer: v }; return n }) }}
                      placeholder="e.g., We're open Monday-Friday, 9am-5pm EST."
                      rows={2}
                      style={{ display: 'block', width: '100%', marginTop: 3, padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, resize: 'vertical' }}
                    />
                  </label>
                </div>
              )
            })}
            <button
              onClick={function() { setFaq(function(prev) { return [...prev, { question: '', answer: '' }] }) }}
              style={{ padding: '6px 14px', borderRadius: 16, border: '1px dashed #d1d5db', background: 'white', color: '#6b7280', fontSize: 12, cursor: 'pointer' }}
            >+ Add FAQ pair</button>
          </Section>

          <Section title="Key Facts">
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Important facts, talking points, or details the agent must know. Each fact becomes a searchable knowledge chunk.</p>
            {facts.map(function(fact, i) {
              return (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
                  <textarea
                    value={fact}
                    onChange={function(e) { var v = e.target.value; setFacts(function(prev) { var n = [...prev]; n[i] = v; return n }) }}
                    placeholder="e.g., Founded in 2003 with a mission to..."
                    rows={2}
                    style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, resize: 'vertical' }}
                  />
                  <button
                    onClick={function() { setFacts(function(prev) { return prev.filter(function(_, idx) { return idx !== i }) }) }}
                    style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '4px 6px' }}
                    title="Remove"
                  >&times;</button>
                </div>
              )
            })}
            <button
              onClick={function() { setFacts(function(prev) { return [...prev, ''] }) }}
              style={{ padding: '6px 14px', borderRadius: 16, border: '1px dashed #d1d5db', background: 'white', color: '#6b7280', fontSize: 12, cursor: 'pointer' }}
            >+ Add fact</button>
          </Section>

          <Section title="Guardrails">
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Rules the agent must always follow. These are injected directly into the system prompt — not searchable knowledge.</p>
            {guardrails.map(function(rule, i) {
              return (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                  <input
                    type="text"
                    value={rule}
                    onChange={function(e) { var v = e.target.value; setGuardrails(function(prev) { var n = [...prev]; n[i] = v; return n }) }}
                    placeholder="e.g., Never discuss competitor pricing"
                    style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, outline: 'none' }}
                  />
                  <button
                    onClick={function() { setGuardrails(function(prev) { return prev.filter(function(_, idx) { return idx !== i }) }) }}
                    style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '4px 6px' }}
                    title="Remove"
                  >&times;</button>
                </div>
              )
            })}
            <button
              onClick={function() { setGuardrails(function(prev) { return [...prev, ''] }) }}
              style={{ padding: '6px 14px', borderRadius: 16, border: '1px dashed #d1d5db', background: 'white', color: '#6b7280', fontSize: 12, cursor: 'pointer' }}
            >+ Add guardrail</button>
          </Section>

          <Section title="System prompt">
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Advanced: direct instructions for the AI. The personality spec above is automatically included. Use this for additional rules or boundaries.</p>
            <textarea
              value={systemPrompt}
              onChange={function(e) { setSystemPrompt(e.target.value) }}
              placeholder={"You are [Agent Name], an assistant for [Company]. You help users with...\n\nYou should:\n- Be friendly and concise\n- Only discuss topics related to [Company]\n- Never make up information"}
              rows={8}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical', fontFamily: 'monospace' }}
            />
          </Section>

          <Section title="Conversation Review">
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Schedule automatic AI review of conversations to detect theme drift, common questions, and knowledge gaps.</p>
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Review interval</span>
              <select
                value={reviewInterval}
                onChange={function(e) { setReviewInterval(e.target.value) }}
                style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, outline: 'none', background: 'white' }}>
                <option value="">Disabled</option>
                <option value="24">Every 24 hours</option>
                <option value="48">Every 2 days</option>
                <option value="168">Weekly</option>
              </select>
              <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>When enabled, AI will periodically analyze recent conversations and flag theme drift or knowledge gaps. View results on the Chats page.</p>
            </label>
          </Section>

          <Section title="Deep Crawl">
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Enter one or more website URLs (one per line) to crawl all pages and build a comprehensive knowledge base. Follows internal links, keeps full detail.</p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Website URLs (one per line)</span>
                <textarea
                  value={crawlUrl}
                  onChange={function(e) { setCrawlUrl(e.target.value) }}
                  placeholder={"e.g.,\nhttps://orlandohindutemple.org\nhttps://example.com/about"}
                  rows={3}
                  style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical' }}
                />
              </label>
              <button
                onClick={runDeepCrawl}
                disabled={crawling || !crawlUrl.trim()}
                style={{
                  padding: '8px 20px', borderRadius: 16, border: 'none',
                  background: crawling ? '#9ca3af' : HERMES, color: 'white',
                  fontSize: 12, fontWeight: 600, cursor: crawling ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap', height: 36, alignSelf: 'flex-start', marginTop: 22,
                }}>
                {crawling ? 'Crawling...' : 'Deep Crawl'}
              </button>
            </div>
            {crawling && (
              <div style={{ fontSize: 11, color: '#6b7280', padding: '8px 0' }}>
                Crawling pages and extracting content — this may take up to 2 minutes for large sites...
              </div>
            )}
            {crawlResult && (
              <div style={{ fontSize: 11, color: '#059669', marginBottom: 8 }}>
                Crawled {crawlResult.pages} page{crawlResult.pages !== 1 ? 's' : ''} across {crawlResult.sites} site{crawlResult.sites !== 1 ? 's' : ''} — full content added to knowledge base
              </div>
            )}
          </Section>

          <Section title="Research">
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Enter a person, organization, or topic to automatically search the web, read top results, and build a summarized knowledge base.</p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
              <label style={{ flex: 1 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Search query</span>
                <input
                  type="text"
                  value={researchQuery}
                  onChange={function(e) { setResearchQuery(e.target.value) }}
                  onKeyDown={function(e) { if (e.key === 'Enter' && !researching) runResearch() }}
                  placeholder="e.g., Alex Vindman, ACLU, Tesla Cybertruck"
                  style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, outline: 'none' }}
                />
              </label>
              <button
                onClick={runResearch}
                disabled={researching || !researchQuery.trim()}
                style={{
                  padding: '8px 20px', borderRadius: 16, border: 'none',
                  background: researching ? '#9ca3af' : HERMES, color: 'white',
                  fontSize: 12, fontWeight: 600, cursor: researching ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap', height: 36,
                }}>
                {researching ? 'Researching...' : 'Research'}
              </button>
            </div>
            {researching && (
              <div style={{ fontSize: 11, color: '#6b7280', padding: '8px 0' }}>
                Searching the web, fetching pages, and summarizing — this may take 15-30 seconds...
              </div>
            )}
            {researchSources.length > 0 && (
              <div style={{ fontSize: 11, color: '#059669', marginBottom: 8 }}>
                Researched {researchSources.length} source{researchSources.length !== 1 ? 's' : ''}: {researchSources.map(function(u) {
                  try { return new URL(u).hostname } catch { return u }
                }).join(', ')}
              </div>
            )}
          </Section>

          <Section title="Training content">
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Add URLs to fetch content from, or paste knowledge directly. This becomes the agent's reference material.</p>
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Training URLs (one per line)</span>
              <textarea
                value={trainingUrls}
                onChange={function(e) { setTrainingUrls(e.target.value) }}
                placeholder={"https://www.example.com/about\nhttps://www.example.com/faq\nhttps://www.example.com/products"}
                rows={4}
                style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical' }}
              />
            </label>
            <button
              onClick={fetchTrainingContent}
              disabled={fetchingUrls || !trainingUrls.trim()}
              style={{
                padding: '6px 16px', borderRadius: 16, border: '1px solid #d1d5db',
                background: fetchingUrls ? '#f3f4f6' : 'white', color: fetchingUrls ? '#9ca3af' : '#374151',
                fontSize: 12, fontWeight: 500, cursor: fetchingUrls ? 'not-allowed' : 'pointer', marginBottom: 16,
              }}
            >{fetchingUrls ? 'Fetching...' : 'Fetch content from URLs'}</button>

            <label style={{ display: 'block' }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Knowledge base</span>
              <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Fetched content appears here. You can also paste or edit directly.</p>
              <textarea
                value={knowledgeBase}
                onChange={function(e) { setKnowledgeBase(e.target.value) }}
                placeholder="Paste or type the content your agent should know about..."
                rows={12}
                style={{ display: 'block', width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 12, resize: 'vertical', fontFamily: 'monospace', lineHeight: 1.5 }}
              />
            </label>
            <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{knowledgeBase.length.toLocaleString()} characters</p>
          </Section>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
          <button onClick={function() { router.push('/bots') }}
            style={{ padding: '10px 24px', borderRadius: 20, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            style={{
              padding: '10px 28px', borderRadius: 20, border: 'none',
              background: saving ? '#9ca3af' : HERMES, color: 'white', fontSize: 13, fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer',
            }}>
            {saving ? 'Saving...' : editId ? 'Save Changes' : 'Create Agent'}
          </button>
        </div>
      </div>
    </div>
  )
}
