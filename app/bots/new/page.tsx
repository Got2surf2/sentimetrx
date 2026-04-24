'use client'

// app/bots/new/page.tsx
// Bot creator/editor — create or edit a branded chatbot

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import LottieLoader from '@/components/ui/LottieLoader'

const HERMES = '#E8632A'

const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'tl', label: 'Filipino/Tagalog' },
  { code: 'ru', label: 'Russian' },
  { code: 'pl', label: 'Polish' },
]

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

  // Load existing bot if editing
  useEffect(function() {
    if (!editId) return
    fetch('/api/bots/' + editId).then(function(r) { return r.json() }).then(function(bot) {
      setName(bot.name || '')
      setSlug(bot.slug || '')
      setSystemPrompt(bot.system_prompt || '')
      setKnowledgeBase(bot.knowledge_base || '')
      setTrainingUrls((bot.training_urls || []).join('\n'))
      setSuggestions((bot.config?.suggestions || []).join('\n'))
      setConfig({ ...DEFAULT_CONFIG, ...bot.config })
      if (bot.review_interval_hours) setReviewInterval(String(bot.review_interval_hours))
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
    var payload: any = {
      name: name.trim(),
      slug: slug.trim(),
      config: fullConfig,
      system_prompt: systemPrompt,
      knowledge_base: knowledgeBase,
      training_urls: trainingUrls.split('\n').map(function(u) { return u.trim() }).filter(Boolean),
      review_interval_hours: riHours,
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
            <Field label="Avatar letter or emoji" value={config.avatarLetter} onChange={function(v) { updateConfig('avatarLetter', v) }} placeholder="e.g., A or 🤖" />
            <Field label="Initial message" value={config.initialMessage} onChange={function(v) { updateConfig('initialMessage', v) }} placeholder="Hi! How can I help you?" />
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Language</span>
              <select
                value={config.language || 'en'}
                onChange={function(e) { updateConfig('language', e.target.value) }}
                style={{
                  display: 'block', width: '100%', marginTop: 4,
                  padding: '8px 12px', borderRadius: 8,
                  border: '1px solid #d1d5db', fontSize: 13, outline: 'none',
                  background: 'white',
                }}>
                {LANGUAGES.map(function(l) { return <option key={l.code} value={l.code}>{l.label}</option> })}
              </select>
              <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>The agent will always respond in this language.</p>
            </label>
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

          <Section title="System prompt">
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Instructions for how the agent should behave. This defines the agent's personality and boundaries.</p>
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
