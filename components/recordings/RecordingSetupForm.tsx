'use client'

// components/recordings/RecordingSetupForm.tsx
//
// Unified Town Hall Setup editor (§ 5.2 / edit-anytime). ONE form, two modes:
//
//   mode='create'  →  /recordings/new. POSTs /api/recordings with no files,
//                     creating the project in 'awaiting_media'; media is added
//                     later on the status page. Shows brand/agent + ASR controls.
//   mode='edit'    →  /recordings/[id]/setup, reachable at ANY lifecycle stage.
//                     PATCHes /api/recordings/[id] with the editable setup fields
//                     and stays put. Brand/agent live in the report's Export tab
//                     and ASR is fixed once processing starts, so both are hidden.
//
// setup_inputs / meeting_profile are analysis-shaping: saving them does NOT
// re-extract. The report's drift banner (Phase 4) prompts a re-analyze.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import LottieLoader from '@/components/ui/LottieLoader'
import { createClient } from '@/lib/supabase/client'
import { tusUpload } from '@/lib/recordings/tusUpload'
import { defaultProfile, PRESET_LABELS } from '@/lib/recordings/profiles'
import type { MeetingPresetId, Analyst, ConfidentialityClass, SetupProvenance, AsrStrategy } from '@/lib/recordings/types'

const HERMES = '#E8632A'

// Read a fetch Response as JSON, but degrade gracefully when the server (or the
// Vercel proxy) returns non-JSON — e.g. a plain-text "Request Entity Too Large".
// Without this the browser throws `Unexpected token 'R'…` on res.json().
async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    const snippet = text.trim().slice(0, 120)
    if (res.status === 413 || /request entity too large/i.test(snippet)) {
      throw new Error('That file is too large to upload here. Please try again — if it persists, attach the deck with the recording.')
    }
    throw new Error(snippet || `Request failed (${res.status})`)
  }
}

// Push a PDF straight to Supabase Storage (bypassing Vercel's 4.5MB function body
// limit), via a prepare→TUS→register handshake. `prepareUrl` returns the upload
// target; `register` finalizes once the bytes have landed.
async function uploadPdfDirect(
  file: File,
  prepareUrl: string,
  register: (storagePath: string) => Promise<Response>,
): Promise<Record<string, unknown>> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Could not read your session — try refreshing.')

  const prep = await fetch(prepareUrl)
  const prepJson = await readJson(prep)
  if (!prep.ok) throw new Error((prepJson.error as string) || `couldn't prepare the upload (${prep.status})`)
  const upload = prepJson.upload as { endpoint: string; bucket: string }
  const storagePath = prepJson.storage_path as string

  await tusUpload({
    file,
    storagePath,
    endpoint: upload.endpoint,
    bucket: upload.bucket,
    sessionJwt: session.access_token,
    contentType: file.type || 'application/octet-stream',
  })

  const res = await register(storagePath)
  const json = await readJson(res)
  if (!res.ok) throw new Error((json.error as string) || `the document couldn't be read (${res.status})`)
  return json
}

type SessionType = 'qa'

// Mirror of lib/recordings/setupExtract SetupProposal (that module is server-only).
interface SetupProposal {
  objectives: { summary: string; questions: string[] }
  agenda: string[]
  panel: Array<{ name: string; role?: string }>
  glossary: string[]
}

export interface AgentOption { id: string; name: string }
export interface MemberOption { id: string; name: string }

// A document persisted to the project (edit mode): the presentation deck
// (file_role='slides', vision-read) or a brief/reference (file_role='document').
export interface AttachedDoc {
  id: string
  original_filename: string
  mime_type: string
  size_bytes: number
  file_role: 'slides' | 'document'
}

// Initial values for edit mode (create mode falls back to the defaults below).
export interface RecordingSetupInitial {
  name: string
  preset: MeetingPresetId
  meetingDate: string            // yyyy-mm-dd or ''
  location: string
  language: string
  panel: Array<{ name: string; role: string }>
  agenda: string[]
  glossary: string               // newline-joined
  objectivesSummary: string
  objectivesQuestions: string    // newline-joined
  analysisOrg: string
  analysts: string[]
  confidentiality: ConfidentialityClass
  brandTag: string
  underlyingAgentId: string
  asrStrategy: AsrStrategy
  documents: AttachedDoc[]        // edit mode — docs already attached to the project
}

const CONFIDENTIALITY_LABELS: Record<ConfidentialityClass, string> = {
  client_confidential: 'Client confidential',
  internal: 'Internal',
  restricted: 'Restricted',
  public: 'Public',
}

export default function RecordingSetupForm({
  mode, recordingId, agents = [], members = [], initial, configDrifted = false,
}: {
  mode: 'create' | 'edit'
  recordingId?: string
  agents?: AgentOption[]
  members?: MemberOption[]
  initial?: Partial<RecordingSetupInitial>
  configDrifted?: boolean   // edit mode — analysis-shaping setup changed since the last analysis
}) {
  const router = useRouter()
  const isEdit = mode === 'edit'

  // ── Setup form ────────────────────────────────────────────────────────────
  const [name, setName] = useState(initial?.name ?? '')
  const meetingDateDefault = new Date().toISOString().slice(0, 10)
  const [meetingDate, setMeetingDate] = useState(initial?.meetingDate ?? (isEdit ? '' : meetingDateDefault))
  const [location, setLocation] = useState(initial?.location ?? '')
  const [language, setLanguage] = useState(initial?.language ?? 'en')
  const [asrStrategy, setAsrStrategy] = useState<AsrStrategy>(initial?.asrStrategy ?? 'auto')
  const sessionType: SessionType = 'qa'
  const [preset, setPreset] = useState<MeetingPresetId>(initial?.preset ?? 'town_hall_qa')

  // Q&A-specific
  const [panel, setPanel] = useState<Array<{ name: string; role: string }>>(
    initial?.panel?.length ? initial.panel : [{ name: '', role: '' }],
  )
  const [agenda, setAgenda] = useState<string[]>(initial?.agenda?.length ? initial.agenda : [''])
  const [glossary, setGlossary] = useState(initial?.glossary ?? '')
  const [brandTag, setBrandTag] = useState(initial?.brandTag ?? '')
  const [underlyingAgentId, setUnderlyingAgentId] = useState(initial?.underlyingAgentId ?? '')

  // Objectives (§2.8) — what we want this analysis to answer.
  const [objectivesSummary, setObjectivesSummary] = useState(initial?.objectivesSummary ?? '')
  const [objectivesQuestions, setObjectivesQuestions] = useState(initial?.objectivesQuestions ?? '')   // one per line

  // Analysis attribution (§2.8)
  const [analysisOrg, setAnalysisOrg] = useState(initial?.analysisOrg ?? 'Datanautix')
  const [analysts, setAnalysts] = useState<string[]>(initial?.analysts?.length ? initial.analysts : [''])
  const [confidentiality, setConfidentiality] = useState<ConfidentialityClass>(initial?.confidentiality ?? 'client_confidential')

  // ── Project documents (optional, §2.8 doc-ingest) ───────────────────────────
  const [docBusy, setDocBusy] = useState(false)
  const [docError, setDocError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<{ proposal: SetupProposal; source: string } | null>(null)
  const [provenance, setProvenance] = useState<SetupProvenance>({})
  // Edit mode — docs persisted to the project (deck + briefs). Create mode can't
  // persist (no recording yet), so it only pre-fills; the deck attaches later.
  const [documents, setDocuments] = useState<AttachedDoc[]>(initial?.documents ?? [])
  const [attachBusy, setAttachBusy] = useState(false)

  // ── Submit state ──────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // ── Derived ───────────────────────────────────────────────────────────────
  const cleanedPanel = useMemo(
    () => panel.map(p => ({ name: p.name.trim(), role: p.role.trim() })).filter(p => p.name),
    [panel],
  )
  const cleanedAgenda = useMemo(() => agenda.map(a => a.trim()).filter(Boolean), [agenda])
  const cleanedGlossary = useMemo(() => glossary.split('\n').map(s => s.trim()).filter(Boolean), [glossary])
  const cleanedQuestions = useMemo(() => objectivesQuestions.split('\n').map(s => s.trim()).filter(Boolean), [objectivesQuestions])
  const cleanedAnalysts = useMemo<Analyst[]>(() => {
    const byName = new Map(members.map(m => [m.name.trim().toLowerCase(), m.id]))
    return analysts
      .map(n => n.trim())
      .filter(Boolean)
      .map(n => { const id = byName.get(n.toLowerCase()); return id ? { name: n, member_id: id } : { name: n } })
  }, [analysts, members])
  // Create needs a starter agenda topic (steers the first analysis); edit can save
  // any field change, so it only requires a name.
  const canSubmit = !busy && name.trim().length > 0 && (isEdit || cleanedAgenda.length > 0)

  // ── Project documents: read a deck → propose setup fields ───────────────────
  const handleDoc = async (file: File) => {
    setDocError(null); setSuggestion(null); setDocBusy(true)
    try {
      const json = await uploadPdfDirect(
        file,
        '/api/recordings/extract-setup',
        (storagePath) => fetch('/api/recordings/extract-setup', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ storage_path: storagePath, source: file.name }),
        }),
      )
      setSuggestion({ proposal: json.proposal as SetupProposal, source: json.source as string })
    } catch (e) {
      setDocError(e instanceof Error ? e.message : 'Document read failed')
    } finally {
      setDocBusy(false)
    }
  }

  // Apply suggestions into EMPTY fields only (non-destructive); record provenance.
  const applySuggestion = () => {
    if (!suggestion) return
    const p = suggestion.proposal
    const src = suggestion.source
    const prov: SetupProvenance = {}
    if (!objectivesSummary.trim() && p.objectives.summary) { setObjectivesSummary(p.objectives.summary); prov.objectives = src }
    if (!objectivesQuestions.trim() && p.objectives.questions.length) { setObjectivesQuestions(p.objectives.questions.join('\n')); prov.objectives = src }
    if (cleanedAgenda.length === 0 && p.agenda.length) { setAgenda(p.agenda); prov.agenda = src }
    if (cleanedPanel.length === 0 && p.panel.length) { setPanel(p.panel.map(x => ({ name: x.name, role: x.role || '' }))); prov.panel = src }
    if (cleanedGlossary.length === 0 && p.glossary.length) { setGlossary(p.glossary.join('\n')); prov.glossary = src }
    setProvenance(prev => ({ ...prev, ...prov }))
    setSuggestion(null)
  }

  // ── Persist a document to the project (edit mode only) ──────────────────────
  // role='slides' → the deck (PDF, vision-read by the pipeline) + also runs the
  // pre-fill pass. role='document' → a brief/reference, stored only.
  const attachDoc = async (file: File, role: 'slides' | 'document') => {
    setDocError(null); setAttachBusy(true)
    try {
      const json = await uploadPdfDirect(
        file,
        `/api/recordings/${recordingId}/documents?role=${role}&name=${encodeURIComponent(file.name)}`,
        (storagePath) => fetch(`/api/recordings/${recordingId}/documents`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ storage_path: storagePath, original_filename: file.name, role, mime_type: file.type || 'application/pdf', size_bytes: file.size }),
        }),
      )
      const added = json.file as AttachedDoc
      // slides is at-most-one — replace any existing deck in the list.
      setDocuments(prev => [...(role === 'slides' ? prev.filter(d => d.file_role !== 'slides') : prev), added])
      if (role === 'slides') await handleDoc(file)   // deck → also propose setup fields
    } catch (e) {
      setDocError(e instanceof Error ? e.message : 'Attach failed')
    } finally {
      setAttachBusy(false)
    }
  }

  const removeDoc = async (fileId: string) => {
    setDocError(null)
    try {
      const r = await fetch(`/api/recordings/${recordingId}/documents/${fileId}`, { method: 'DELETE' })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `remove failed (${r.status})`) }
      setDocuments(prev => prev.filter(d => d.id !== fileId))
    } catch (e) {
      setDocError(e instanceof Error ? e.message : 'Remove failed')
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setSubmitError(null); setSaved(false)
    setBusy(true)

    const meeting_profile = preset === 'community_meeting'
      ? { ...defaultProfile('community_meeting'), has_slides: false }   // deck (if any) attached with the recording
      : null

    const objectives = (objectivesSummary.trim() || cleanedQuestions.length > 0)
      ? { summary: objectivesSummary.trim(), questions: cleanedQuestions }
      : null

    const setup_inputs = {
      panel: cleanedPanel,
      agenda: cleanedAgenda,
      ...(cleanedGlossary.length > 0 ? { glossary: cleanedGlossary } : {}),
    }

    if (isEdit) {
      // Edit mode — PATCH the editable subset and stay. Brand/agent + ASR are
      // owned elsewhere (report Export tab / fixed at processing), so omitted.
      const body = {
        name: name.trim(),
        meeting_date: meetingDate || null,
        location: location.trim() || null,
        language,
        setup_inputs,
        meeting_profile,
        analysis_org: analysisOrg.trim() || null,
        analysts: cleanedAnalysts,
        objectives,
        confidentiality_class: confidentiality,
      }
      try {
        const r = await fetch(`/api/recordings/${recordingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = await r.json()
        if (!r.ok) throw new Error(json.error || `save failed: ${r.status}`)
        setSaved(true)
        router.refresh()
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Save failed')
      } finally {
        setBusy(false)
      }
      return
    }

    // Create mode — POST without files → 'awaiting_media' → status page.
    const body = {
      name: name.trim(),
      session_type: sessionType,
      meeting_date: meetingDate || null,
      location: location.trim() || null,
      language,
      setup_inputs,
      asr_strategy: asrStrategy,
      meeting_profile,
      brand_tag: brandTag.trim() || null,
      underlying_agent_id: underlyingAgentId || null,
      analysis_org: analysisOrg.trim() || null,
      analysts: cleanedAnalysts,
      objectives,
      confidentiality_class: confidentiality,
      setup_provenance: provenance,
      // No files — setup-before-media. Media is attached on the status page.
    }

    try {
      const r = await fetch('/api/recordings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await r.json()
      if (!r.ok) throw new Error(json.error || `create failed: ${r.status}`)
      router.push(`/recordings/${json.recording_id}/status`)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Create failed')
      setBusy(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <header>
        <Link
          href={isEdit ? `/recordings/${recordingId}/status` : '/recordings'}
          className="text-xs text-gray-500 hover:text-gray-700"
        >← {isEdit ? 'Back to project' : 'Town Hall'}</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">{isEdit ? 'Edit setup' : 'New Town Hall'}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {isEdit
            ? 'Update the project details. Changes to the agenda, panel, names, or objectives shape the analysis — re-run it afterward to apply them.'
            : 'Set up the project now — you can add the meeting audio or video later, once it’s available.'}
        </p>
      </header>

      {isEdit && configDrifted && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-amber-900">This setup differs from the last analysis</h3>
            <p className="text-xs text-amber-800 mt-0.5">
              Your changes to the agenda, panel, names, meeting profile, or objectives are saved, but the report still
              reflects the previous analysis. Open the report and re-analyze to apply them.
            </p>
          </div>
          <Link href={`/recordings/${recordingId}/report`}
            className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold text-white" style={{ backgroundColor: HERMES }}>
            Open report →
          </Link>
        </div>
      )}

      {/* Project documents — read the deck to pre-fill setup (optional) */}
      <section className="bg-white border border-gray-200 rounded-2xl p-5">
        <h2 className="font-semibold text-gray-900 text-sm">Project documents <span className="font-normal text-gray-400">(optional)</span></h2>
        {isEdit ? (
          <>
            <p className="text-xs text-gray-500 mt-1 mb-3">
              Attach the presentation deck (PDF) and any briefs or agendas. The deck is vision-read into the meeting
              overview when you run the analysis; briefs are kept for reference. Attaching a deck also proposes the
              objectives, agenda, panel, and names below.
            </p>
            {documents.length > 0 && (
              <ul className="mb-3 space-y-1.5">
                {documents.map(d => (
                  <li key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                    <span className="min-w-0 flex items-center gap-2">
                      <span>{d.file_role === 'slides' ? '📊' : '📎'}</span>
                      <span className="truncate text-gray-800">{d.original_filename}</span>
                      <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                        {d.file_role === 'slides' ? 'Presentation deck' : 'Brief'}
                      </span>
                    </span>
                    <button type="button" onClick={() => { void removeDoc(d.id) }} disabled={attachBusy || busy}
                      className="shrink-0 text-gray-400 hover:text-red-500 disabled:opacity-30 px-1" title="Remove">✕</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <label className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-sm cursor-pointer ${(attachBusy || docBusy) ? 'opacity-60 cursor-wait' : 'hover:bg-gray-50'}`}>
                <span>📊 {attachBusy ? 'Attaching…' : 'Attach presentation deck (PDF)'}</span>
                <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={attachBusy || busy}
                  onChange={e => { const f = e.target.files?.[0]; if (f) void attachDoc(f, 'slides'); e.target.value = '' }} />
              </label>
              <label className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-sm cursor-pointer ${attachBusy ? 'opacity-60 cursor-wait' : 'hover:bg-gray-50'}`}>
                <span>📎 Attach a brief / document</span>
                <input type="file" className="hidden" disabled={attachBusy || busy}
                  onChange={e => { const f = e.target.files?.[0]; if (f) void attachDoc(f, 'document'); e.target.value = '' }} />
              </label>
              {(attachBusy || docBusy) && <LottieLoader size={28} />}
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-500 mt-1 mb-3">
              Have the deck that will be presented? Upload it (PDF) and we&apos;ll suggest the objectives, agenda, panel, and key
              names below — you review before saving. The deck itself is attached later, with the recording.
            </p>
            <div className="flex items-center gap-3">
              <label className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-sm cursor-pointer ${docBusy ? 'opacity-60 cursor-wait' : 'hover:bg-gray-50'}`}>
                <span>📄 {docBusy ? 'Reading the deck…' : 'Add a PDF to pre-fill setup'}</span>
                <input
                  type="file" accept="application/pdf,.pdf" className="hidden"
                  disabled={docBusy || busy}
                  onChange={e => { const f = e.target.files?.[0]; if (f) void handleDoc(f); e.target.value = '' }}
                />
              </label>
              {docBusy && <LottieLoader size={28} />}
            </div>
          </>
        )}
        {docError && <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{docError}</div>}
        {suggestion && (
          <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50 p-3">
            <div className="text-sm text-teal-900 font-medium">Suggestions from {suggestion.source}</div>
            <div className="text-xs text-teal-800 mt-1">
              {[
                suggestion.proposal.objectives.summary || suggestion.proposal.objectives.questions.length ? 'objectives' : null,
                suggestion.proposal.agenda.length ? `${suggestion.proposal.agenda.length} agenda topic${suggestion.proposal.agenda.length === 1 ? '' : 's'}` : null,
                suggestion.proposal.panel.length ? `${suggestion.proposal.panel.length} panelist${suggestion.proposal.panel.length === 1 ? '' : 's'}` : null,
                suggestion.proposal.glossary.length ? `${suggestion.proposal.glossary.length} name${suggestion.proposal.glossary.length === 1 ? '' : 's'}` : null,
              ].filter(Boolean).join(' · ') || 'Nothing confidently extracted — fill the form in manually.'}
            </div>
            <p className="text-[11px] text-teal-700 mt-1">Applies only to empty fields, so your edits are never overwritten.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={applySuggestion}
                className="px-3 py-1.5 rounded-md text-xs font-semibold text-white" style={{ backgroundColor: '#0d9488' }}>
                Apply suggestions
              </button>
              <button type="button" onClick={() => setSuggestion(null)}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-teal-800 hover:bg-teal-100">Dismiss</button>
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Meeting details */}
        <section className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
          <h2 className="font-semibold text-gray-900 text-sm">Meeting</h2>

          <Field label="Name">
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="NOWOCATS PM-2" disabled={busy}
              className="w-full border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Meeting type">
              <select value={preset} onChange={e => setPreset(e.target.value as MeetingPresetId)} disabled={busy}
                className="w-full border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }}>
                <option value="town_hall_qa">{PRESET_LABELS.town_hall_qa}</option>
                <option value="community_meeting">{PRESET_LABELS.community_meeting}</option>
              </select>
            </Field>
            <Field label="Meeting date">
              <input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)} disabled={busy}
                className="w-full border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }} />
            </Field>
          </div>

          <Field label="Location (optional)">
            <input type="text" value={location} onChange={e => setLocation(e.target.value)}
              placeholder="Apopka City Hall" disabled={busy}
              className="w-full border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }} />
          </Field>

          <Field label="Panel members" hint={provenance.panel}>
            <div className="space-y-2">
              {panel.map((p, i) => (
                <div key={i} className="flex gap-2">
                  <input type="text" value={p.name}
                    onChange={e => setPanel(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                    placeholder="Name" disabled={busy}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }} />
                  <input type="text" value={p.role}
                    onChange={e => setPanel(prev => prev.map((x, j) => j === i ? { ...x, role: e.target.value } : x))}
                    placeholder="Role" disabled={busy}
                    className="w-32 border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }} />
                  <button type="button" disabled={busy || panel.length === 1}
                    onClick={() => setPanel(prev => prev.filter((_, j) => j !== i))}
                    className="text-gray-400 hover:text-red-500 disabled:opacity-30 px-2">✕</button>
                </div>
              ))}
              <button type="button" disabled={busy}
                onClick={() => setPanel(prev => [...prev, { name: '', role: '' }])}
                className="text-xs text-gray-600 hover:text-orange-600 disabled:opacity-30">+ Add panelist</button>
            </div>
          </Field>

          <Field label="Agenda topics" hint={provenance.agenda}>
            <div className="space-y-2">
              {agenda.map((a, i) => (
                <div key={i} className="flex gap-2">
                  <input type="text" value={a}
                    onChange={e => setAgenda(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                    placeholder={i === 0 ? 'e.g. Project Timeline' : 'Next topic'} disabled={busy}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }} />
                  <button type="button" disabled={busy || agenda.length === 1}
                    onClick={() => setAgenda(prev => prev.filter((_, j) => j !== i))}
                    className="text-gray-400 hover:text-red-500 disabled:opacity-30 px-2">✕</button>
                </div>
              ))}
              <button type="button" disabled={busy}
                onClick={() => setAgenda(prev => [...prev, ''])}
                className="text-xs text-gray-600 hover:text-orange-600 disabled:opacity-30">+ Add topic</button>
            </div>
          </Field>

          <Field label="Names & terms (optional)" hint={provenance.glossary}>
            <p className="text-xs text-gray-500 mb-1.5">
              Correct spellings of names, places, and terms in this meeting — one per line. The transcriber
              often mis-hears proper names; we normalize the report to these spellings.
            </p>
            <textarea value={glossary} onChange={e => setGlossary(e.target.value)}
              placeholder={'NOWOCATS\nKelly Park Road\nHatem Abou-Sayed'} disabled={busy} rows={4}
              className="w-full border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }} />
          </Field>
        </section>

        {/* Objectives + attribution */}
        <section className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
          <h2 className="font-semibold text-gray-900 text-sm">Objectives & analysis</h2>

          <Field label="Objectives (optional)" hint={provenance.objectives}>
            <p className="text-xs text-gray-500 mb-1.5">
              What should this analysis answer? This steers the report&apos;s synthesis. You can
              pre-fill it from the meeting deck or a brief above.
            </p>
            <textarea value={objectivesSummary} onChange={e => setObjectivesSummary(e.target.value)}
              placeholder="e.g. Gauge resident sentiment on the Kelly Park Road realignment and surface the open concerns the panel must address."
              disabled={busy} rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }} />
          </Field>

          <Field label="Questions we want answered (optional, one per line)" hint={provenance.objectives}>
            <textarea value={objectivesQuestions} onChange={e => setObjectivesQuestions(e.target.value)}
              placeholder={'What are the top resident objections?\nHow did the panel address funding concerns?'}
              disabled={busy} rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Analysis performed by">
              <input type="text" value={analysisOrg} onChange={e => setAnalysisOrg(e.target.value)}
                placeholder="Datanautix" disabled={busy}
                className="w-full border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }} />
            </Field>
            <Field label="Confidentiality">
              <select value={confidentiality} onChange={e => setConfidentiality(e.target.value as ConfidentialityClass)} disabled={busy}
                className="w-full border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }}>
                {(['client_confidential', 'internal', 'restricted', 'public'] as ConfidentialityClass[]).map(c => (
                  <option key={c} value={c}>{CONFIDENTIALITY_LABELS[c]}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Analyst(s)">
            <p className="text-xs text-gray-500 mb-1.5">Pick a teammate or type a name.</p>
            <datalist id="org-members">
              {members.map(m => <option key={m.id} value={m.name} />)}
            </datalist>
            <div className="space-y-2">
              {analysts.map((a, i) => (
                <div key={i} className="flex gap-2">
                  <input type="text" list="org-members" value={a}
                    onChange={e => setAnalysts(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                    placeholder="Analyst name" disabled={busy}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }} />
                  <button type="button" disabled={busy || analysts.length === 1}
                    onClick={() => setAnalysts(prev => prev.filter((_, j) => j !== i))}
                    className="text-gray-400 hover:text-red-500 disabled:opacity-30 px-2">✕</button>
                </div>
              ))}
              <button type="button" disabled={busy}
                onClick={() => setAnalysts(prev => [...prev, ''])}
                className="text-xs text-gray-600 hover:text-orange-600 disabled:opacity-30">+ Add analyst</button>
            </div>
          </Field>

          {/* Brand/agent + ASR are create-only. In edit mode the brand/agent link
              lives in the report's Export tab and ASR is fixed once processed. */}
          {!isEdit && (
            <Field label="Brand & known entities (optional)">
              <p className="text-xs text-gray-500 mb-1.5">
                Tag this meeting with a brand and/or link its agent — the meeting then draws on that brand&apos;s
                curated entity catalog to correct spellings automatically, and its data feeds brand-level analysis.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <input value={brandTag} onChange={e => setBrandTag(e.target.value)}
                  placeholder="Brand tag (e.g. NOWOCATS)" disabled={busy}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }} />
                {agents.length > 0 ? (
                  <select value={underlyingAgentId} onChange={e => setUnderlyingAgentId(e.target.value)} disabled={busy}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white" style={{ fontSize: '16px' }}>
                    <option value="">— Link an agent (optional) —</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                ) : (
                  <div className="text-xs text-gray-400 self-center">No agents in this org yet.</div>
                )}
              </div>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Language">
              <select value={language} onChange={e => setLanguage(e.target.value)} disabled={busy}
                className="w-full border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }}>
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="en-es">English + Spanish (code-switching)</option>
              </select>
            </Field>
            {!isEdit && (
              <Field label="ASR strategy">
                <select value={asrStrategy} onChange={e => setAsrStrategy(e.target.value as AsrStrategy)} disabled={busy}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }}>
                  <option value="auto">Let system decide</option>
                  <option value="whisper">Whisper</option>
                  <option value="deepgram">Deepgram</option>
                  <option value="hybrid">Hybrid (high accuracy)</option>
                </select>
              </Field>
            )}
          </div>
        </section>
      </div>

      {submitError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{submitError}</div>
      )}

      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-sm text-green-700">Saved ✓</span>}
        <span className="text-xs text-gray-500">
          {!canSubmit && !busy
            ? (isEdit ? 'Name is required' : 'Name and at least one agenda topic are required')
            : ''}
        </span>
        <button type="button" onClick={() => { void handleSubmit() }} disabled={!canSubmit}
          className="px-6 py-3 rounded-lg text-sm font-semibold text-white disabled:bg-gray-300 disabled:cursor-not-allowed"
          style={{ backgroundColor: canSubmit ? HERMES : undefined }}>
          {busy ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save setup' : 'Create project')}
        </button>
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="flex items-baseline gap-2 mb-1">
        <span className="text-xs font-semibold text-gray-600">{label}</span>
        {hint && <span className="text-[11px] text-teal-600">✨ from {hint}</span>}
      </span>
      {children}
    </label>
  )
}
