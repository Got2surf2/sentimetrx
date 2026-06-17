'use client'

// components/recordings/TranscriptReview.tsx
//
// Shared transcript surface used in two places:
//   1. The transcribed-gate review (StatusClient → GeneratePanel), editable, so
//      speaker labels / verbatim text / mislabeled segments are corrected BEFORE
//      the (paid) Q&A extraction runs — the corrections feed the first analysis
//      pass (analyzeRecordingWorkflow re-reads recording_transcripts at run time).
//   2. The report Transcript tab (ReportClient), post-analysis, with the audit
//      overlay (which lines became a Q&A) and the entity corrected/raw toggle.
//
// Speaker NAMING (label → human name) persists to recordings.speaker_names via
// POST /speaker-names. Segment EDITS (verbatim text + speaker reassignment)
// persist to recording_transcripts.segments via PATCH /transcript. The raw ASR
// is preserved in raw_response either way.

import { useEffect, useMemo, useState } from 'react'
import type { TranscriptSegment, EntityMap } from '@/lib/recordings/types'
import { buildReplacements, normalizeSegments } from '@/lib/recordings/normalize'

export type SegmentRole = 'question' | 'answer'
type PlayHandler = (startSec: number, endSec: number, label: string) => void

export default function TranscriptReview({
  recordingId,
  segments: segmentsProp,
  speakerNames,
  channelLabels,
  canEdit,
  entityMap = null,
  roles,
  onPlay,
  editable = false,
  saveHint,
  panelSpeakers = [],
  extraSpeakers = [],
  onSegmentsSaved,
}: {
  recordingId: string
  segments: TranscriptSegment[]
  speakerNames: Record<string, string> | null
  channelLabels: string[] | null
  canEdit: boolean
  entityMap?: EntityMap | null
  roles?: Map<number, SegmentRole>
  onPlay?: PlayHandler
  editable?: boolean
  saveHint?: string
  // Panel members from setup (read-only here) — always offered in the dropdown.
  panelSpeakers?: string[]
  // Extra speakers (moderator/audience/untagged) — editable in this panel,
  // persisted to setup_inputs.speakers. Seeds the editable roster below.
  extraSpeakers?: string[]
  // Called after a successful segment save so the parent can refresh its copy
  // (keeps the read view + remounts consistent).
  onSegmentsSaved?: (segments: TranscriptSegment[]) => void
}) {
  // Internal copy so segment edits reflect immediately without a parent refetch.
  const [segments, setSegments] = useState<TranscriptSegment[]>(segmentsProp)
  useEffect(() => { setSegments(segmentsProp) }, [segmentsProp])

  const [search, setSearch] = useState('')

  // Corrected view = deterministic variant→canonical from the entity map. The
  // raw ASR (record of truth) is never mutated; this derives a view on read.
  const replacements = useMemo(() => buildReplacements(entityMap), [entityMap])
  const canCorrect = replacements.length > 0
  const [view, setView] = useState<'corrected' | 'raw'>(canCorrect ? 'corrected' : 'raw')
  const corrected = useMemo(() => normalizeSegments(segments, entityMap), [segments, entityMap])

  // Speaker naming: distinct diarized labels + a sample line each. Self-intro →
  // suggested name ("Hi, I'm Tatiana Morales" → "Tatiana Morales").
  const [names, setNames] = useState<Record<string, string>>(speakerNames ?? {})
  const [namesOpen, setNamesOpen] = useState(false)
  const [savingNames, setSavingNames] = useState(false)
  // Extra speakers (moderator/audience/untagged) managed right here — editable,
  // persisted to setup_inputs.speakers on save. Panel members come in read-only
  // via panelSpeakers (set on the setup page).
  const [extras, setExtras] = useState<string[]>(extraSpeakers)
  const speakerLabels = useMemo(() => {
    const introRe = /\b(?:i['’]?m|i am|my name is|this is|name['’]?s)\s+([A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){0,2})/
    const info = new Map<string, { sample: string; start: number; end: number; suggested?: string }>()
    for (const s of segments) {
      const lbl = s.speaker ? String(s.speaker) : ''
      if (!lbl) continue
      let e = info.get(lbl)
      if (!e) { e = { sample: (s.text || '').slice(0, 60), start: s.start, end: s.end }; info.set(lbl, e) }
      if (!e.suggested) { const m = (s.text || '').match(introRe); if (m) e.suggested = m[1].trim() }
    }
    return [...info.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [segments])
  // Reassignment dropdown options: diarized labels (shown by assigned name when
  // one exists) + panel members + the editable extra speakers. Deduped by
  // display so a name never appears twice across the three sources.
  const assignOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = []
    const seen = new Set<string>()
    for (const [label] of speakerLabels) {
      const disp = names[label]?.trim() || label
      opts.push({ value: label, label: disp })
      seen.add(label); seen.add(disp)
    }
    for (const raw of [...panelSpeakers, ...extras]) {
      const n = (raw || '').trim()
      if (!n || seen.has(n)) continue
      opts.push({ value: n, label: n })
      seen.add(n)
    }
    return opts
  }, [speakerLabels, names, panelSpeakers, extras])
  // One save persists both the label→name map (speaker_names) and the editable
  // extra speakers (setup_inputs.speakers).
  const saveNames = async () => {
    setSavingNames(true)
    try {
      await fetch(`/api/recordings/${recordingId}/speaker-names`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names, extra_speakers: extras.map(s => s.trim()).filter(Boolean) }),
      })
    } finally { setSavingNames(false) }
  }

  // Segment edit mode (the "full review surface"): inline verbatim correction +
  // speaker reassignment. Operates on the RAW segments (record of truth), so
  // entering edit mode forces the raw view. `dirty` tracks which indices changed.
  const [editMode, setEditMode] = useState(false)
  const [working, setWorking] = useState<TranscriptSegment[]>([])
  const [dirty, setDirty] = useState<Set<number>>(new Set())
  const [savingSegs, setSavingSegs] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const [fillMsg, setFillMsg] = useState<string | null>(null)
  const enterEdit = () => { setWorking(segments.map(s => ({ ...s }))); setDirty(new Set()); setSavedNote(false); setFillMsg(null); setView('raw'); setEditMode(true) }
  const cancelEdit = () => { setEditMode(false); setWorking([]); setDirty(new Set()); setFillMsg(null) }
  const editText = (i: number, text: string) => {
    setWorking(prev => { const next = prev.slice(); next[i] = { ...next[i], text }; return next })
    setDirty(prev => new Set(prev).add(i))
  }
  const editSpeaker = (i: number, speaker: string) => {
    setWorking(prev => {
      const next = prev.slice()
      const seg = { ...next[i] }
      if (speaker) seg.speaker = speaker; else delete seg.speaker
      next[i] = seg
      return next
    })
    setDirty(prev => new Set(prev).add(i))
  }
  // Auto-fill unassigned speaker gaps that are bounded on BOTH sides by the
  // SAME identified speaker — the safe case, no guessing across a speaker
  // change. Runs of unassigned segments touching a different speaker (or no
  // anchor) are left alone. Stages the fills as pending edits to review + save.
  const autoFillSpeakers = () => {
    const next = working.slice()
    const filled: number[] = []
    let i = 0
    while (i < next.length) {
      if (next[i].speaker) { i++; continue }
      const start = i
      let j = i
      while (j < next.length && !next[j].speaker) j++
      const before = start > 0 ? next[start - 1].speaker : undefined
      const after = j < next.length ? next[j].speaker : undefined
      if (before && after && before === after) {
        for (let k = start; k < j; k++) { next[k] = { ...next[k], speaker: before }; filled.push(k) }
      }
      i = j
    }
    if (filled.length === 0) {
      setFillMsg('No same-speaker gaps to fill — every unassigned run is between two different speakers (or has no anchor on one side).')
      return
    }
    setWorking(next)
    setDirty(prev => { const s = new Set(prev); filled.forEach(k => s.add(k)); return s })
    setFillMsg(`Filled ${filled.length} segment${filled.length === 1 ? '' : 's'} bounded by the same speaker — review and Save.`)
  }
  const saveSegs = async () => {
    if (dirty.size === 0) { cancelEdit(); return }
    setSavingSegs(true)
    try {
      const edits = [...dirty].map(i => ({ index: i, text: working[i].text, speaker: working[i].speaker ?? null }))
      const r = await fetch(`/api/recordings/${recordingId}/transcript`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edits }),
      })
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d?.error || `Save failed (${r.status})`); setSavingSegs(false); return }
      const saved = working.map(s => ({ ...s }))
      setSegments(saved)
      setEditMode(false)
      setDirty(new Set())
      if (saveHint) setSavedNote(true)
      onSegmentsSaved?.(saved)   // let the parent refresh so the read view / remounts stay in sync
    } catch { alert('Save failed') } finally { setSavingSegs(false) }
  }

  // What the list renders: working copy while editing; corrected or raw otherwise.
  const display = editMode ? working : (view === 'corrected' && canCorrect ? corrected : segments)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (editMode || !q) return display
    return display.filter(s => s.text.toLowerCase().includes(q))
  }, [display, search, editMode])

  const hasStereo = useMemo(() => segments.some(s => typeof s.channel === 'number'), [segments])

  // Crosstalk: spots where two mics had overlapping speech (both channels at
  // once → ASR can garble). Keyed by segment start. Time-swept O(n).
  const collisions = useMemo(() => {
    const out = new Set<number>()
    const segs = segments.filter(s => typeof s.channel === 'number').sort((a, b) => a.start - b.start)
    const act: TranscriptSegment[] = []
    for (const s of segs) {
      for (let k = act.length - 1; k >= 0; k--) if (act[k].end <= s.start) act.splice(k, 1)
      for (const a of act) if (a.channel !== s.channel) { out.add(a.start); out.add(s.start) }
      act.push(s)
    }
    return out
  }, [segments])

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="rounded-xl border border-gray-200 bg-gray-50">
          <button type="button" onClick={() => setNamesOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-gray-700">
            <span>🎙 Speakers ({assignOptions.length})</span>
            <span className="text-gray-400">{namesOpen ? '▲' : '▼'}</span>
          </button>
          {namesOpen && (
            <div className="px-4 pb-4 space-y-3">
              {/* Diarized speakers — name each; applied across the transcript + Q&A. */}
              {speakerLabels.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">Name each detected speaker — applied across the transcript and Q&amp;A. Leave blank to keep the raw label.</p>
                  {speakerLabels.map(([label, info]) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-400 w-16 shrink-0 truncate" title={label}>{label}</span>
                      <input
                        type="text" value={names[label] ?? ''} placeholder={info.suggested || label}
                        onChange={e => setNames(prev => ({ ...prev, [label]: e.target.value }))}
                        className="w-40 shrink-0 px-2 py-1 border border-gray-200 rounded text-sm" style={{ fontSize: '16px' }} />
                      {info.suggested && (names[label] ?? '') !== info.suggested && (
                        <button type="button" title="Use the name they introduced themselves with"
                          onClick={() => setNames(prev => ({ ...prev, [label]: info.suggested! }))}
                          className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 hover:bg-amber-200 shrink-0 whitespace-nowrap">✨ {info.suggested}</button>
                      )}
                      <button type="button" title="Play + jump to this point in the transcript"
                        onClick={() => { onPlay?.(info.start, info.end, info.sample); document.getElementById(`seg-${info.start}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}
                        className="flex-1 min-w-0 text-left text-xs text-gray-500 hover:text-orange-600 truncate">▶ “{info.sample}”</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Other speakers — moderator / audience / anyone the recording didn't
                  split out. Editable here; assignable in the per-segment dropdown. */}
              <div className="space-y-2">
                <p className="text-xs text-gray-500">
                  Other speakers — moderator, audience, or anyone the recording didn&apos;t separate. Add them here to assign segments to them below.
                </p>
                {extras.map((nm, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="text" value={nm} placeholder="Name"
                      onChange={e => setExtras(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                      className="w-56 shrink-0 px-2 py-1 border border-gray-200 rounded text-sm" style={{ fontSize: '16px' }} />
                    <button type="button" onClick={() => setExtras(prev => prev.filter((_, j) => j !== i))}
                      className="text-gray-400 hover:text-red-500 text-lg leading-none shrink-0">×</button>
                  </div>
                ))}
                <button type="button" onClick={() => setExtras(prev => [...prev, ''])}
                  className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-100">+ Add speaker</button>
                {panelSpeakers.length > 0 && (
                  <p className="text-xs text-gray-400">From the panel (set on the project): {panelSpeakers.join(' · ')} — already assignable.</p>
                )}
              </div>

              <button type="button" onClick={saveNames} disabled={savingNames}
                className="mt-1 px-3 py-1.5 rounded-lg bg-orange-600 text-white text-sm font-semibold disabled:opacity-50">
                {savingNames ? 'Saving…' : 'Save speakers'}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        {!editMode && (
          <input
            type="search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search transcript…"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-base"
            style={{ fontSize: '16px' }}
          />
        )}
        {editMode && (
          <span className="flex-1 text-sm font-semibold text-orange-700">Editing transcript — fix wording or reassign a speaker, then save.</span>
        )}
        {!editMode && canCorrect && (
          <div className="flex rounded-lg border border-gray-200 overflow-hidden shrink-0 text-xs">
            <button type="button" onClick={() => setView('corrected')}
              className={`px-3 py-2 font-medium ${view === 'corrected' ? 'bg-orange-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Corrected</button>
            <button type="button" onClick={() => setView('raw')}
              className={`px-3 py-2 font-medium ${view === 'raw' ? 'bg-gray-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Raw</button>
          </div>
        )}
        {editable && canEdit && (
          editMode ? (
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={autoFillSpeakers} disabled={savingSegs}
                title="Fill unassigned segments that sit between two of the same identified speaker"
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">⚡ Auto-fill speakers</button>
              <button type="button" onClick={cancelEdit} disabled={savingSegs}
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={saveSegs} disabled={savingSegs}
                className="text-sm px-3 py-1.5 rounded-lg bg-orange-600 text-white font-semibold disabled:opacity-50">
                {savingSegs ? 'Saving…' : `Save${dirty.size ? ` (${dirty.size})` : ''}`}
              </button>
            </div>
          ) : (
            <button type="button" onClick={enterEdit}
              className="text-sm px-3 py-1.5 rounded-lg border border-orange-200 text-orange-700 font-medium hover:bg-orange-50 shrink-0">✎ Edit transcript</button>
          )
        )}
        {!editMode && (
          <div className="text-xs text-gray-500 shrink-0">{filtered.length} / {segments.length} segments</div>
        )}
      </div>

      {savedNote && saveHint && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{saveHint}</p>
      )}
      {editMode && fillMsg && (
        <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{fillMsg}</p>
      )}
      {!editMode && (
        <p className="text-xs text-gray-500">
          {canCorrect && view === 'corrected'
            ? <>Spelling-corrected view — names normalized to the reviewed spellings. The raw ASR is unchanged — switch to “Raw” to see it.</>
            : <>Record of truth — verbatim ASR output. Edits here become the transcript the Q&amp;A is extracted from.</>}
        </p>
      )}
      {!editMode && roles && roles.size > 0 && (
        <p className="text-xs text-gray-500">
          Audit overlay: <span className="font-bold text-gray-900">bold</span> = extracted question · <span className="font-bold italic text-gray-900">bold italic</span> = answer · plain = not extracted into a Q&amp;A pair.
        </p>
      )}
      {!editMode && hasStereo && (
        <p className="text-xs text-gray-500">
          Stereo mics: <span className="text-gray-800">{channelLabels?.[0]?.trim() || 'Mic 1 · L'} (plain)</span> · <span className="italic text-indigo-700">{channelLabels?.[1]?.trim() || 'Mic 2 · R'} (italic, colored)</span> — each line is colored by its source microphone.
          {collisions.size > 0 && <> A <span className="underline decoration-wavy decoration-amber-500 underline-offset-2">wavy underline</span> marks where both mics spoke at once (crosstalk).</>}
        </p>
      )}

      <ol className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto pr-2">
        {filtered.map((s, i) => {
          // In edit mode the list is the working copy (unfiltered), so the map
          // index IS the segment index. Otherwise resolve by identity isn't
          // needed — display order matches.
          const idx = i
          const ch = typeof s.channel === 'number' ? s.channel : null
          const named = s.speaker ? names[String(s.speaker)]?.trim() : undefined
          const chName = ch !== null ? channelLabels?.[ch]?.trim() : undefined
          const primary = named || chName || s.speaker
          const role = roles?.get(s.start)
          const weight = role === 'question' ? 'font-bold' : role === 'answer' ? 'font-bold italic' : ''
          const color = ch === null ? (role ? 'text-gray-900' : 'text-gray-800') : ch === 0 ? 'text-gray-800' : 'text-indigo-700'
          const chItalic = ch !== null && ch !== 0 ? 'italic' : ''
          const collision = collisions.has(s.start)
          const cls = [weight, chItalic, color, collision ? 'underline decoration-wavy decoration-amber-500 underline-offset-2' : ''].filter(Boolean).join(' ')
          return (
            <li key={idx} id={`seg-${s.start}`} className="py-2 text-sm flex items-start gap-3 group scroll-mt-24">
              {onPlay ? (
                <button type="button" onClick={() => onPlay(s.start, s.end, s.text.slice(0, 80))}
                  title="Play from here"
                  className="font-mono text-xs text-gray-400 hover:text-orange-600 w-14 shrink-0 pt-0.5 text-left">
                  ▶ {formatTime(s.start)}
                </button>
              ) : (
                <span className="font-mono text-xs text-gray-400 w-14 shrink-0 pt-0.5">{formatTime(s.start)}</span>
              )}

              {editMode ? (
                <select value={s.speaker ?? ''} onChange={e => editSpeaker(idx, e.target.value)}
                  className="w-24 shrink-0 text-xs border border-gray-200 rounded px-1 py-0.5" style={{ fontSize: '16px' }}>
                  <option value="">(unassigned)</option>
                  {assignOptions.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                  {s.speaker && !assignOptions.some(o => o.value === s.speaker) && (
                    <option value={s.speaker}>{s.speaker}</option>
                  )}
                </select>
              ) : (
                (primary || ch !== null) && (
                  <span className="w-20 shrink-0 pt-0.5 flex flex-col gap-0.5">
                    {primary && <span className={`text-xs font-semibold truncate ${chName ? (ch === 0 ? 'text-gray-700' : 'text-indigo-700') : 'text-gray-500'}`} title={primary}>{primary}</span>}
                    {ch !== null && <span className={`text-[10px] font-medium ${ch === 0 ? 'text-gray-500' : 'text-indigo-600'}`} title="Source microphone (stereo split)">{micLabel(ch)}</span>}
                  </span>
                )
              )}

              {editMode ? (
                <textarea value={s.text} onChange={e => editText(idx, e.target.value)} rows={Math.max(1, Math.ceil(s.text.length / 80))}
                  className="flex-1 min-w-0 border border-gray-200 rounded px-2 py-1 leading-relaxed resize-y" style={{ fontSize: '16px' }} />
              ) : (
                <span className={cls} title={collision ? 'Both mics were speaking at once here — words may overlap or garble (crosstalk).' : undefined}>{highlight(s.text, search)}</span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function micLabel(channel: number): string {
  if (channel === 0) return 'Mic 1 · L'
  if (channel === 1) return 'Mic 2 · R'
  return `Mic ${channel + 1}`
}

function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim()
  if (!q) return text
  const lower = text.toLowerCase()
  const ql = q.toLowerCase()
  const parts: React.ReactNode[] = []
  let i = 0
  while (i < text.length) {
    const idx = lower.indexOf(ql, i)
    if (idx < 0) { parts.push(text.slice(i)); break }
    if (idx > i) parts.push(text.slice(i, idx))
    parts.push(<mark key={idx} className="bg-yellow-200 rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>)
    i = idx + q.length
  }
  return parts
}
