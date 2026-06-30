'use client'

// app/bots/[id]/questions/QuestionsClient.tsx
// Question Log UI (docs/BOTS.md § 9.x.3 — admin surface).
//
// Two tabs:
//   - All Questions      newest-first, grouped by classification
//   - Unanswered Queue   status=open, oldest-first, status mutation inline
//
// Plus CSV export button. Each row has a "View transcript →" link that
// jumps into the existing /bots/[id]/conversations surface — that's how
// the spec's "By Session" view works (cross-link, not a new tab).
//
// Probe-focus grouping ("By Theme") is deferred until probe-focus
// tagging (§ 9.x.1) ships; classification is the placeholder grouping.

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import TopNav from '@/components/nav/TopNav'
import LottieLoader from '@/components/ui/LottieLoader'

interface Question {
  id: string
  session_id: string
  conversation_id: string | null
  turn_id: string | null
  user_message: string
  language: string | null
  classification: string
  status: 'open' | 'answered' | 'referred' | 'n_a'
  resolved_by: string | null
  resolved_at: string | null
  notes: string | null
  suggested_kb_addition: string | null
  answer_text: string | null
  source: string | null            // 'agent' (live capture) | 'external' (pasted community list)
  external_contact: { name?: string; email?: string; phone?: string } | null
  batch_label: string | null
  created_at: string
  agent_response: string | null   // the assistant reply that followed this question (context for review)
}

type ConvTurn = { role: string; content: string; content_en: string | null; source: string | null }

interface Props {
  botId: string
  botName: string
  botSlug: string
  logoUrl?: string
  orgName?: string
  isAdmin: boolean
  userEmail: string
  fullName?: string
  features?: import('@/lib/types').ModuleFeatures
}

const CLASSIFICATION_STYLES: Record<string, { bg: string; text: string; label: string; desc: string }> = {
  deflect:      { bg: '#ede9fe', text: '#5b21b6', label: 'Deflected',    desc: 'Off-topic or sensitive — the agent chose not to answer.' },
  kb_miss:      { bg: '#fef3c7', text: '#92400e', label: 'KB miss',      desc: 'The knowledge base had no good match for this question.' },
  ai_uncertain: { bg: '#fee2e2', text: '#991b1b', label: 'AI uncertain', desc: 'The agent’s reply matched an "I don’t know" pattern.' },
  external:     { bg: '#e0f2fe', text: '#075985', label: 'External',     desc: 'Pasted from a client-supplied community question list — answered with the agent’s KB.' },
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  open:     { bg: '#fef3c7', text: '#92400e', label: 'Open'     },
  answered: { bg: '#d1fae5', text: '#065f46', label: 'Answered' },
  referred: { bg: '#dbeafe', text: '#1e40af', label: 'Referred' },
  n_a:      { bg: '#f3f4f6', text: '#374151', label: 'N/A'      },
}

const normText = (s: string | null) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()

function formatRelative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60000) return 'just now'
  if (ms < 3600000) return Math.floor(ms / 60000) + ' min ago'
  if (ms < 86400000) return Math.floor(ms / 3600000) + ' h ago'
  const days = Math.floor(ms / 86400000)
  if (days < 30) return days + ' d ago'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function QuestionsClient({
  botId, botName, botSlug, logoUrl, orgName, isAdmin, userEmail, fullName, features,
}: Props) {
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'all' | 'open'>('all')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({})
  const [answerDraft, setAnswerDraft] = useState<Record<string, string>>({})
  const [answeringId, setAnsweringId] = useState<string | null>(null)
  // Full-conversation modal: the question being viewed + its loaded transcript.
  const [convQ, setConvQ] = useState<Question | null>(null)
  const [convTurns, setConvTurns] = useState<ConvTurn[] | null>(null)
  const [convLoading, setConvLoading] = useState(false)
  // Guided Review mode: a snapshot queue of open question ids walked one at a time.
  const [reviewing, setReviewing] = useState(false)
  const [reviewQueue, setReviewQueue] = useState<string[]>([])
  const [reviewIndex, setReviewIndex] = useState(0)
  const [reviewTurns, setReviewTurns] = useState<ConvTurn[] | null>(null)
  const [reviewTurnsLoading, setReviewTurnsLoading] = useState(false)
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftError, setDraftError] = useState(false)
  // Near-duplicate guard: set when the server flags the answer as ~identical to
  // an existing KB chunk; the reviewer chooses replace / add-anyway / cancel.
  const [dupPrompt, setDupPrompt] = useState<{ qId: string; answer: string; duplicate: { chunkId: string; title: string; content: string; similarity: number } } | null>(null)
  // Opt-in: write accepted answers back into the agent's knowledge base (default on
  // for the live capture loop; uncheck for one-off external replies).
  const [writeKb, setWriteKb] = useState(true)
  // Paste-import (external community questions).
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importBatch, setImportBatch] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  async function refreshQuestions() {
    try {
      const d = await fetch('/api/bots/' + botId + '/questions').then(r => r.json())
      if (d?.error) setError(d.error)
      else setQuestions(Array.isArray(d?.questions) ? d.questions : [])
    } catch { setError('Failed to load questions') }
  }

  useEffect(() => {
    refreshQuestions().finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId])

  // Parse a pasted block of external questions: one per line; tab- or
  // comma-separated extra cells become contact info (email/phone detected by
  // pattern, the remaining cell as name).
  function parseImportRows(textBlock: string): { question: string; name?: string; email?: string; phone?: string }[] {
    const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
    const PHONE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/
    return textBlock.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
      const cells = (line.includes('\t') ? line.split('\t') : line.split(',')).map(c => c.trim()).filter(Boolean)
      const question = cells.shift() || ''
      let name: string | undefined, email: string | undefined, phone: string | undefined
      for (const p of cells) {
        if (!email && EMAIL.test(p)) { email = p; continue }
        if (!phone && PHONE.test(p)) { phone = p; continue }
        if (!name) name = p
      }
      return { question, name, email, phone }
    }).filter(r => r.question.length >= 3)
  }

  async function handleImport() {
    const rows = parseImportRows(importText)
    if (rows.length === 0) { setImportMsg('No questions found — put one question per line.'); return }
    setImporting(true); setImportMsg(null)
    try {
      const r = await fetch('/api/bots/' + botId + '/questions/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, batchLabel: importBatch.trim() || undefined }),
      })
      const d = await r.json()
      if (!r.ok) { setImportMsg(d?.error || 'Import failed'); return }
      setImportText(''); setImportBatch(''); setImportOpen(false)
      await refreshQuestions()
    } catch (e: any) { setImportMsg(e?.message || 'Network error') }
    finally { setImporting(false) }
  }

  async function updateQuestion(qId: string, patch: { status?: Question['status']; notes?: string; suggested_kb_addition?: string }) {
    setSavingId(qId)
    try {
      const r = await fetch('/api/bots/' + botId + '/questions/' + qId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const d = await r.json()
      if (d?.question) {
        setQuestions(prev => prev.map(q => q.id === qId ? d.question : q))
      } else if (d?.error) {
        alert('Update failed: ' + d.error)
      }
    } catch (e: any) {
      alert('Update failed: ' + (e?.message || 'network error'))
    } finally {
      setSavingId(null)
    }
  }

  // Answer the question AND feed it into the agent's knowledge base in one call.
  // Idempotent per question — saving again corrects (re-embeds) the same chunk.
  async function saveAnswer(qId: string, answer: string, opts: { force?: boolean; replaceChunkId?: string } = {}) {
    setAnsweringId(qId)
    try {
      const r = await fetch('/api/bots/' + botId + '/questions/' + qId + '/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer, force: opts.force, replaceChunkId: opts.replaceChunkId, writeKb }),
      })
      const d = await r.json()
      if (d?.duplicate) {
        // Near-dup: pause and let the reviewer decide (don't write, don't advance).
        setDupPrompt({ qId, answer, duplicate: d.duplicate })
        return
      }
      if (d?.question) {
        setDupPrompt(null)
        setQuestions(prev => prev.map(q => q.id === qId ? d.question : q))
        setConvQ(prev => prev && prev.id === qId ? d.question : prev)
        // In guided review, a successful save on the current card advances the queue.
        if (reviewing && reviewQueue[reviewIndex] === qId) advanceReview()
      } else if (d?.error) {
        alert('Save failed: ' + d.error)
      }
    } catch (e: any) {
      alert('Save failed: ' + (e?.message || 'network error'))
    } finally {
      setAnsweringId(null)
    }
  }

  // Open the full-conversation modal for a question and load its transcript by
  // session_id (always populated, so this traces back even when the inline
  // agent-reply text-match missed). Reuses the auth-gated transcript endpoint.
  async function openConversation(q: Question) {
    setConvQ(q)
    setConvTurns(null)
    setConvLoading(true)
    try {
      const r = await fetch('/api/bots/' + botId + '/conversations/' + encodeURIComponent(q.session_id))
      const d = await r.json()
      setConvTurns(Array.isArray(d?.turns) ? d.turns : [])
    } catch {
      setConvTurns([])
    } finally {
      setConvLoading(false)
    }
  }

  // ── Guided Review mode ──────────────────────────────────────────────────────
  function startReview() {
    const openIds = questions
      .filter(q => q.status === 'open')
      .sort((a, b) => a.created_at > b.created_at ? -1 : 1)
      .map(q => q.id)
    if (!openIds.length) return
    setReviewQueue(openIds)
    setReviewIndex(0)
    setReviewing(true)
  }
  function advanceReview() {
    setReviewIndex(i => {
      if (i + 1 >= reviewQueue.length) { setReviewing(false); return i }
      return i + 1
    })
  }
  async function reviewAccept(q: Question) {
    if (!q.agent_response) return
    await saveAnswer(q.id, q.agent_response.trim())  // auto-advances on success
  }
  async function reviewSave(q: Question, answer: string) {
    if (!answer.trim()) return
    await saveAnswer(q.id, answer.trim())  // auto-advances on success
  }

  const reviewQ = reviewing ? (questions.find(q => q.id === reviewQueue[reviewIndex]) || null) : null

  // Load the current review question's transcript + AI-drafted answer.
  useEffect(() => {
    if (!reviewing) return
    const qId = reviewQueue[reviewIndex]
    if (!qId) return
    const q = questions.find(x => x.id === qId)
    if (!q) return
    let cancelled = false

    setReviewTurns(null); setReviewTurnsLoading(true)
    fetch('/api/bots/' + botId + '/conversations/' + encodeURIComponent(q.session_id))
      .then(r => r.json())
      .then(d => { if (!cancelled) setReviewTurns(Array.isArray(d?.turns) ? d.turns : []) })
      .catch(() => { if (!cancelled) setReviewTurns([]) })
      .finally(() => { if (!cancelled) setReviewTurnsLoading(false) })

    // AI draft — only when the reviewer hasn't already typed/saved an answer.
    if (answerDraft[qId] === undefined && !q.suggested_kb_addition) {
      setDraftLoading(true); setDraftError(false)
      fetch('/api/bots/' + botId + '/questions/' + qId + '/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentReply: q.agent_response || '' }),
      })
        .then(r => r.json())
        .then(d => { if (!cancelled && d?.draft) setAnswerDraft(prev => prev[qId] !== undefined ? prev : ({ ...prev, [qId]: d.draft })) })
        .catch(() => { if (!cancelled) setDraftError(true) })
        .finally(() => { if (!cancelled) setDraftLoading(false) })
    } else {
      setDraftLoading(false); setDraftError(false)
    }
    return () => { cancelled = true }
  }, [reviewing, reviewIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const open = questions.filter(q => q.status === 'open').length
    const byCls: Record<string, number> = {}
    for (const q of questions) byCls[q.classification] = (byCls[q.classification] || 0) + 1
    return { total: questions.length, open, byCls }
  }, [questions])

  const visible = useMemo(() => {
    if (tab === 'open') {
      // Newest-first, matching the All tab (was oldest-first FIFO; owner wants
      // both views ordered the same).
      return questions
        .filter(q => q.status === 'open')
        .sort((a, b) => a.created_at > b.created_at ? -1 : 1)
    }
    return questions
  }, [questions, tab])

  // Derived answer-state for the open conversation modal (mirrors the inline card).
  const mAns = convQ ? (answerDraft[convQ.id] ?? (convQ.suggested_kb_addition || '')) : ''
  const mDirty = convQ ? mAns !== (convQ.suggested_kb_addition || '') : false
  const mHasKb = convQ ? !!convQ.suggested_kb_addition : false

  // Chat-bubble transcript (shared by the modal + the review overlay); the logged
  // question's turn is highlighted, greeting preamble hidden.
  const renderTranscript = (turns: ConvTurn[], questionText: string) =>
    turns.filter(t => t.source !== 'greeting').map((t, i) => {
      const isUser = t.role === 'user'
      const text = t.content_en || t.content || ''
      const isThisQ = isUser && normText(text) === normText(questionText)
      return (
        <div key={i} className={'flex ' + (isUser ? 'justify-end' : 'justify-start')}>
          <div className={'max-w-[82%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ' +
            (isUser
              ? (isThisQ ? 'bg-amber-100 border border-amber-300 text-gray-900' : 'bg-blue-50 text-gray-900')
              : 'bg-white border border-gray-200 text-gray-800')}>
            <div className='text-[10px] uppercase tracking-wide opacity-60 mb-0.5'>{isUser ? 'Visitor' : botName}</div>
            {text}
          </div>
        </div>
      )
    })

  // Review overlay derived answer-state.
  const rAns = reviewQ ? (answerDraft[reviewQ.id] ?? (reviewQ.suggested_kb_addition || '')) : ''
  const rHasKb = reviewQ ? !!reviewQ.suggested_kb_addition : false

  return (
    <div className='min-h-screen bg-gray-50'>
      <TopNav logoUrl={logoUrl} orgName={orgName} isAdmin={isAdmin} userEmail={userEmail} fullName={fullName} currentPage='bots' features={features} />

      <div className='max-w-5xl mx-auto px-4 py-8'>
        <div className='mb-2 text-xs text-gray-500'>
          <Link href='/bots' className='hover:underline'>Agents</Link> / <span className='text-gray-700'>{botName}</span> / Questions
        </div>
        <div className='flex items-end justify-between mb-6 flex-wrap gap-3'>
          <div>
            <h1 className='text-2xl font-semibold text-gray-900'>{botName} — Question Log</h1>
            <p className='text-sm text-gray-600 mt-1'>
              Durable record of user questions the agent couldn’t or didn’t answer.
              {' '}Captured automatically at three signals: deflection, KB miss, AI uncertainty.
            </p>
          </div>
          <div className='flex gap-2 flex-wrap'>
            {counts.open > 0 && (
              <button
                onClick={startReview}
                className='px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700'
              >Review unanswered ({counts.open}) →</button>
            )}
            <button
              onClick={() => { setImportMsg(null); setImportOpen(true) }}
              className='px-3 py-1.5 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700'
              title='Paste a client-supplied list of community questions to answer with this agent.'
            >+ Add questions</button>
            <a
              href={'/api/bots/' + botId + '/questions/export-responses.csv'}
              className='px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-white'
              title='Download external questions with the accepted response and contact info, to send replies back.'
            >Download responses</a>
            <Link
              href={'/bots/' + botId + '/knowledge/health'}
              className='px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-white'
            >KB health</Link>
            <a
              href={'/api/bots/' + botId + '/questions/export.csv'}
              className='px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-white'
            >Export CSV</a>
          </div>
        </div>

        {/* KB opt-in — applies to every answer accepted on this page */}
        <label className='flex items-center gap-2 mb-4 text-sm text-gray-600 select-none w-fit'>
          <input type='checkbox' checked={writeKb} onChange={e => setWriteKb(e.target.checked)} className='rounded' />
          Add accepted answers to {botName}’s knowledge base
          <span className='text-gray-400' title='On: the agent learns each answer (live-capture loop). Off: the answer is recorded (and external Q&A still flows into reports) without teaching the agent — good for one-off replies.'>ⓘ</span>
        </label>

        {importOpen && (
          <div className='fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto' onClick={() => !importing && setImportOpen(false)}>
            <div className='bg-white rounded-xl shadow-xl w-full max-w-2xl mt-12 p-6' onClick={e => e.stopPropagation()}>
              <h2 className='text-lg font-semibold text-gray-900 mb-1'>Add community questions</h2>
              <p className='text-sm text-gray-600 mb-4'>
                One question per line. Optionally add contact info on the same line, separated by a tab or comma
                (e.g. <span className='font-mono text-xs bg-gray-100 px-1 rounded'>Question, Name, email@x.com, 555-123-4567</span>) so you can send a reply back.
                Each becomes an answerable question — draft from {botName}’s knowledge, accept or edit, then download the responses.
              </p>
              <input
                value={importBatch}
                onChange={e => setImportBatch(e.target.value)}
                placeholder='Batch label (optional, e.g. “June town hall submissions”)'
                className='w-full mb-2 px-3 py-2 border border-gray-300 rounded-lg'
                style={{ fontSize: '16px' }}
              />
              <textarea
                value={importText}
                onChange={e => setImportText(e.target.value)}
                rows={10}
                placeholder={'When will the new park open?\nIs there parking near the venue?\tJane Doe\tjane@example.com'}
                className='w-full px-3 py-2 border border-gray-300 rounded-lg font-mono'
                style={{ fontSize: '16px' }}
              />
              {importMsg && <p className='text-sm text-red-600 mt-2'>{importMsg}</p>}
              <div className='flex justify-end gap-2 mt-4'>
                <button onClick={() => setImportOpen(false)} disabled={importing}
                  className='px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50'>Cancel</button>
                <button onClick={handleImport} disabled={importing}
                  className='px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-50'>
                  {importing ? 'Adding…' : 'Add ' + (parseImportRows(importText).length || '') + ' questions'}</button>
              </div>
            </div>
          </div>
        )}

        {/* Summary chips */}
        <div className='flex flex-wrap gap-2 mb-4'>
          <span className='px-2 py-1 rounded-md text-xs font-semibold bg-gray-100 text-gray-700'>
            {counts.total} total
          </span>
          <span className='px-2 py-1 rounded-md text-xs font-semibold' style={{ background: STATUS_STYLES.open.bg, color: STATUS_STYLES.open.text }}>
            {counts.open} open
          </span>
          {Object.entries(counts.byCls).map(([cls, n]) => {
            const s = CLASSIFICATION_STYLES[cls] || { bg: '#f3f4f6', text: '#374151', label: cls, desc: '' }
            return (
              <span key={cls} className='px-2 py-1 rounded-md text-xs font-semibold' style={{ background: s.bg, color: s.text }}>
                {n} {s.label.toLowerCase()}
              </span>
            )
          })}
        </div>

        {/* Tabs */}
        <div className='flex border-b border-gray-200 mb-4'>
          {[
            { key: 'all',  label: 'All questions',   n: counts.total },
            { key: 'open', label: 'Unanswered queue', n: counts.open  },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as 'all' | 'open')}
              className={'px-4 py-2 text-sm font-medium border-b-2 transition-colors ' +
                (tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-600 hover:text-gray-900')}
            >
              {t.label} <span className='text-xs text-gray-400 ml-1'>({t.n})</span>
            </button>
          ))}
        </div>

        {loading && <div className='flex justify-center py-16'><LottieLoader size={64} /></div>}
        {error && <div className='bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm'>{error}</div>}

        {!loading && !error && visible.length === 0 && (
          <div className='bg-white border border-dashed border-gray-300 rounded-lg p-10 text-center text-gray-500'>
            <div className='text-sm'>
              {tab === 'open' ? 'No open questions — you’re caught up.' : 'No logged questions yet.'}
            </div>
            <div className='text-xs mt-2'>
              Questions are captured automatically when the agent deflects, misses the KB, or replies with uncertainty.
            </div>
          </div>
        )}

        {!loading && !error && visible.length > 0 && (
          <div className='bg-white border border-gray-200 rounded-lg divide-y divide-gray-200'>
            {visible.map(q => {
              const cls = CLASSIFICATION_STYLES[q.classification] || { bg: '#f3f4f6', text: '#374151', label: q.classification, desc: '' }
              const st = STATUS_STYLES[q.status] || { bg: '#f3f4f6', text: '#374151', label: q.status }
              const noteDraft = notesDraft[q.id] ?? (q.notes || '')
              const noteDirty = noteDraft !== (q.notes || '')
              const ansDraft = answerDraft[q.id] ?? (q.suggested_kb_addition || '')
              const ansDirty = ansDraft !== (q.suggested_kb_addition || '')
              const hasKb = !!q.suggested_kb_addition
              return (
                <div key={q.id} className='p-4'>
                  <div className='flex items-start gap-3 flex-wrap'>
                    <span className='px-2 py-0.5 rounded-md text-xs font-semibold whitespace-nowrap' style={{ background: cls.bg, color: cls.text }} title={cls.desc}>
                      {cls.label}
                    </span>
                    <span className='px-2 py-0.5 rounded-md text-xs font-semibold whitespace-nowrap' style={{ background: st.bg, color: st.text }}>
                      {st.label}
                    </span>
                    {hasKb && (
                      <span className='px-2 py-0.5 rounded-md text-xs font-semibold whitespace-nowrap' style={{ background: '#d1fae5', color: '#065f46' }} title='This answer is in the agent knowledge base and the agent can use it.'>
                        ✓ In knowledge base
                      </span>
                    )}
                    {q.language && (
                      <span className='px-2 py-0.5 rounded-md text-xs font-medium text-gray-600 bg-gray-100 uppercase'>{q.language}</span>
                    )}
                    <div className='flex-1 min-w-0'>
                      <div className='text-sm text-gray-900 whitespace-pre-wrap break-words'>{q.user_message}</div>
                      {q.source === 'external' && q.external_contact && (q.external_contact.name || q.external_contact.email || q.external_contact.phone) && (
                        <div className='text-xs text-sky-700 mt-1'>
                          ✉ {[q.external_contact.name, q.external_contact.email, q.external_contact.phone].filter(Boolean).join(' · ')}
                          {q.batch_label ? <span className='text-gray-400'> · {q.batch_label}</span> : null}
                        </div>
                      )}
                      <div className='text-xs text-gray-500 mt-1'>
                        {formatRelative(q.created_at)} ·{' '}
                        <span title={new Date(q.created_at).toLocaleString()}>{new Date(q.created_at).toLocaleString()}</span>
                        {' · '}
                        <Link href={'/bots/' + botId + '/conversations'} className='text-blue-700 hover:underline' title={'Session ' + q.session_id}>
                          session {q.session_id.slice(-8)}
                        </Link>
                        {' · '}
                        <button onClick={() => openConversation(q)} className='text-blue-700 hover:underline font-medium'>
                          💬 View full conversation
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* What the agent actually replied — context for what to correct,
                      and a one-click "accept this as the answer" into the KB. */}
                  {q.agent_response && (
                    <div className='mt-3'>
                      <div className='text-xs font-medium text-gray-500 mb-1'>{botName} replied:</div>
                      <div className='text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-md p-2 whitespace-pre-wrap break-words max-h-40 overflow-auto'>{q.agent_response}</div>
                      <div className='mt-1 flex gap-2 flex-wrap'>
                        <button
                          disabled={answeringId === q.id}
                          onClick={() => saveAnswer(q.id, (q.agent_response || '').trim())}
                          className='px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium hover:bg-emerald-100 disabled:opacity-50'
                          title={'Accept this reply as-is and add it to ' + botName + "'s knowledge base."}
                        >✓ Accept {botName}&apos;s reply as the answer</button>
                        <button
                          onClick={() => setAnswerDraft(prev => ({ ...prev, [q.id]: (q.agent_response || '') }))}
                          className='px-2 py-1 rounded-md bg-white text-gray-700 border border-gray-300 text-xs font-medium hover:bg-gray-50'
                          title={'Copy ' + botName + "'s reply into the answer box so you can tweak it."}
                        >✏️ Edit this reply</button>
                      </div>
                    </div>
                  )}

                  {/* Status mutation row */}
                  <div className='mt-3 flex items-center gap-2 text-xs flex-wrap'>
                    <span className='text-gray-500'>Mark as:</span>
                    {(['open', 'answered', 'referred', 'n_a'] as Question['status'][]).map(s => (
                      <button
                        key={s}
                        disabled={savingId === q.id || q.status === s}
                        onClick={() => updateQuestion(q.id, { status: s })}
                        className={'px-2 py-1 rounded-md font-medium transition-colors ' +
                          (q.status === s
                            ? 'bg-gray-200 text-gray-500 cursor-default'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}
                      >
                        {STATUS_STYLES[s].label}
                      </button>
                    ))}
                    {savingId === q.id && <span className='text-gray-400'>saving…</span>}
                  </div>

                  {/* Answer → feeds the agent's knowledge base (correction loop) */}
                  <div className='mt-3'>
                    <label className='block text-xs font-medium text-gray-600 mb-1'>
                      {hasKb ? 'Correct the answer (re-trains the agent)' : 'Answer this — the agent learns it for next time'}
                    </label>
                    <textarea
                      value={ansDraft}
                      onChange={e => setAnswerDraft(prev => ({ ...prev, [q.id]: e.target.value }))}
                      placeholder='Type the answer the agent should give next time…'
                      style={{ fontSize: '16px' }}
                      className='w-full border border-gray-200 rounded-md p-2 resize-y min-h-[56px] focus:outline-none focus:border-emerald-400'
                    />
                    <div className='mt-1 flex gap-2 items-center'>
                      <button
                        disabled={answeringId === q.id || !ansDraft.trim() || (hasKb && !ansDirty)}
                        onClick={() => saveAnswer(q.id, ansDraft.trim())}
                        className='px-2 py-1 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50'
                      >{answeringId === q.id ? 'Saving…' : hasKb ? 'Update knowledge' : 'Save answer & add to knowledge'}</button>
                      {ansDirty && hasKb && (
                        <button
                          onClick={() => setAnswerDraft(prev => ({ ...prev, [q.id]: q.suggested_kb_addition || '' }))}
                          className='px-2 py-1 rounded-md bg-gray-100 text-gray-700 text-xs font-medium hover:bg-gray-200'
                        >Cancel</button>
                      )}
                      {answeringId === q.id && <span className='text-xs text-gray-400'>adding to knowledge…</span>}
                    </div>
                  </div>

                  {/* Notes */}
                  <div className='mt-3'>
                    <textarea
                      value={noteDraft}
                      onChange={e => setNotesDraft(prev => ({ ...prev, [q.id]: e.target.value }))}
                      placeholder='Notes (optional) — what was the follow-up? Who handled it?'
                      className='w-full text-xs border border-gray-200 rounded-md p-2 resize-y min-h-[40px] focus:outline-none focus:border-blue-400'
                    />
                    {noteDirty && (
                      <div className='mt-1 flex gap-2'>
                        <button
                          disabled={savingId === q.id}
                          onClick={() => updateQuestion(q.id, { notes: noteDraft })}
                          className='px-2 py-1 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50'
                        >Save notes</button>
                        <button
                          onClick={() => setNotesDraft(prev => ({ ...prev, [q.id]: q.notes || '' }))}
                          className='px-2 py-1 rounded-md bg-gray-100 text-gray-700 text-xs font-medium hover:bg-gray-200'
                        >Cancel</button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <p className='mt-6 text-xs text-gray-500'>
          Captured fire-and-forget from <code className='text-gray-700'>lib/chatCore.ts</code>. Showing up to 1,000 most-recent questions.
          {' '}CSV export redacts emails, phones, and street addresses by default.
        </p>
      </div>

      {/* Full-conversation modal — see the whole chat for context, then answer or
          accept the agent's reply without leaving the page. */}
      {convQ && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4' onClick={() => setConvQ(null)}>
          <div className='bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col' onClick={e => e.stopPropagation()}>
            {/* header */}
            <div className='p-4 border-b border-gray-200 flex items-start justify-between gap-3'>
              <div className='min-w-0'>
                <div className='text-xs text-gray-500'>Full conversation · session {convQ.session_id.slice(-8)}</div>
                <div className='text-sm font-medium text-gray-900 mt-1 break-words'>{convQ.user_message}</div>
              </div>
              <button onClick={() => setConvQ(null)} className='text-gray-400 hover:text-gray-700 text-2xl leading-none shrink-0' aria-label='Close'>&times;</button>
            </div>

            {/* transcript */}
            <div className='flex-1 overflow-auto p-4 space-y-2 bg-gray-50'>
              {convLoading && <div className='py-8 text-center'><LottieLoader message='Loading conversation…' /></div>}
              {!convLoading && convTurns && convTurns.length === 0 && (
                <div className='text-sm text-gray-500 text-center py-8'>No transcript found for this session.</div>
              )}
              {!convLoading && convTurns && renderTranscript(convTurns, convQ.user_message)}
            </div>

            {/* action footer — answer or accept, with full context above */}
            <div className='p-4 border-t border-gray-200 bg-white'>
              {convQ.agent_response && (
                <button
                  disabled={answeringId === convQ.id}
                  onClick={() => saveAnswer(convQ.id, (convQ.agent_response || '').trim())}
                  className='mb-2 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium hover:bg-emerald-100 disabled:opacity-50'
                >✓ Accept {botName}&apos;s reply as the answer</button>
              )}
              <label className='block text-xs font-medium text-gray-600 mb-1'>
                {mHasKb ? 'Correct the answer (re-trains the agent)' : 'Answer this — the agent learns it for next time'}
              </label>
              <textarea
                value={mAns}
                onChange={e => convQ && setAnswerDraft(prev => ({ ...prev, [convQ.id]: e.target.value }))}
                placeholder='Type the answer the agent should give next time…'
                style={{ fontSize: '16px' }}
                className='w-full border border-gray-200 rounded-md p-2 resize-y min-h-[64px] focus:outline-none focus:border-emerald-400'
              />
              <div className='mt-2 flex gap-2 items-center'>
                <button
                  disabled={answeringId === convQ.id || !mAns.trim() || (mHasKb && !mDirty)}
                  onClick={() => saveAnswer(convQ.id, mAns.trim())}
                  className='px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50'
                >{answeringId === convQ.id ? 'Saving…' : mHasKb ? 'Update knowledge' : 'Save answer & add to knowledge'}</button>
                {mHasKb && <span className='text-xs text-emerald-700 font-medium'>✓ In knowledge base</span>}
                <button onClick={() => setConvQ(null)} className='ml-auto px-3 py-1.5 rounded-md bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200'>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Guided Review mode — one unanswered question at a time, conversation on
          screen, an AI-drafted answer prefilled. Accept the agent's reply, save
          a (drafted/edited) answer, or skip — each advances the queue. */}
      {reviewing && reviewQ && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'>
          <div className='bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col'>
            {/* header + progress */}
            <div className='p-4 border-b border-gray-200 flex items-center justify-between gap-3'>
              <div>
                <div className='text-sm font-semibold text-gray-900'>Review unanswered</div>
                <div className='text-xs text-gray-500 mt-0.5'>{reviewIndex + 1} of {reviewQueue.length}</div>
              </div>
              <button onClick={() => setReviewing(false)} className='text-gray-400 hover:text-gray-700 text-2xl leading-none' aria-label='Exit review'>&times;</button>
            </div>

            {/* conversation context */}
            <div className='flex-1 overflow-auto p-4 space-y-2 bg-gray-50'>
              {reviewTurnsLoading && <div className='py-6 text-center'><LottieLoader message='Loading conversation…' /></div>}
              {!reviewTurnsLoading && reviewTurns && reviewTurns.length === 0 && (
                <div className='text-sm text-gray-500 text-center py-4'>No transcript found — answer from the question above.</div>
              )}
              {!reviewTurnsLoading && reviewTurns && renderTranscript(reviewTurns, reviewQ.user_message)}
            </div>

            {/* answer + actions */}
            <div className='p-4 border-t border-gray-200 bg-white'>
              <div className='flex items-center justify-between gap-2 mb-1'>
                <label className='text-xs font-medium text-gray-600'>
                  What should {botName} say next time?
                  {draftLoading && <span className='ml-2 text-emerald-700'>✨ drafting…</span>}
                  {draftError && <span className='ml-2 text-amber-600'>couldn’t draft — type your own</span>}
                  {!draftLoading && !draftError && !rHasKb && answerDraft[reviewQ.id] !== undefined && <span className='ml-2 text-gray-400'>AI draft — review &amp; edit before saving</span>}
                </label>
                {reviewQ.agent_response && (
                  <button
                    onClick={() => setAnswerDraft(prev => ({ ...prev, [reviewQ.id]: (reviewQ.agent_response || '') }))}
                    className='text-xs text-gray-600 hover:text-gray-900 underline shrink-0'
                    title={'Start from ' + botName + "'s own reply instead of the AI draft."}
                  >✏️ Start from {botName}&apos;s reply</button>
                )}
              </div>
              <textarea
                value={rAns}
                onChange={e => setAnswerDraft(prev => ({ ...prev, [reviewQ.id]: e.target.value }))}
                placeholder={draftLoading ? 'Drafting a suggested answer…' : 'Type the answer the agent should give next time…'}
                style={{ fontSize: '16px' }}
                className='w-full border border-gray-200 rounded-md p-2 resize-y min-h-[90px] focus:outline-none focus:border-emerald-400'
              />
              <div className='mt-3 flex items-center gap-2 flex-wrap'>
                <button
                  disabled={answeringId === reviewQ.id || !rAns.trim()}
                  onClick={() => reviewSave(reviewQ, rAns)}
                  className='px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50'
                >{answeringId === reviewQ.id ? 'Saving…' : rHasKb ? 'Update & next →' : 'Save answer & next →'}</button>
                {reviewQ.agent_response && (
                  <button
                    disabled={answeringId === reviewQ.id}
                    onClick={() => reviewAccept(reviewQ)}
                    className='px-3 py-1.5 rounded-md bg-white border border-emerald-300 text-emerald-700 text-sm font-medium hover:bg-emerald-50 disabled:opacity-50'
                    title={'Accept ' + botName + "'s own reply (shown above) as the answer."}
                  >✓ Accept {botName}&apos;s reply</button>
                )}
                <button
                  onClick={advanceReview}
                  className='ml-auto px-3 py-1.5 rounded-md bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200'
                >Skip →</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Near-duplicate guard — keeps the KB tight by catching ~identical answers
          before they pile up. Sits above the review overlay (z-60). */}
      {dupPrompt && (
        <div className='fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4' onClick={() => setDupPrompt(null)}>
          <div className='bg-white rounded-lg shadow-xl max-w-md w-full p-4' onClick={e => e.stopPropagation()}>
            <div className='text-sm font-semibold text-gray-900'>Similar answer already exists</div>
            <p className='text-xs text-gray-600 mt-1'>
              This is <span className='font-semibold'>{dupPrompt.duplicate.similarity}%</span> similar to an answer already in {botName}&apos;s knowledge base:
            </p>
            <div className='mt-2 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-md p-2 max-h-36 overflow-auto whitespace-pre-wrap break-words'>{dupPrompt.duplicate.content}</div>
            <div className='mt-3 flex gap-2 flex-wrap'>
              <button
                onClick={() => { const dp = dupPrompt; setDupPrompt(null); saveAnswer(dp.qId, dp.answer, { replaceChunkId: dp.duplicate.chunkId }) }}
                className='px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700'
                title='Overwrite the existing answer with this one (keeps the KB to one entry).'
              >Replace existing</button>
              <button
                onClick={() => { const dp = dupPrompt; setDupPrompt(null); saveAnswer(dp.qId, dp.answer, { force: true }) }}
                className='px-3 py-1.5 rounded-md bg-white border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50'
                title='Keep both — add this as a separate knowledge entry.'
              >Add as separate</button>
              <button onClick={() => setDupPrompt(null)} className='ml-auto px-3 py-1.5 rounded-md bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200'>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
