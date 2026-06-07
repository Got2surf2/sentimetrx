'use client'

// app/recordings/new/RecordingWizardClient.tsx
//
// Setup-before-media (§ 5.2). This screen sets up the Town Hall PROJECT — name,
// meeting details, panel/agenda, objectives, analysis attribution — WITHOUT the
// audio/video. It creates the recording in 'awaiting_media' and hands off to the
// status page, where "Add recording" (AddRecordingClient) attaches the media
// later and starts the pipeline.
//
//   POST /api/recordings (no files) → recording_id → /recordings/[id]/status

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { defaultProfile, PRESET_LABELS } from '@/lib/recordings/profiles'
import type { MeetingPresetId, Analyst, ConfidentialityClass } from '@/lib/recordings/types'

const HERMES = '#E8632A'

type SessionType = 'qa'
type AsrStrategy = 'auto' | 'whisper' | 'deepgram' | 'hybrid'

export interface AgentOption { id: string; name: string }
export interface MemberOption { id: string; name: string }

const CONFIDENTIALITY_LABELS: Record<ConfidentialityClass, string> = {
  client_confidential: 'Client confidential',
  internal: 'Internal',
  restricted: 'Restricted',
  public: 'Public',
}

export default function RecordingWizardClient({
  agents = [], members = [],
}: {
  agents?: AgentOption[]
  members?: MemberOption[]
}) {
  const router = useRouter()

  // ── Setup form ────────────────────────────────────────────────────────────
  const [name, setName] = useState('')
  const meetingDateDefault = new Date().toISOString().slice(0, 10)
  const [meetingDate, setMeetingDate] = useState(meetingDateDefault)
  const [location, setLocation] = useState('')
  const [language, setLanguage] = useState('en')
  const [asrStrategy, setAsrStrategy] = useState<AsrStrategy>('auto')
  const sessionType: SessionType = 'qa'
  const [preset, setPreset] = useState<MeetingPresetId>('town_hall_qa')

  // Q&A-specific
  const [panel, setPanel] = useState<Array<{ name: string; role: string }>>([{ name: '', role: '' }])
  const [agenda, setAgenda] = useState<string[]>([''])
  const [glossary, setGlossary] = useState('')
  const [brandTag, setBrandTag] = useState('')
  const [underlyingAgentId, setUnderlyingAgentId] = useState('')

  // Objectives (§2.8) — what we want this analysis to answer.
  const [objectivesSummary, setObjectivesSummary] = useState('')
  const [objectivesQuestions, setObjectivesQuestions] = useState('')   // one per line

  // Analysis attribution (§2.8)
  const [analysisOrg, setAnalysisOrg] = useState('Datanautix')
  const [analysts, setAnalysts] = useState<string[]>([''])             // names; resolved to member_id when matched
  const [confidentiality, setConfidentiality] = useState<ConfidentialityClass>('client_confidential')

  // ── Submit state ──────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

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
  const canSubmit = !busy && name.trim().length > 0 && cleanedAgenda.length > 0

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setSubmitError(null)
    setBusy(true)

    const meeting_profile = preset === 'community_meeting'
      ? { ...defaultProfile('community_meeting'), has_slides: false }   // deck (if any) attached with the recording
      : null

    const objectives = (objectivesSummary.trim() || cleanedQuestions.length > 0)
      ? { summary: objectivesSummary.trim(), questions: cleanedQuestions }
      : null

    const body = {
      name: name.trim(),
      session_type: sessionType,
      meeting_date: meetingDate || null,
      location: location.trim() || null,
      language,
      setup_inputs: {
        panel: cleanedPanel,
        agenda: cleanedAgenda,
        ...(cleanedGlossary.length > 0 ? { glossary: cleanedGlossary } : {}),
      },
      asr_strategy: asrStrategy,
      meeting_profile,
      brand_tag: brandTag.trim() || null,
      underlying_agent_id: underlyingAgentId || null,
      analysis_org: analysisOrg.trim() || null,
      analysts: cleanedAnalysts,
      objectives,
      confidentiality_class: confidentiality,
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
        <Link href="/recordings" className="text-xs text-gray-500 hover:text-gray-700">← Town Hall</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">New Town Hall</h1>
        <p className="text-sm text-gray-500 mt-1">Set up the project now — you can add the meeting audio or video later, once it&apos;s available.</p>
      </header>

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

          <Field label="Panel members">
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

          <Field label="Agenda topics">
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

          <Field label="Names & terms (optional)">
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

          <Field label="Objectives (optional)">
            <p className="text-xs text-gray-500 mb-1.5">
              What should this analysis answer? This steers the report&apos;s synthesis. You&apos;ll be able to
              pre-fill it from the meeting deck or a brief in a later step.
            </p>
            <textarea value={objectivesSummary} onChange={e => setObjectivesSummary(e.target.value)}
              placeholder="e.g. Gauge resident sentiment on the Kelly Park Road realignment and surface the open concerns the panel must address."
              disabled={busy} rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }} />
          </Field>

          <Field label="Questions we want answered (optional, one per line)">
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

          <div className="grid grid-cols-2 gap-3">
            <Field label="Language">
              <select value={language} onChange={e => setLanguage(e.target.value)} disabled={busy}
                className="w-full border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }}>
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="en-es">English + Spanish (code-switching)</option>
              </select>
            </Field>
            <Field label="ASR strategy">
              <select value={asrStrategy} onChange={e => setAsrStrategy(e.target.value as AsrStrategy)} disabled={busy}
                className="w-full border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }}>
                <option value="auto">Let system decide</option>
                <option value="whisper">Whisper</option>
                <option value="deepgram">Deepgram</option>
                <option value="hybrid">Hybrid (high accuracy)</option>
              </select>
            </Field>
          </div>
        </section>
      </div>

      {submitError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{submitError}</div>
      )}

      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-gray-500">{!canSubmit && !busy ? 'Name and at least one agenda topic are required' : ''}</span>
        <button type="button" onClick={handleSubmit} disabled={!canSubmit}
          className="px-6 py-3 rounded-lg text-sm font-semibold text-white disabled:bg-gray-300 disabled:cursor-not-allowed"
          style={{ backgroundColor: canSubmit ? HERMES : undefined }}>
          {busy ? 'Creating…' : 'Create project'}
        </button>
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  )
}
