'use client'

// components/analyze/AskAnaPanel.tsx
// Right-side slide-out panel for Ask Ana — iMessage-style chat with streaming AI responses.
// Supports configurable sampling for large datasets and collections.
// Supports both Q&A (text) and analysis framework mutations (tool_use → confirmation cards).

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { serializeFilters, applyFilters } from '@/lib/filterUtils'
import type { Filters } from '@/lib/filterUtils'
import { useRows } from '@/components/analyze/RowsContext'
import { themeSetForField, type ThemeModel } from '@/lib/themeUtils'
import { splitAnaSegments, type AnaChartSpec } from '@/lib/anaChartSpec'
import { FUN_FACTS } from '@/lib/funFacts'
import { downloadFile } from '@/lib/browserDownload'
import { viewSpecFilters, ANA_VIEW_TABS, type AnaViewFilterSpec } from '@/lib/anaViewSpec'

// Tool-use payload from Ana — one bag of optional fields across all tools
// (create_theme / update_theme / merge_themes / delete_theme / generate_report / recommend_sampling).
interface AnaActionInput {
  // recommend_sampling
  sample_size?: number
  strategy?: 'proportional' | 'equal' | 'floor'
  reasoning?: string
  // create_theme
  name?: string
  description?: string
  keywords?: string[]
  sentiment?: string
  // update_theme
  theme_name?: string
  new_name?: string
  new_description?: string
  new_sentiment?: string
  add_keywords?: string[]
  remove_keywords?: string[]
  // merge_themes
  theme_names?: string[]
  merged_name?: string
  merged_description?: string
  merged_sentiment?: string
  // delete_theme
  reason?: string
  // remember_preference
  statement?: string
  scope?: string
  source?: string
  // set_view
  summary?: string
  tab?: string
  textField?: string
  filters?: AnaViewFilterSpec[]
  // generate_report (the whole input is forwarded verbatim as the deck payload)
  title?: string
  subtitle?: string
  slides?: { type: string; title: string }[]
}

interface AnaAction {
  tool: string
  toolId: string
  input: AnaActionInput
  status: 'pending' | 'approved' | 'rejected'
}

interface MemoryRow {
  id: string
  dataset_id: string | null
  source: 'interview' | 'correction' | 'observed'
  status: 'active' | 'pending' | 'archived'
  statement: string
  created_at: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  actions?: AnaAction[]
  /** transient "Counting values…" line while Ana runs a server-side query */
  statusText?: string
  /** hidden trigger messages (e.g. the briefing request) — sent in history, never rendered */
  hidden?: boolean
  /** canvas handoff — the Charts config behind this answer ("Open in Charts" chip) */
  canvas?: { chartType: string; config: Record<string, string>; label: string }
  /** the work behind the answer: queries run, results seen, interim reasoning */
  logic?: string[]
  showLogic?: boolean
}

interface SamplingConfig {
  sampleSize: number
  strategy: 'proportional' | 'equal' | 'floor'
  configured: boolean
}

interface CollectionMember {
  name: string
  row_count: number
}

// Minimal shape of a theme within a dataset's theme_model (mutated in place by Ana actions)
interface AnaTheme {
  id?: string
  name?: string
  label?: string
  description?: string
  keywords?: string[]
  sentiment?: string
  count?: number
  percentage?: number
  relatedThemes?: unknown[]
}

interface Props {
  datasetId: string
  datasetName: string
  datasetSource: string
  datasetRowCount: number
  filters?: Filters
  onClose: () => void
  onThemesChanged?: () => void
}

var IMSG_BLUE = '#007AFF'
var IMSG_GRAY = '#E9E9EB'
var HERMES = '#E8632A'

var STARTERS = [
  'What are the main themes people are discussing?',
  'What are people most upset about?',
  'Summarize the overall sentiment',
  'Create a theme for the most common complaints',
]

// Threshold: datasets above this show the sampling config
var SAMPLING_THRESHOLD = 200

export default function AskAnaPanel({ datasetId, datasetName, datasetSource, datasetRowCount, filters, onClose, onThemesChanged }: Props) {
  var [messages, setMessages] = useState<Message[]>([])
  var [input, setInput] = useState('')
  var [loading, setLoading] = useState(false)
  // Shared rows cache — used to send Ana the filtered view's flat row ids so
  // her query_data numbers match the charts (same id set ChartsModule sends).
  var rowsCtx = useRows()
  var scrollRef = useRef<HTMLDivElement>(null)
  var inputRef = useRef<HTMLTextAreaElement>(null)

  // Sampling state
  var needsSampling = datasetRowCount > SAMPLING_THRESHOLD || datasetSource === 'collection'
  // Since the query engine (2026-09-01) Ana's numbers come from exact queries
  // over the whole dataset — the sample is orientation context only. So the
  // panel no longer LEADS with the sampling chooser: defaults apply silently
  // and the header's Sampling button opens the old setup for tuning.
  var [samplingConfig, setSamplingConfig] = useState<SamplingConfig>(
    needsSampling
      ? { sampleSize: 60, strategy: 'proportional', configured: true }
      : { sampleSize: datasetRowCount, strategy: 'proportional', configured: true }
  )
  var [phase, setPhase] = useState<'setup' | 'deciding' | 'chat' | 'interview'>('chat')
  var [collectionMembers, setCollectionMembers] = useState<CollectionMember[] | null>(null)
  var [customSizeInput, setCustomSizeInput] = useState('')

  var router = useRouter()

  // ── "Ana remembers" state ──
  var [view, setView] = useState<'chat' | 'memory'>('chat')
  var [expanded, setExpanded] = useState(false)
  var [memories, setMemories] = useState<MemoryRow[]>([])
  var [memLoaded, setMemLoaded] = useState(false)
  var [interviewPending, setInterviewPending] = useState(false)
  var refreshMemories = useCallback(async function() {
    try {
      var r = await fetch('/api/analyst-memory')
      if (!r.ok) return
      var j = await r.json()
      setMemories(j.memories || [])
      // First-ever visit: no memories and never interviewed → Ana opens with
      // the getting-to-know-you conversation instead of a blank chat.
      setInterviewPending(!j.interviewed && (j.memories || []).length === 0)
      setMemLoaded(true)
    } catch {}
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- refreshMemories only sets state AFTER awaiting the fetch (async continuation, not a synchronous set); the rule traces the call conservatively
  useEffect(function() { void refreshMemories() }, [refreshMemories])

  // Enter interview mode when it's pending and the chat would otherwise be
  // empty (covers both the no-sampling path and post-sampling arrival).
  useEffect(function() {
    if (interviewPending && phase === 'chat' && messages.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds the interview phase + scripted opener when the SERVER says the interview is pending (external-system sync, same pattern as ChartsModule's rows sync)
      setPhase('interview')
      setMessages([{
        id: 'interview-opener', role: 'assistant',
        content: "Before we dig in \u2014 give me two minutes so I can learn how you work. When you open a dataset like this, what do you look at first?",
      }])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on phase/pending changes; messages.length guard prevents re-seeding
  }, [interviewPending, phase])

  // ── The briefing: Ana speaks first when she has memories to work from ──
  // Auto-fires once per dataset per browser session, only when the chat is
  // empty, the analyst has memories, and no interview is pending. Deferred via
  // timeout so the state updates happen outside the effect body.
  useEffect(function() {
    if (!memLoaded || interviewPending || phase !== 'chat' || messages.length > 0 || memories.length === 0) return
    var key = 'anaBriefed:' + datasetId
    try { if (sessionStorage.getItem(key)) return } catch { return }
    try { sessionStorage.setItem(key, '1') } catch {}
    var t = setTimeout(function() { void sendMessage('Give me my opening briefing.', { briefing: true, hidden: true }) }, 50)
    return function() { clearTimeout(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fires when the gate conditions settle; sendMessage identity is stable enough for a one-shot guarded by sessionStorage
  }, [memLoaded, interviewPending, phase, messages.length, memories.length, datasetId])

  var openInCharts = useCallback(function(canvas: NonNullable<Message['canvas']>) {
    try { sessionStorage.setItem('anaChart:' + datasetId, JSON.stringify(canvas)) } catch {}
    window.dispatchEvent(new CustomEvent('ana-open-chart', { detail: canvas }))
    router.push('/analyze/' + datasetId + '/charts')
  }, [datasetId, router])

  // ── PDF take-away: export one exchange or the whole thread ──
  var [exportingPdf, setExportingPdf] = useState(false)
  var exportPdf = useCallback(async function(exchanges: { question: string; answer: string; logic?: string[] }[]) {
    if (exportingPdf || exchanges.length === 0) return
    setExportingPdf(true)
    try {
      await downloadFile('/api/ana/export-pdf', {
        method: 'POST',
        body: { datasetId: datasetId, exchanges: exchanges },
        fallbackName: (datasetName || 'findings').replace(/[^a-z0-9]/gi, '_') + '_ana_findings.pdf',
      })
    } catch {
      setMessages(function(prev) {
        return prev.concat([{ id: Date.now() + '-pdferr', role: 'assistant', content: 'PDF export failed — please try again.' }])
      })
    }
    setExportingPdf(false)
  }, [exportingPdf, datasetId, datasetName])

  function exchangeFor(msgId: string): { question: string; answer: string; logic?: string[] }[] {
    var idx = messages.findIndex(function(m) { return m.id === msgId })
    if (idx === -1) return []
    var answerMsg = messages[idx]
    var question = ''
    for (var qi = idx - 1; qi >= 0; qi--) {
      if (messages[qi].role === 'user') { question = messages[qi].content; break }
    }
    return [{ question: question, answer: answerMsg.content, logic: answerMsg.logic }]
  }

  function threadExchanges(): { question: string; answer: string; logic?: string[] }[] {
    var out: { question: string; answer: string; logic?: string[] }[] = []
    var lastQuestion = ''
    messages.forEach(function(m) {
      if (m.role === 'user') { lastQuestion = m.content; return }
      if (m.streaming || !m.content || m.content.length < 100) return
      out.push({ question: lastQuestion, answer: m.content, logic: m.logic })
    })
    return out
  }

  var finishInterview = useCallback(async function() {
    try { await fetch('/api/analyst-memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markInterviewed: true }) }) } catch {}
    setInterviewPending(false)
    setPhase('chat')
  }, [])

  // Per-question theme sets: Ana edits the set for TextMine's ACTIVE Text
  // pill, not blindly the saved top-level one (viewing "Liked LEAST" while
  // the saved active set is "Liked MOST" used to make her edit the wrong
  // question's themes). Same event the metric strip follows; '' = the saved
  // active set (the default on every non-TextMine tab).
  var [activeFieldKey, setActiveFieldKey] = useState('')
  useEffect(function() {
    function onFieldChange(e: Event) {
      var k = (e as CustomEvent<{ fieldKey?: string }>).detail?.fieldKey
      setActiveFieldKey(typeof k === 'string' ? k : '')
    }
    window.addEventListener('dataset-active-field-changed', onFieldChange)
    return function() { window.removeEventListener('dataset-active-field-changed', onFieldChange) }
  }, [])

  // Fetch collection members on mount if collection
  useEffect(function() {
    if (datasetSource !== 'collection') return
    fetch('/api/collections/' + datasetId)
      .then(function(r) { return r.ok ? r.json() : null })
      .then(function(data) {
        if (data && data.members) {
          setCollectionMembers(data.members.map(function(m: { label?: string; name?: string; row_count?: number }) {
            return { name: m.label || m.name || 'Unknown', row_count: m.row_count || 0 }
          }))
        }
      })
      .catch(function() {})
  }, [datasetId, datasetSource])

  // Auto-scroll on new messages
  useEffect(function() {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Focus input on mount (when in chat phase)
  useEffect(function() {
    if (phase === 'chat' || phase === 'deciding' || phase === 'interview') {
      setTimeout(function() { inputRef.current?.focus() }, 200)
    }
  }, [phase])

  // Apply a confirmed action to the dataset's theme model
  var applyAction = useCallback(async function(msgId: string, actionIdx: number) {
    var msg = messages.find(function(m) { return m.id === msgId })
    if (!msg || !msg.actions || !msg.actions[actionIdx]) return
    var action = msg.actions[actionIdx]
    console.log('[Ana] applyAction called:', action.tool, action.status, 'slides:', action.input?.slides?.length)

    // Handle recommend_sampling action
    if (action.tool === 'recommend_sampling') {
      var rec = action.input
      setSamplingConfig({
        sampleSize: Math.max(50, Math.min(rec.sample_size || 200, 500)),
        strategy: rec.strategy || 'proportional',
        configured: true,
      })
      // Mark as approved
      setMessages(function(prev) {
        return prev.map(function(m) {
          if (m.id !== msgId || !m.actions) return m
          var updated = m.actions.map(function(a, i) { return i === actionIdx ? { ...a, status: 'approved' as const } : a })
          return { ...m, actions: updated }
        })
      })
      // Switch to chat phase after a brief delay
      setTimeout(function() {
        setMessages([])
        setPhase('chat')
      }, 800)
      return
    }

    // set_view → apply the offered view: filters via DatasetShell's listener,
    // the TextMine text column via event + sessionStorage handshake (covers
    // the not-yet-mounted case), then navigate.
    if (action.tool === 'set_view') {
      try {
        var vf = viewSpecFilters(action.input.filters)
        if (Object.keys(vf).length > 0) {
          window.dispatchEvent(new CustomEvent('ana-set-view-filters', { detail: { filters: vf } }))
        }
        if (action.input.textField) {
          try { sessionStorage.setItem('anaTextField:' + datasetId, action.input.textField) } catch {}
          window.dispatchEvent(new CustomEvent('ana-set-text-field', { detail: { fieldKey: action.input.textField } }))
        }
        var tab = typeof action.input.tab === 'string' && ANA_VIEW_TABS.indexOf(action.input.tab) !== -1 ? action.input.tab : null
        if (tab) router.push('/analyze/' + datasetId + '/' + tab)
        setMessages(function(prev) {
          return prev.map(function(m) {
            if (m.id !== msgId || !m.actions) return m
            var updated = m.actions.map(function(a, i) { return i === actionIdx ? { ...a, status: 'approved' as const } : a })
            return { ...m, actions: updated }
          })
        })
      } catch {}
      return
    }

    // remember_preference → the analyst tapped "Remember this": write it to
    // their memory. Ana only PROPOSED it; this tap is the sole write path.
    if (action.tool === 'remember_preference') {
      try {
        var memRes = await fetch('/api/analyst-memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            statement: action.input.statement,
            source: action.input.source === 'interview' ? 'interview' : 'correction',
            datasetId: action.input.scope === 'dataset' ? datasetId : undefined,
          }),
        })
        if (!memRes.ok) throw new Error('save failed')
        void refreshMemories()
        setMessages(function(prev) {
          return prev.map(function(m) {
            if (m.id !== msgId || !m.actions) return m
            var updated = m.actions.map(function(a, i) { return i === actionIdx ? { ...a, status: 'approved' as const } : a })
            return { ...m, actions: updated }
          })
        })
      } catch {
        setMessages(function(prev) {
          return prev.map(function(m) {
            if (m.id !== msgId || !m.actions) return m
            var updated = m.actions.map(function(a, i) { return i === actionIdx ? { ...a, status: 'rejected' as const } : a })
            return { ...m, actions: updated }
          })
        })
      }
      return
    }

    try {
      // Fetch current theme model — and resolve the ACTIVE question's set
      // when TextMine has one selected (activeFieldKey is already a
      // themeFieldKey, so the single-element wrap passes it through). The
      // state route's merge-on-write mirrors the edited set back into
      // theme_model.fields and preserves every other question's set.
      var stateRes = await fetch('/api/datasets/' + datasetId + '/state')
      if (!stateRes.ok) throw new Error('Failed to fetch state')
      var state = await stateRes.json()
      var storedModel = (state.theme_model || { themes: [], aiGenerated: false, version: 1 }) as ThemeModel
      var themeModel = (activeFieldKey ? themeSetForField(storedModel, [activeFieldKey]) : null) || storedModel
      var themes: AnaTheme[] = (themeModel.themes as AnaTheme[] | undefined) || []

      if (action.tool === 'create_theme') {
        var newTheme = {
          id: 't' + Date.now(),
          name: action.input.name,
          label: action.input.name,
          description: action.input.description,
          keywords: action.input.keywords || [],
          sentiment: action.input.sentiment || 'neutral',
          count: 0,
          percentage: 0,
          relatedThemes: [],
        }
        themes.push(newTheme)
      } else if (action.tool === 'update_theme') {
        var target = themes.find(function(t: AnaTheme) {
          return (t.name || t.label || '').toLowerCase() === (action.input.theme_name || '').toLowerCase()
        })
        if (target) {
          if (action.input.new_name) { target.name = action.input.new_name; target.label = action.input.new_name }
          if (action.input.new_description) target.description = action.input.new_description
          if (action.input.new_sentiment) target.sentiment = action.input.new_sentiment
          if (action.input.add_keywords) {
            var existing = new Set(target.keywords || [])
            action.input.add_keywords.forEach(function(kw: string) { existing.add(kw) })
            target.keywords = Array.from(existing)
          }
          if (action.input.remove_keywords) {
            var toRemove = new Set(action.input.remove_keywords)
            target.keywords = (target.keywords || []).filter(function(kw: string) { return !toRemove.has(kw) })
          }
        }
      } else if (action.tool === 'merge_themes') {
        var mergeNames = new Set((action.input.theme_names || []).map(function(n: string) { return n.toLowerCase() }))
        var mergedKeywords = new Set<string>()
        themes.forEach(function(t: AnaTheme) {
          if (mergeNames.has((t.name || t.label || '').toLowerCase())) {
            (t.keywords || []).forEach(function(kw: string) { mergedKeywords.add(kw) })
          }
        })
        themes = themes.filter(function(t: AnaTheme) { return !mergeNames.has((t.name || t.label || '').toLowerCase()) })
        themes.push({
          id: 't' + Date.now(),
          name: action.input.merged_name,
          label: action.input.merged_name,
          description: action.input.merged_description,
          keywords: Array.from(mergedKeywords),
          sentiment: action.input.merged_sentiment || 'neutral',
          count: 0,
          percentage: 0,
          relatedThemes: [],
        })
      } else if (action.tool === 'delete_theme') {
        var delName = (action.input.theme_name || '').toLowerCase()
        themes = themes.filter(function(t: AnaTheme) { return (t.name || t.label || '').toLowerCase() !== delName })
      } else if (action.tool === 'generate_report') {
        var deckRes = await fetch('/api/ana/render-deck', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deck: action.input, datasetName }),
        })
        if (!deckRes.ok) {
          var errBody = await deckRes.text().catch(function() { return 'unknown error' })
          throw new Error('Render failed: ' + deckRes.status + ' ' + errBody)
        }
        var blob = await deckRes.blob()
        var url = URL.createObjectURL(blob)
        var a = document.createElement('a')
        a.href = url
        a.download = (datasetName || 'report').replace(/[^a-z0-9]/gi, '_').slice(0, 40) + '_ana.pptx'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        setMessages(function(prev) {
          return prev.map(function(m) {
            if (m.id !== msgId || !m.actions) return m
            var updated = m.actions.map(function(a, i) { return i === actionIdx ? { ...a, status: 'approved' as const } : a })
            return { ...m, actions: updated }
          })
        })
        return
      }

      // Save updated theme model (the route merges: this set becomes the
      // active top level AND its map entry; other questions' sets survive)
      themeModel.themes = themes as ThemeModel['themes']
      var patchRes = await fetch('/api/datasets/' + datasetId + '/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme_model: themeModel }),
      })
      if (!patchRes.ok) throw new Error('Failed to save')

      setMessages(function(prev) {
        return prev.map(function(m) {
          if (m.id !== msgId || !m.actions) return m
          var updated = m.actions.map(function(a, i) { return i === actionIdx ? { ...a, status: 'approved' as const } : a })
          return { ...m, actions: updated }
        })
      })

      if (onThemesChanged) onThemesChanged()
    } catch (err: unknown) {
      var errMsg = err instanceof Error ? err.message : String(err)
      setMessages(function(prev) {
        return prev.map(function(m) {
          if (m.id !== msgId) return m
          return { ...m, content: m.content + '\n\n*Error: ' + errMsg + '*' }
        })
      })
    }
  }, [messages, datasetId, onThemesChanged])

  var rejectAction = useCallback(function(msgId: string, actionIdx: number) {
    var msg = messages.find(function(m) { return m.id === msgId })
    if (msg?.actions?.[actionIdx]?.tool === 'recommend_sampling') {
      // Rejected sampling recommendation — go back to setup
      setMessages(function(prev) {
        return prev.map(function(m) {
          if (m.id !== msgId || !m.actions) return m
          var updated = m.actions.map(function(a, i) { return i === actionIdx ? { ...a, status: 'rejected' as const } : a })
          return { ...m, actions: updated }
        })
      })
      setTimeout(function() {
        setMessages([])
        setPhase('setup')
      }, 600)
      return
    }
    setMessages(function(prev) {
      return prev.map(function(m) {
        if (m.id !== msgId || !m.actions) return m
        var updated = m.actions.map(function(a, i) { return i === actionIdx ? { ...a, status: 'rejected' as const } : a })
        return { ...m, actions: updated }
      })
    })
  }, [messages])

  async function sendMessage(text: string, opts?: { briefing?: boolean; hidden?: boolean; forceNormal?: boolean }) {
    if (!text.trim() || loading) return

    var userMsg: Message = { id: Date.now() + '-user', role: 'user', content: text.trim(), hidden: opts?.hidden }
    var assistantId = Date.now() + '-assistant'
    var assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', streaming: true, actions: [] }

    setMessages(function(prev) { return [...prev, userMsg, assistantMsg] })
    setInput('')
    setLoading(true)

    var history = messages
      .filter(function(m) { return !m.streaming })
      .map(function(m) { return { role: m.role, content: m.content } })

    var serializedFilters = filters && Object.keys(filters).length > 0
      ? serializeFilters(filters)
      : undefined

    // Filtered view's flat row ids (when filters are active and the rows cache
    // is loaded) — scopes Ana's server-side aggregates to what the user sees.
    var rowIds: number[] | undefined
    if (serializedFilters && filters && rowsCtx.rowsLoaded && rowsCtx.rows.length > 0) {
      var ids = applyFilters(rowsCtx.rows, filters)
        .map(function(r) { return (r as { _rowId?: unknown })._rowId })
        .filter(function(v): v is number { return typeof v === 'number' })
        .slice(0, 200000)
      if (ids.length > 0) rowIds = ids
    }

    var isDeciding = phase === 'deciding'
    var isInterview = phase === 'interview' && !opts?.forceNormal

    try {
      var res = await fetch('/api/ask-ana', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetId: datasetId,
          question: text.trim(),
          conversationHistory: history,
          filters: serializedFilters,
          rowIds: rowIds,
          metadataOnly: isDeciding,
          interview: isInterview,
          briefing: !!opts?.briefing,
          sampleSize: samplingConfig.sampleSize,
          samplingStrategy: samplingConfig.strategy,
          // active question's theme set (TextMine pill) — Ana's framework
          // context + edits target THIS set, not blindly the saved active one
          themeFieldKey: activeFieldKey || undefined,
        }),
      })

      if (!res.ok) {
        // A failed BRIEFING disappears silently — it was unprompted, so an
        // error bubble with no question above it just reads as a broken app
        // (owner-hit 9/02). The session flag stays set: one attempt per visit.
        if (opts?.briefing) {
          setMessages(function(prev) { return prev.filter(function(m) { return m.id !== assistantId && m.id !== userMsg.id }) })
          setLoading(false)
          return
        }
        var errData = await res.json().catch(function() { return { error: 'Request failed' } })
        setMessages(function(prev) {
          return prev.map(function(m) {
            return m.id === assistantId ? { ...m, content: errData.error || 'Something went wrong.', streaming: false } : m
          })
        })
        setLoading(false)
        return
      }

      var reader = res.body!.getReader()
      var decoder = new TextDecoder()
      var buffer = ''
      var accumulated = ''
      var collectedActions: AnaAction[] = []

      while (true) {
        var result = await reader.read()
        if (result.done) break

        buffer += decoder.decode(result.value, { stream: true })
        var lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i]
          if (!line.startsWith('data: ')) continue
          var payload = line.slice(6).trim()
          if (payload === '[DONE]') continue

          try {
            var event = JSON.parse(payload)
            if (event.text) {
              accumulated += event.text
              var snapshot = accumulated
              var actionsSnapshot = [...collectedActions]
              setMessages(function(prev) {
                return prev.map(function(m) {
                  return m.id === assistantId ? { ...m, content: snapshot, actions: actionsSnapshot, statusText: undefined } : m
                })
              })
            }
            if (event.demote) {
              // The lead-in that streamed into the bubble was a passing thought
              // (tool rounds follow) — move it to the transient status slot so
              // the bubble only ever holds the final answer.
              var demoted = accumulated.trim().slice(0, 160)
              accumulated = ''
              setMessages(function(prev) {
                return prev.map(function(m) {
                  if (m.id !== assistantId) return m
                  var lg = demoted ? (m.logic || []).concat([demoted]) : m.logic
                  return { ...m, content: '', statusText: demoted || m.statusText, logic: lg }
                })
              })
            }
            if (event.logic) {
              var logicLine = String(event.logic)
              setMessages(function(prev) {
                return prev.map(function(m) {
                  return m.id === assistantId ? { ...m, logic: (m.logic || []).concat([logicLine]) } : m
                })
              })
            }
            if (event.status) {
              var statusSnap = String(event.status)
              setMessages(function(prev) {
                return prev.map(function(m) {
                  return m.id === assistantId ? { ...m, statusText: statusSnap } : m
                })
              })
            }
            if (event.canvas && event.canvas.chartType) {
              var canvasSnap = event.canvas as Message['canvas']
              setMessages(function(prev) {
                return prev.map(function(m) {
                  return m.id === assistantId ? { ...m, canvas: canvasSnap } : m
                })
              })
            }
            if (event.action) {
              collectedActions.push({
                tool: event.action.tool,
                toolId: event.action.toolId,
                input: event.action.input,
                status: 'pending',
              })
              var actSnap = [...collectedActions]
              var textSnap = accumulated
              setMessages(function(prev) {
                return prev.map(function(m) {
                  return m.id === assistantId ? { ...m, content: textSnap, actions: actSnap } : m
                })
              })
            }
            if (event.error) {
              accumulated += '\n\n*Error: ' + event.error + '*'
            }
          } catch {}
        }
      }

      // Interview → data-question handoff: the interview prompt answers a data
      // question with EXACTLY [[interview-done]]. End the interview and re-send
      // the same question through normal mode (full data access) — removing
      // both the marker reply and the original user bubble so the resend
      // renders once.
      if (isInterview && accumulated.indexOf('[[interview-done]]') !== -1) {
        setMessages(function(prev) { return prev.filter(function(m) { return m.id !== assistantId && m.id !== userMsg.id }) })
        setLoading(false)
        void finishInterview()
        setTimeout(function() { void sendMessage(text.trim(), { forceNormal: true }) }, 80)
        return
      }

      var final_ = accumulated
      var finalActions = [...collectedActions]
      // Stream died with no answer (e.g. the serverless function hit its time
      // limit mid-loop — owner 9/02, ANES): say so honestly instead of
      // leaving an empty bubble above the provenance trail.
      if (!final_.trim() && finalActions.length === 0 && !opts?.briefing) {
        final_ = '*Ana ran out of time before she could write the answer — the queries above completed, but the analysis window closed. Try asking again (repeat runs are faster), or narrow the question to fewer themes or a shorter time range.*'
      }
      setMessages(function(prev) {
        return prev.map(function(m) {
          return m.id === assistantId ? { ...m, content: final_, streaming: false, actions: finalActions, statusText: undefined } : m
        })
      })
    } catch (err) {
      if (opts?.briefing) {
        setMessages(function(prev) { return prev.filter(function(m) { return m.id !== assistantId && m.id !== userMsg.id }) })
        setLoading(false)
        return
      }
      setMessages(function(prev) {
        return prev.map(function(m) {
          return m.id === assistantId ? { ...m, content: 'Connection error. Please try again.', streaming: false } : m
        })
      })
    }

    setLoading(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage(input)
    }
  }

  function handleClear() {
    setMessages([])
    setInput('')
    if (phase === 'deciding') setPhase('setup')
  }

  function handleSelectPreset(size: number) {
    setSamplingConfig(function(c) { return { ...c, sampleSize: size, configured: true } })
    setPhase('chat')
  }

  function handleCustomSize() {
    var n = parseInt(customSizeInput, 10)
    if (isNaN(n) || n < 50) n = 50
    if (n > 500) n = 500
    setSamplingConfig(function(c) { return { ...c, sampleSize: n, configured: true } })
    setPhase('chat')
  }

  function handleAnaHelp() {
    setPhase('deciding')
    setTimeout(function() {
      void sendMessage('Help me figure out the right sampling configuration for my analysis of this dataset.')
    }, 100)
  }

  function handleSkipSetup() {
    setSamplingConfig(function(c) { return { ...c, sampleSize: 500, configured: true } })
    setPhase('chat')
  }

  function handleReconfigure() {
    setSamplingConfig(function(c) { return { ...c, configured: false } })
    setMessages([])
    setPhase('setup')
  }

  var hasMessages = messages.length > 0
  var isCollection = datasetSource === 'collection'
  var totalRows = isCollection && collectionMembers
    ? collectionMembers.reduce(function(s, m) { return s + m.row_count }, 0)
    : datasetRowCount

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: expanded ? 'min(940px, 92vw)' : 420, maxWidth: '100vw',
      transition: 'width .2s ease',
      background: 'white', boxShadow: '-8px 0 32px rgba(0,0,0,.15)',
      display: 'flex', flexDirection: 'column', zIndex: 1500,
      animation: 'askAnaSlideIn .2s ease-out',
    }}>
      <style>{`
        @keyframes askAnaSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .ask-ana-input:focus { outline: none; border-color: ${HERMES} !important; box-shadow: 0 0 0 3px rgba(232,99,42,.15) !important; }
      `}</style>

      {/* Header */}
      <div style={{
        height: 56, padding: '0 16px', borderBottom: 'none',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        background: HERMES,
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, fontWeight: 900, color: 'white',
        }}>A</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'white', letterSpacing: '-.2px' }}>Ask Ana</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.7)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {samplingConfig.configured && totalRows > SAMPLING_THRESHOLD
              ? 'Analyzing ' + samplingConfig.sampleSize.toLocaleString() + ' of ' + totalRows.toLocaleString() + ' rows'
              : datasetName
            }
          </div>
        </div>
        <button onClick={function() { setExpanded(!expanded) }}
          title={expanded ? 'Collapse' : 'Expand for reading'}
          style={{
            fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.85)', background: 'rgba(255,255,255,.15)',
            border: '1px solid rgba(255,255,255,.25)', borderRadius: 6, padding: '3px 8px',
            cursor: 'pointer', lineHeight: 1,
          }}>
          {expanded ? '\u2924' : '\u2922'}
        </button>
        <button onClick={function() { if (view !== 'memory') void refreshMemories(); setView(view === 'memory' ? 'chat' : 'memory') }}
          style={{
            fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,.8)', background: view === 'memory' ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.15)',
            border: '1px solid rgba(255,255,255,.25)', borderRadius: 6, padding: '3px 8px',
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
          {view === 'memory' ? '\u2190 Chat' : 'Memory'}
        </button>
        {samplingConfig.configured && totalRows > SAMPLING_THRESHOLD && (
          <button onClick={handleReconfigure}
            style={{
              fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,.8)', background: 'rgba(255,255,255,.15)',
              border: '1px solid rgba(255,255,255,.25)', borderRadius: 6, padding: '3px 8px',
              cursor: 'pointer',
            }}>
            Sampling
          </button>
        )}
        {hasMessages && (
          <button onClick={handleClear}
            style={{
              fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.8)', background: 'rgba(255,255,255,.15)',
              border: '1px solid rgba(255,255,255,.25)', borderRadius: 6, padding: '4px 10px',
              cursor: 'pointer',
            }}>
            Clear
          </button>
        )}
        <button onClick={onClose}
          style={{
            fontSize: 18, color: 'rgba(255,255,255,.7)', background: 'none', border: 'none',
            cursor: 'pointer', padding: '0 4px', lineHeight: 1,
          }}>{'\u00D7'}</button>
      </div>

      {/* ── Memory view: "What Ana remembers" ─────────────────────── */}
      {view === 'memory' && (
        <MemoryList memories={memories} datasetId={datasetId} onChanged={refreshMemories} />
      )}

      {/* Messages area */}
      {view === 'chat' && (
      <div ref={scrollRef} style={{
        flex: 1, overflow: 'auto', padding: '16px 16px 8px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {/* ── Setup phase: sampling config ──────────────────────────── */}
        {phase === 'setup' && !hasMessages && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16, padding: '0 8px' }}>
            {/* Dataset info */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>{'\uD83D\uDCCA'}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 4 }}>
                {isCollection
                  ? totalRows.toLocaleString() + ' rows across ' + (collectionMembers ? collectionMembers.length : '?') + ' datasets'
                  : totalRows.toLocaleString() + ' rows'
                }
              </div>
              <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
                Ana will analyze a representative sample. Choose how many rows to include.
              </div>
            </div>

            {/* Collection member breakdown */}
            {isCollection && collectionMembers && collectionMembers.length > 0 && (
              <div style={{ background: '#f9fafb', borderRadius: 10, padding: '10px 12px', border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 6 }}>Members</div>
                {/* Stacked bar */}
                <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 8, marginBottom: 8 }}>
                  {collectionMembers.map(function(m, i) {
                    var pct = totalRows > 0 ? (m.row_count / totalRows * 100) : 0
                    var colors = ['#E8632A', '#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444']
                    return <div key={i} style={{ width: pct + '%', background: colors[i % colors.length], minWidth: 2 }} />
                  })}
                </div>
                {collectionMembers.map(function(m, i) {
                  var colors = ['#E8632A', '#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444']
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, fontSize: 12 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: colors[i % colors.length], flexShrink: 0 }} />
                      <span style={{ flex: 1, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                      <span style={{ color: '#9ca3af', fontSize: 11 }}>{m.row_count.toLocaleString()}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Sample size presets */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Sample size</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { label: 'Quick scan', size: 100, desc: 'Fast overview' },
                  { label: 'Standard', size: 200, desc: 'Good balance' },
                  { label: 'Deep dive', size: 500, desc: 'Thorough analysis' },
                ].map(function(p) {
                  if (p.size > totalRows) return null
                  return (
                    <button key={p.size} onClick={function() { handleSelectPreset(p.size) }}
                      style={{
                        textAlign: 'left', padding: '10px 12px', fontSize: 13, color: '#374151',
                        background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
                        cursor: 'pointer', lineHeight: 1.4, transition: 'all .12s',
                      }}
                      onMouseEnter={function(e) { (e.currentTarget as HTMLButtonElement).style.borderColor = HERMES }}
                      onMouseLeave={function(e) { (e.currentTarget as HTMLButtonElement).style.borderColor = '#e5e7eb' }}>
                      <div style={{ fontWeight: 600 }}>{p.label}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>{p.size.toLocaleString()} rows &middot; {p.desc}</div>
                    </button>
                  )
                })}
                {/* Custom size */}
                <div style={{
                  padding: '10px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Custom</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="number" min="50" max="1500"
                      placeholder="50-500"
                      value={customSizeInput}
                      onChange={function(e) { setCustomSizeInput(e.target.value) }}
                      onKeyDown={function(e) { if (e.key === 'Enter') handleCustomSize() }}
                      style={{
                        flex: 1, fontSize: 13, padding: '4px 8px', border: '1px solid #d1d5db',
                        borderRadius: 6, width: '100%', minWidth: 0,
                      }}
                    />
                    <button onClick={handleCustomSize} disabled={!customSizeInput}
                      style={{
                        fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
                        background: customSizeInput ? HERMES : '#d1d5db', color: 'white', border: 'none',
                        cursor: customSizeInput ? 'pointer' : 'default',
                      }}>Go</button>
                  </div>
                </div>
              </div>
            </div>

            {/* Collection strategy */}
            {isCollection && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Distribution across members</div>
                <select
                  value={samplingConfig.strategy}
                  onChange={function(e) { setSamplingConfig(function(c) { return { ...c, strategy: e.target.value as SamplingConfig['strategy'] } }) }}
                  style={{
                    width: '100%', fontSize: 13, padding: '8px 10px', border: '1px solid #d1d5db',
                    borderRadius: 8, background: 'white', color: '#374151', cursor: 'pointer',
                  }}>
                  <option value="proportional">Proportional &mdash; weight by dataset size</option>
                  <option value="equal">Equal &mdash; same count per dataset</option>
                  <option value="floor">Minimum floor &mdash; ensure small datasets are represented</option>
                </select>
              </div>
            )}

            {/* Ana help button */}
            <button onClick={handleAnaHelp}
              style={{
                width: '100%', padding: '12px', fontSize: 14, fontWeight: 700,
                background: HERMES, color: 'white', border: 'none', borderRadius: 10,
                cursor: 'pointer', transition: 'opacity .15s',
              }}
              onMouseEnter={function(e) { (e.currentTarget as HTMLButtonElement).style.opacity = '0.9' }}
              onMouseLeave={function(e) { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}>
              Let Ana help me decide
            </button>

            {/* Skip link */}
            <div style={{ textAlign: 'center' }}>
              <button onClick={handleSkipSetup}
                style={{
                  fontSize: 12, color: '#9ca3af', background: 'none', border: 'none',
                  cursor: 'pointer', textDecoration: 'underline',
                }}>
                Skip, use defaults (200 rows)
              </button>
            </div>
          </div>
        )}

        {/* ── Chat phase: normal starters ──────────────────────────── */}
        {phase === 'chat' && !hasMessages && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 20, padding: '0 16px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>{'\uD83D\uDCAC'}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 4 }}>Ask Ana anything</div>
              <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
                Ask questions about your data, or tell Ana to create and modify themes.
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
              {STARTERS.map(function(s, i) {
                return (
                  <button key={i} onClick={function() { void sendMessage(s) }}
                    style={{
                      textAlign: 'left', padding: '10px 14px', fontSize: 13, color: '#374151',
                      background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
                      cursor: 'pointer', lineHeight: 1.4, transition: 'all .12s',
                    }}
                    onMouseEnter={function(e) { (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6'; (e.currentTarget as HTMLButtonElement).style.borderColor = HERMES }}
                    onMouseLeave={function(e) { (e.currentTarget as HTMLButtonElement).style.background = '#f9fafb'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#e5e7eb' }}>
                    {s}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Messages ─────────────────────────────────────────────── */}
        {messages.map(function(m) {
          var isUser = m.role === 'user'
          if (m.hidden) return null
          return (
            <div key={m.id} style={{
              display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start',
            }}>
              <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', width: '100%' }}>
                {!isUser && (
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', background: HERMES,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 900, color: 'white', flexShrink: 0, marginRight: 8, marginTop: 2,
                  }}>A</div>
                )}
                <div style={{
                  maxWidth: '80%', padding: isUser ? '10px 16px' : '9px 14px',
                  borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                  background: isUser ? IMSG_BLUE : IMSG_GRAY,
                  color: isUser ? 'white' : '#000',
                  fontSize: isUser ? 15 : 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {isUser ? m.content : <FormattedResponse text={m.content} streaming={m.streaming} />}
                </div>
              </div>
              {!isUser && m.streaming && m.statusText && (
                <div style={{ marginLeft: 36, marginTop: 4, fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>
                  {m.statusText}
                </div>
              )}
              {!isUser && m.streaming && !m.content && <WorkingFactoid />}
              {!isUser && !m.streaming && m.logic && m.logic.length > 0 && (
                <div style={{ marginLeft: 36, marginTop: 6, alignSelf: 'flex-start', maxWidth: '85%' }}>
                  <button
                    onClick={function() {
                      setMessages(function(prev) {
                        return prev.map(function(x) { return x.id === m.id ? { ...x, showLogic: !x.showLogic } : x })
                      })
                    }}
                    style={{
                      fontSize: 11, fontWeight: 600, color: '#6b7280', background: 'none',
                      border: '1px solid #e5e7eb', borderRadius: 999, padding: '3px 10px',
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    {'\uD83E\uDDE0'} {m.showLogic ? 'Hide provenance' : 'Provenance \u2014 how this analysis and report was derived (' + m.logic.length + ' steps)'}
                  </button>
                  {m.showLogic && (
                    <div style={{
                      marginTop: 6, border: '1px solid #eee', borderRadius: 10, padding: '10px 12px',
                      fontSize: 11.5, lineHeight: 1.55, color: '#4b5563', background: '#fafafa',
                    }}>
                      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#0d9488', marginBottom: 6 }}>
                        Provenance {'\u2014'} how this analysis and report was derived
                      </div>
                      {m.logic.map(function(step, si) {
                        return (
                          <div key={si} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                            <span style={{ color: '#9ca3af', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{si + 1}.</span>
                            <span>{step}</span>
                          </div>
                        )
                      })}
                      <div style={{ marginTop: 6, fontSize: 10.5, color: '#9ca3af' }}>
                        Every number above came from these queries against the full dataset — the same engine the Charts and Statistics tabs use.
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!isUser && !m.streaming && m.canvas && (
                <button onClick={function() { openInCharts(m.canvas!) }}
                  style={{
                    marginLeft: 36, marginTop: 6, fontSize: 12, fontWeight: 600, color: HERMES,
                    background: 'white', border: '1px solid #E5C9B2', borderRadius: 999,
                    padding: '5px 13px', cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start',
                  }}>
                  {'\uD83D\uDCCA'} Open in Charts &mdash; {m.canvas.label}
                </button>
              )}
              {/* Action confirmation cards */}
              {!isUser && m.actions && m.actions.length > 0 && (
                <div style={{ marginLeft: 36, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: '85%' }}>
                  {m.actions.map(function(action, ai) {
                    return <ActionCard key={ai} action={action} msgId={m.id} actionIdx={ai}
                      onApprove={function(mid, idx) { void applyAction(mid, idx) }} onReject={rejectAction} />
                  })}
                </div>
              )}
              {!isUser && !m.streaming && m.content && (!m.actions || m.actions.length === 0) && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                  <CopyButton text={m.content} />
                  {m.content.length > 200 && (
                    <button
                      onClick={function() { void sendMessage('Convert your previous analysis into a downloadable slide deck. Use the most appropriate slide types for the data.') }}
                      disabled={loading}
                      style={{
                        fontSize: 10, color: '#6b7280', background: 'none', border: '1px solid #e5e7eb',
                        borderRadius: 12, padding: '3px 10px', cursor: loading ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit', opacity: loading ? 0.5 : 1,
                      }}
                    >Download as slides</button>
                  )}
                  {m.content.length > 200 && (
                    <button
                      onClick={function() { void exportPdf(exchangeFor(m.id)) }}
                      disabled={exportingPdf}
                      style={{
                        fontSize: 10, color: '#6b7280', background: 'none', border: '1px solid #e5e7eb',
                        borderRadius: 12, padding: '3px 10px', cursor: exportingPdf ? 'wait' : 'pointer',
                        fontFamily: 'inherit', opacity: exportingPdf ? 0.5 : 1,
                      }}
                    >{exportingPdf ? 'Building PDF\u2026' : 'PDF'}</button>
                  )}
                  {m.content.length > 200 && threadExchanges().length > 1 && (
                    <button
                      onClick={function() { void exportPdf(threadExchanges()) }}
                      disabled={exportingPdf}
                      style={{
                        fontSize: 10, color: '#6b7280', background: 'none', border: '1px solid #e5e7eb',
                        borderRadius: 12, padding: '3px 10px', cursor: exportingPdf ? 'wait' : 'pointer',
                        fontFamily: 'inherit', opacity: exportingPdf ? 0.5 : 1,
                      }}
                    >PDF &middot; whole thread</button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      )}

      {view === 'chat' && (phase === 'chat' || phase === 'deciding' || phase === 'interview') && (
        <div style={{
          padding: '12px 16px', borderTop: '1px solid #e5e7eb',
          background: '#fafafa', flexShrink: 0,
        }}>
          {phase === 'interview' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 11, color: '#9a5a2e', background: '#FDF0E7', border: '1px solid #F3D5BD', borderRadius: 8, padding: '6px 10px' }}>
              <span style={{ flex: 1 }}>{'\u2B50'} Ana is getting to know you &mdash; answers you confirm are saved to her memory.</span>
              <button onClick={function() { void finishInterview() }}
                style={{ fontSize: 11, fontWeight: 600, color: HERMES, background: 'none', border: '1px solid #F3D5BD', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                Done / skip
              </button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              className="ask-ana-input"
              value={input}
              onChange={function(e) { setInput(e.target.value) }}
              onKeyDown={handleKeyDown}
              placeholder={phase === 'deciding' ? 'Tell Ana what you want to learn...' : phase === 'interview' ? 'Tell Ana how you work...' : 'Ask a question or tell Ana to modify themes...'}
              rows={1}
              disabled={loading}
              style={{
                // fontSize lives in globals.css (.ask-ana-input): 16px floor on touch, 14px on desktop
                flex: 1, resize: 'none', padding: '10px 14px',
                border: '1px solid #d1d5db', borderRadius: 12,
                background: 'white', color: '#111', lineHeight: 1.4,
                minHeight: 42, maxHeight: 120, overflow: 'auto',
                fontFamily: 'inherit',
              }}
            />
            <button
              onClick={function() { void sendMessage(input) }}
              disabled={!input.trim() || loading}
              style={{
                width: 40, height: 40, borderRadius: '50%',
                background: input.trim() && !loading ? HERMES : '#d1d5db',
                border: 'none', cursor: input.trim() && !loading ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background .15s', flexShrink: 0,
              }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 6, textAlign: 'center' }}>
            {phase === 'deciding'
              ? 'Ana will recommend a sampling configuration based on your goals.'
              : 'Ana can answer questions and modify your analysis framework. Shift+Enter for new line.'
            }
          </div>
        </div>
      )}
    </div>
  )
}

// ── Action confirmation card ────────────────────────────────────────────────
function ActionCard({ action, msgId, actionIdx, onApprove, onReject }: {
  action: AnaAction; msgId: string; actionIdx: number
  onApprove: (msgId: string, idx: number) => void
  onReject: (msgId: string, idx: number) => void
}) {
  var [applying, setApplying] = useState(false)

  var toolLabel: Record<string, string> = {
    create_theme: 'Create Theme',
    update_theme: 'Update Theme',
    merge_themes: 'Merge Themes',
    delete_theme: 'Delete Theme',
    generate_report: 'Generate Deck',
    recommend_sampling: 'Sampling Recommendation',
  }

  var toolIcon: Record<string, string> = {
    create_theme: '+',
    update_theme: '\u270E',
    merge_themes: '\u2194',
    delete_theme: '\u2212',
    generate_report: '\u25A3',
    recommend_sampling: '\u2693',
  }

  var borderColor = action.status === 'approved' ? '#22c55e'
    : action.status === 'rejected' ? '#d1d5db'
    : HERMES

  var inp = action.input

  return (
    <div style={{
      border: '1.5px solid ' + borderColor,
      borderRadius: 12, padding: '10px 14px', background: 'white',
      opacity: action.status === 'rejected' ? 0.5 : 1,
      transition: 'opacity .2s, border-color .2s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 6, background: borderColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, color: 'white',
        }}>{toolIcon[action.tool] || '?'}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>
          {toolLabel[action.tool] || action.tool}
        </span>
        {action.status === 'approved' && (
          <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 600, marginLeft: 'auto' }}>Applied</span>
        )}
        {action.status === 'rejected' && (
          <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, marginLeft: 'auto' }}>Cancelled</span>
        )}
      </div>

      {/* Body — varies by tool */}
      {action.tool === 'recommend_sampling' && (
        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
            <div>
              <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600 }}>Sample Size</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: HERMES }}>{(inp.sample_size || 500).toLocaleString()}</div>
            </div>
            {inp.strategy && (
              <div>
                <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600 }}>Strategy</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                  {inp.strategy === 'proportional' ? 'Proportional' : inp.strategy === 'equal' ? 'Equal' : 'Min floor'}
                </div>
              </div>
            )}
          </div>
          {inp.reasoning && <div style={{ color: '#6b7280', fontSize: 11 }}>{inp.reasoning}</div>}
        </div>
      )}

      {action.tool === 'create_theme' && (
        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{inp.name}</div>
          <div style={{ color: '#6b7280', marginBottom: 4 }}>{inp.description}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {(inp.keywords || []).slice(0, 12).map(function(kw: string, ki: number) {
              return <span key={ki} style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 4,
                background: '#f3f4f6', color: '#4b5563', border: '1px solid #e5e7eb',
              }}>{kw}</span>
            })}
            {(inp.keywords || []).length > 12 && (
              <span style={{ fontSize: 10, color: '#9ca3af' }}>+{inp.keywords!.length - 12} more</span>
            )}
          </div>
        </div>
      )}

      {action.tool === 'update_theme' && (
        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
          <div><strong>{inp.theme_name}</strong>{inp.new_name ? ' \u2192 ' + inp.new_name : ''}</div>
          {inp.new_description && <div style={{ color: '#6b7280' }}>{inp.new_description}</div>}
          {inp.add_keywords && inp.add_keywords.length > 0 && (
            <div style={{ marginTop: 3 }}>
              <span style={{ color: '#22c55e', fontSize: 10, fontWeight: 600 }}>+ </span>
              {inp.add_keywords.map(function(kw: string, ki: number) {
                return <span key={ki} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#dcfce7', color: '#166534', marginRight: 3 }}>{kw}</span>
              })}
            </div>
          )}
          {inp.remove_keywords && inp.remove_keywords.length > 0 && (
            <div style={{ marginTop: 3 }}>
              <span style={{ color: '#ef4444', fontSize: 10, fontWeight: 600 }}>&minus; </span>
              {inp.remove_keywords.map(function(kw: string, ki: number) {
                return <span key={ki} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#fee2e2', color: '#991b1b', marginRight: 3, textDecoration: 'line-through' }}>{kw}</span>
              })}
            </div>
          )}
        </div>
      )}

      {action.tool === 'merge_themes' && (
        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
          <div>{(inp.theme_names || []).join(' + ')} <strong>{'\u2192'} {inp.merged_name}</strong></div>
          {inp.merged_description && <div style={{ color: '#6b7280' }}>{inp.merged_description}</div>}
        </div>
      )}

      {action.tool === 'delete_theme' && (
        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
          <div>Remove: <strong>{inp.theme_name}</strong></div>
          {inp.reason && <div style={{ color: '#6b7280' }}>{inp.reason}</div>}
        </div>
      )}

      {action.tool === 'generate_report' && (
        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{inp.title}{inp.subtitle ? ' — ' + inp.subtitle : ''}</div>
          {(inp.slides || []).map(function(s: { type: string; title: string }, si: number) {
            var typeIcon: Record<string, string> = { bar_chart: '\u2593', kpi_grid: '\u25A3', table: '\u2261', bullets: '\u2022', quotes: '\u201C', two_column: '\u2016' }
            return (
              <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 10, color: HERMES, fontWeight: 700, width: 14 }}>{typeIcon[s.type] || '?'}</span>
                <span style={{ fontSize: 11 }}>{s.title}</span>
                <span style={{ fontSize: 9, color: '#9ca3af' }}>({s.type})</span>
              </div>
            )
          })}
          <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>{(inp.slides || []).length} slides</div>
        </div>
      )}

      {action.tool === 'set_view' && (
        <div style={{ fontSize: 13, color: '#111', lineHeight: 1.5 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.07em', color: HERMES, marginBottom: 4 }}>{'\uD83D\uDDBC'} SET UP THIS VIEW</div>
          {inp.summary}
          <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>Applies filters{inp.textField ? ' + text column' : ''}{inp.tab ? ' and opens the ' + inp.tab + ' tab' : ''} &middot; you can adjust everything afterwards</div>
        </div>
      )}

      {action.tool === 'remember_preference' && (
        <div style={{ fontSize: 13, color: '#111', lineHeight: 1.5 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.07em', color: HERMES, marginBottom: 4 }}>{'\u2B50'} REMEMBER</div>
          {inp.statement}
          <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>
            {inp.scope === 'dataset' ? 'This dataset only' : 'Applies across this account'} &middot; editable anytime in Memory
          </div>
        </div>
      )}

      {/* Buttons */}
      {action.status === 'pending' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={function() { setApplying(true); onApprove(msgId, actionIdx) }}
            disabled={applying}
            style={{
              flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 600,
              background: HERMES, color: 'white', border: 'none',
              borderRadius: 8, cursor: applying ? 'default' : 'pointer',
              opacity: applying ? 0.6 : 1,
            }}>
            {applying
              ? (action.tool === 'generate_report' ? 'Building deck...' : action.tool === 'remember_preference' ? 'Saving...' : 'Applying...')
              : (action.tool === 'generate_report' ? 'Build & Download' : action.tool === 'recommend_sampling' ? 'Use this' : action.tool === 'remember_preference' ? 'Remember this' : action.tool === 'set_view' ? 'Set up view' : 'Approve')
            }
          </button>
          <button onClick={function() { onReject(msgId, actionIdx) }}
            style={{
              flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 600,
              background: 'white', color: '#6b7280', border: '1px solid #d1d5db',
              borderRadius: 8, cursor: 'pointer',
            }}>
            {action.tool === 'recommend_sampling' ? 'Adjust manually' : action.tool === 'remember_preference' ? 'Not quite' : action.tool === 'set_view' ? 'Not now' : 'Cancel'}
          </button>
        </div>
      )}
    </div>
  )
}

// Simple markdown-like formatting for Ana's responses
function FormattedResponse({ text, streaming }: { text: string; streaming?: boolean }) {
  if (!text && streaming) {
    return <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Thinking...</span>
  }

  // Inline charts: ```chart fenced specs render as real charts between the
  // text segments (owner 9/02 — "draw charts instead of tables").
  var segments = splitAnaSegments(text)
  return (
    <>
      {segments.map(function(seg, si) {
        if (seg.kind === 'chart') return <InlineAnaChart key={'c' + si} spec={seg.spec} />
        if (seg.kind === 'pending') {
          return <div key={'p' + si} style={{ color: '#9ca3af', fontStyle: 'italic', fontSize: 12, marginTop: 4 }}>{'\uD83D\uDCCA'} drawing chart&hellip;</div>
        }
        return <FormattedLines key={'t' + si} text={seg.text} />
      })}
      {streaming && <span style={{ animation: 'blink 1s infinite' }}>{'\u258C'}</span>}
      <style>{`@keyframes blink { 0%,50% { opacity: 1 } 51%,100% { opacity: 0 } }`}</style>
    </>
  )
}

function FormattedLines({ text }: { text: string }) {
  var parts = text.split('\n')
  var elements: React.ReactNode[] = []

  for (var i = 0; i < parts.length; i++) {
    var line = parts[i]

    // A run of |…| lines → a real table (mirrors lib/anaPdf tableHtml —
    // owner 9/02: raw pipe rows in the panel are "quite hideous").
    if (/^\|.*\|$/.test(line.trim())) {
      var tbl: string[] = []
      while (i < parts.length && /^\|.*\|$/.test(parts[i].trim())) { tbl.push(parts[i]); i++ }
      i--
      elements.push(<AnaTable key={'tbl' + i} lines={tbl} />)
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      elements.push(<div key={i} style={{ borderTop: '1px solid #e5e7eb', margin: '10px 0' }} />)
      continue
    }
    if (/^>\s?/.test(line.trim())) {
      elements.push(
        <div key={i} style={{ borderLeft: '3px solid ' + HERMES, paddingLeft: 10, margin: '6px 0', color: '#4b5563', fontStyle: 'italic' }}>
          {formatInline(line.trim().replace(/^>\s?/, ''))}
        </div>
      )
      continue
    }

    var formatted = formatInline(line)

    if (line.match(/^[\-\*]\s/)) {
      elements.push(
        <div key={i} style={{ paddingLeft: 12, position: 'relative', marginTop: 2 }}>
          <span style={{ position: 'absolute', left: 0 }}>{'\u2022'}</span>
          <span>{formatted}</span>
        </div>
      )
    }
    else if (line.match(/^\d+\.\s/)) {
      elements.push(
        <div key={i} style={{ paddingLeft: 4, marginTop: 2 }}>{formatted}</div>
      )
    }
    else if (line.match(/^#{1,3}\s/)) {
      var headerText = line.replace(/^#{1,3}\s/, '')
      elements.push(
        <div key={i} style={{ fontWeight: 700, marginTop: i > 0 ? 8 : 0, marginBottom: 2 }}>{headerText}</div>
      )
    }
    else if (line.trim() === '') {
      elements.push(<div key={i} style={{ height: 6 }} />)
    }
    else {
      elements.push(<div key={i}>{formatted}</div>)
    }
  }

  return <>{elements}</>
}

// ── Inline chart renderer — the product's chart idiom in miniature ─────────
// Single series only (the product orange carries it; no legend needed — the
// title names it). Values come verbatim from Ana's query results; anything
// richer belongs on the Charts tab via "Open in Charts".
function InlineAnaChart({ spec }: { spec: AnaChartSpec }) {
  var max = Math.max.apply(null, spec.data.map(function(d) { return Math.abs(d[1]) }).concat([1]))
  var fmt = function(v: number) { return Math.abs(v) >= 1000 ? v.toLocaleString() : String(Math.round(v * 100) / 100) }

  return (
    <div style={{ background: 'white', border: '1px solid #eee', borderRadius: 10, padding: '10px 12px', margin: '8px 0', maxWidth: 460 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#111827', marginBottom: 8 }}>
        {spec.title}
        {spec.unit && <span style={{ fontWeight: 400, color: '#9ca3af' }}> &middot; {spec.unit}</span>}
      </div>
      {spec.type === 'bar' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {spec.data.map(function(d, i) {
            var pct = Math.max(2, Math.round(Math.abs(d[1]) / max * 100))
            return (
              <div key={i} title={d[0] + ': ' + fmt(d[1])} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 52px', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d[0]}</span>
                <div style={{ height: 10, background: '#F3F4F6', borderRadius: '0 4px 4px 0', overflow: 'hidden' }}>
                  <div style={{ width: pct + '%', height: '100%', background: HERMES, borderRadius: '0 4px 4px 0' }} />
                </div>
                <span style={{ fontSize: 11.5, color: '#374151', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(d[1])}</span>
              </div>
            )
          })}
        </div>
      )}
      {spec.type === 'line' && (function() {
        var W = 420, H = 96, PAD = 6
        var vals = spec.data.map(function(d) { return d[1] })
        var lo = Math.min.apply(null, vals)
        var hi = Math.max.apply(null, vals)
        var span = hi - lo || 1
        var pts = spec.data.map(function(d, i) {
          var x = PAD + (i / Math.max(1, spec.data.length - 1)) * (W - PAD * 2)
          var y = PAD + (1 - (d[1] - lo) / span) * (H - PAD * 2)
          return [x, y] as [number, number]
        })
        var poly = pts.map(function(pt) { return pt[0] + ',' + pt[1] }).join(' ')
        var area = 'M' + pts[0][0] + ',' + (H - PAD) + ' L' + poly.split(' ').map(function(pr) { return pr.replace(',', ' ') }).join(' L') + ' L' + pts[pts.length - 1][0] + ',' + (H - PAD) + ' Z'
        var last = pts[pts.length - 1]
        return (
          <div>
            <svg viewBox={'0 0 ' + W + ' ' + H} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={spec.title}>
              <path d={area} fill={HERMES} opacity={0.08} />
              <polyline points={poly} fill="none" stroke={HERMES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={last[0]} cy={last[1]} r={3.5} fill={HERMES} />
              {spec.data.map(function(d, i) {
                return <circle key={i} cx={pts[i][0]} cy={pts[i][1]} r={6} fill="transparent"><title>{d[0] + ': ' + fmt(d[1])}</title></circle>
              })}
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>
              <span>{spec.data[0][0]}</span>
              <span>{'low ' + fmt(lo) + ' \u00B7 high ' + fmt(hi)}</span>
              <span>{spec.data[spec.data.length - 1][0]}</span>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// Copy button for assistant messages
function CopyButton({ text }: { text: string }) {
  var [copied, setCopied] = useState(false)
  function handleCopy() {
    void navigator.clipboard.writeText(text).then(function() {
      setCopied(true)
      setTimeout(function() { setCopied(false) }, 2000)
    })
  }
  return (
    <button onClick={handleCopy}
      style={{
        marginLeft: 36, marginTop: 3, fontSize: 10, color: copied ? '#059669' : '#9ca3af',
        background: 'none', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 3, padding: 0,
        transition: 'color .15s',
      }}>
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// Handle inline formatting: **bold**, *italic*, "quotes"
// Rotating "Did you know?" factoid for long analysis waits (owner 9/03: the
// Data Story building screen's lib/funFacts pool, reused so a many-round
// question never feels like an infinite wait). Appears only after the first
// 3 seconds (owner 9/03) — quick answers never see it — then rotates with a
// soft fade. Muted styling keeps the status line as THE current thought.
function WorkingFactoid() {
  var [fact, setFact] = useState<string | null>(null)
  var [faded, setFaded] = useState(false)
  useEffect(function() {
    var alive = true
    // No-repeat rotation (owner 9/03: saw the same fact twice): walk the
    // pool sequentially from a random start — a repeat is impossible until
    // the whole pool has been shown.
    var current = Math.floor(Math.random() * FUN_FACTS.length)
    function pick() {
      current = (current + 1) % FUN_FACTS.length
      return FUN_FACTS[current]
    }
    var showTimer = setTimeout(function() { if (alive) setFact(pick()) }, 3000)
    var rotate = setInterval(function() {
      if (!alive) return
      setFaded(true)
      setTimeout(function() {
        if (!alive) return
        setFact(pick())
        setFaded(false)
      }, 400)
      // 8s: one relaxed read + a beat (adult non-fiction ~238wpm; subtitle
      // standards 160-180wpm price our longest facts at 7-9s; NN/g advises
      // ~5-7s/frame for short rotating text). Matches the story build screen.
    }, 8000)
    return function() { alive = false; clearTimeout(showTimer); clearInterval(rotate) }
  }, [])
  if (!fact) return null
  return (
    <div style={{ marginLeft: 36, marginTop: 8, maxWidth: '85%', opacity: faded ? 0 : 1, transition: 'opacity .4s' }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9ca3af' }}>
        Did you know?
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5, marginTop: 2 }}>{fact}</div>
    </div>
  )
}

function formatInline(text: string): React.ReactNode {
  if (text.indexOf('*') === -1) return text
  var out: React.ReactNode[] = []
  text.split(/\*\*(.+?)\*\*/g).forEach(function(part, i) {
    if (i % 2 === 1) { out.push(<strong key={'b' + i}>{part}</strong>); return }
    // Single-asterisk italics inside the non-bold stretches (Ana wraps
    // verbatim quotes as *"…"* — previously rendered as literal asterisks).
    part.split(/\*([^*\n]+)\*/g).forEach(function(p, j) {
      if (j % 2 === 1) out.push(<em key={'i' + i + '-' + j}>{p}</em>)
      else if (p) out.push(<span key={'s' + i + '-' + j}>{p}</span>)
    })
  })
  return out
}

// A pipe-table run rendered as a real table. Column alignment mirrors
// lib/anaPdf: a column whose every non-empty body cell is numeric is
// centered — header included — so counts line up under their heading.
var NUMERIC_TABLE_CELL = /^[\s$~≈<>±-]*[\d,.]+[%★*\s]*$/
// Decorations Ana likes to put beside numbers (stars, warning signs) —
// stripped before the numeric test so "⭐ 4.57" still centers as a number.
var CELL_DECOR = /[⭐★☆⚠️🔺🔻]/g

function AnaTable({ lines }: { lines: string[] }) {
  var rows = lines
    .map(function(l) { return l.trim().replace(/^\||\|$/g, '').split('|').map(function(c) { return c.trim() }) })
    .filter(function(cells) { return !cells.every(function(c) { return /^:?-{2,}:?$/.test(c) || c === '' }) })
  if (rows.length === 0) return null
  var header = rows[0]
  var body = rows.slice(1)
  var numericCol = header.map(function(_, ci) {
    var vals = body.map(function(cells) { return (cells[ci] || '').replace(/\*\*/g, '').replace(CELL_DECOR, '').trim() }).filter(function(c) { return c !== '' })
    return vals.length > 0 && vals.every(function(c) { return NUMERIC_TABLE_CELL.test(c) })
  })
  // Prose columns (long cells) may break anywhere so the table never
  // overflows the narrow panel; short text columns keep words whole.
  var proseCol = header.map(function(_, ci) {
    if (numericCol[ci]) return false
    return body.some(function(cells) { return (cells[ci] || '').length > 40 })
  })
  return (
    <div style={{ overflowX: 'auto', margin: '8px 0' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, lineHeight: 1.45, whiteSpace: 'normal', wordBreak: 'normal' }}>
        <thead>
          <tr>
            {header.map(function(c, ci) {
              return (
                <th key={ci} style={{
                  textAlign: numericCol[ci] ? 'center' : 'left', fontSize: 9.5, fontWeight: 700,
                  letterSpacing: '.05em', textTransform: 'uppercase', color: '#6b7280',
                  borderBottom: '1.5px solid #111', padding: '4px 6px 4px 0', verticalAlign: 'bottom',
                  whiteSpace: numericCol[ci] ? 'nowrap' : 'normal',
                }}>{formatInline(c)}</th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {body.map(function(cells, ri) {
            return (
              <tr key={ri}>
                {header.map(function(_, ci) {
                  return (
                    <td key={ci} style={{
                      borderBottom: '1px solid #e5e7eb', padding: '5px 6px 5px 0', verticalAlign: 'top',
                      ...(numericCol[ci]
                        ? { textAlign: 'center' as const, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' as const }
                        : proseCol[ci] ? { overflowWrap: 'anywhere' as const } : {}),
                    }}>{formatInline(cells[ci] || '')}</td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}


// ── "What Ana remembers" — the visible, editable memory list ────────────────
// Every statement that personalizes Ana, grouped by provenance. Edit and
// delete are instant; nothing outside this list influences her. Deleting is
// deliberately unceremonious — if removal feels heavy, memory feels like a trap.
function MemoryList({ memories, datasetId, onChanged }: {
  memories: MemoryRow[]
  datasetId: string
  onChanged: () => void | Promise<void>
}) {
  var [editingId, setEditingId] = useState<string | null>(null)
  var [draft, setDraft] = useState('')
  var [busy, setBusy] = useState(false)

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true)
    try {
      await fetch('/api/analyst-memory', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, ...body }) })
      await onChanged()
    } catch {}
    setBusy(false)
  }
  async function remove(id: string) {
    setBusy(true)
    try {
      await fetch('/api/analyst-memory', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })
      await onChanged()
    } catch {}
    setBusy(false)
  }

  var groups: { key: string; label: string; color: string; rows: MemoryRow[] }[] = [
    { key: 'interview', label: 'You told me', color: HERMES, rows: [] },
    { key: 'correction', label: 'You corrected me', color: '#0F7173', rows: [] },
    { key: 'observed', label: 'I noticed', color: '#B45309', rows: [] },
  ]
  memories.forEach(function(m) {
    var g = groups.find(function(x) { return x.key === m.source })
    if (g) g.rows.push(m)
  })

  function renderRow(m: MemoryRow) {
    var isEditing = editingId === m.id
    return (
      <div key={m.id} style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 11px',
        border: m.status === 'pending' ? '1px dashed #EBD1A7' : '1px solid #eee',
        background: m.status === 'pending' ? '#FFFBF3' : 'white',
        borderRadius: 10, fontSize: 13, color: '#111827', marginBottom: 6,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {isEditing ? (
            <input
              autoFocus
              value={draft}
              onChange={function(e) { setDraft(e.target.value) }}
              onKeyDown={function(e) {
                if (e.key === 'Enter' && draft.trim()) { void patch(m.id, { statement: draft.trim() }); setEditingId(null) }
                if (e.key === 'Escape') setEditingId(null)
              }}
              onBlur={function() { setEditingId(null) }}
              style={{ width: '100%', fontSize: 16, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontFamily: 'inherit' }}
            />
          ) : (
            <>
              {m.statement}
              <span style={{ display: 'block', fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                {new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {' \u00B7 '}
                {m.dataset_id ? (m.dataset_id === datasetId ? 'this dataset' : 'another dataset') : 'applies across this account'}
                {m.status === 'pending' ? ' \u00B7 pending your confirmation' : ''}
              </span>
            </>
          )}
        </div>
        {!isEditing && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {m.status === 'pending' && (
              <button title="Confirm" disabled={busy} onClick={function() { void patch(m.id, { status: 'active' }) }}
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: '#0F7173', padding: 2, fontFamily: 'inherit' }}>{'\u2713'}</button>
            )}
            <button title="Edit" disabled={busy} onClick={function() { setEditingId(m.id); setDraft(m.statement) }}
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: '#9ca3af', padding: 2, fontFamily: 'inherit' }}>{'\u270E'}</button>
            <button title="Delete" disabled={busy} onClick={function() { void remove(m.id) }}
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: '#9ca3af', padding: 2, fontFamily: 'inherit' }}>{'\u{1F5D1}'}</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, padding: '16px' }}>
        {memories.length === 0 && (
          <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, marginTop: 40, lineHeight: 1.6 }}>
            <div style={{ fontSize: 26, marginBottom: 8 }}>{'\u2B50'}</div>
            Ana hasn&apos;t saved anything yet.<br />
            Tell her how you like to work &mdash; she&apos;ll offer to remember it.
          </div>
        )}
        {groups.map(function(g) {
          if (g.rows.length === 0) return null
          return (
            <div key={g.key} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: g.color, marginBottom: 6 }}>{g.label}</div>
              {g.rows.map(renderRow)}
            </div>
          )
        })}
      </div>
      <div style={{ borderTop: '1px solid #eee', padding: '10px 16px', fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>
        Nothing outside this list personalizes Ana. Memories shape framing, emphasis, and ordering &mdash; never the numbers.
      </div>
    </div>
  )
}
