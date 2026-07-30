// app/th/[token]/page.tsx
//
// Public, read-only Town Hall report (docs/RECORDINGS.md §4.7). Gated PURELY by
// the share token + share_enabled + expiry — no auth, no org. So it must:
//   - look the recording up by share_token alone (service role),
//   - 404 unless share_enabled AND not expired AND status='complete',
//   - render ONLY shareable meeting content, NEVER internals: no confidence or
//     review flags, no cost, no org/user IDs, no raw un-corrected ASR.
// The polished (public-shareable) question/answer are shown, falling back to
// verbatim per pair. /th is reserved for this product (PulseIQ moved to /pi).
//
// Sections mirror the internal report's tabs with two DELIBERATE omissions:
// Coverage (analyst QC — flagged-for-review counts, coverage gaps) and
// "Live vs Final" (raw-vs-corrected ASR accuracy check). Both describe how the
// report was produced rather than what happened at the meeting, so neither
// belongs in front of an external audience. Add sections here, never by
// widening PublicTabs.

import { notFound } from 'next/navigation'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { RecordingAnalysisSummary, ProceedingsSummary, QaPairPayload, ActionItemPayload, RecordingExtractionRow, TranscriptSegment, EntityMap } from '@/lib/recordings/types'
import { displayQuestion, displayAnswer } from '@/lib/recordings/qaDisplay'
import { buildTimelineModel, renderTimelineHtml } from '@/lib/recordings/timeline'
import { computeParticipation, fmtTalkTime, type ParticipationModel } from '@/lib/recordings/participation'
import { normalizeSegments } from '@/lib/recordings/normalize'
import PublicTabs, { type PublicTab } from './PublicTabs'

export const dynamic = 'force-dynamic'

type Extraction = Pick<RecordingExtractionRow, 'unit_type' | 'topic' | 'payload' | 'sort_order' | 'start_sec' | 'end_sec'>

function fmtDate(s: string | null): string {
  if (!s) return ''
  // meeting_date is a date-only column — format in UTC so a value like
  // '2026-05-21' doesn't shift to the 20th in negative-UTC timezones.
  try { return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) } catch { return '' }
}

function fmtClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return ''
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const CARD = 'rounded-2xl bg-white border border-slate-200 p-5'

export default async function PublicTownHallReport({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token) notFound()

  const service = createServiceRoleClient()
  const { data: rec } = await service
    .from('recordings')
    .select('id, org_id, name, meeting_date, location, status, share_enabled, share_expires_at, share_verbatim, analysis_summary, proceedings_summary, source_duration_sec, draft, entity_map, speaker_names, channel_labels, audio_channels')
    .eq('share_token', token)
    .maybeSingle()

  // Fail closed: unknown token, sharing off, expired, or not finished → 404.
  if (!rec || !rec.share_enabled || rec.status !== 'complete') notFound()
  if (rec.share_expires_at && new Date(rec.share_expires_at).getTime() < Date.now()) notFound()

  const [{ data: rows }, { data: transcriptRow }] = await Promise.all([
    service
      .from('recording_extractions')
      .select('unit_type, topic, payload, sort_order, start_sec, end_sec')
      .eq('recording_id', rec.id)
      .eq('org_id', rec.org_id)
      .order('sort_order', { ascending: true }),
    service
      .from('recording_transcripts')
      .select('segments')
      .eq('recording_id', rec.id)
      .eq('org_id', rec.org_id)
      .maybeSingle(),
  ])

  const extractions = (rows ?? []) as Extraction[]
  const pairs = extractions.filter(e => e.unit_type === 'qa_pair')
  const actionItems = extractions.filter(e => e.unit_type === 'action_item')

  // Corrected transcript (variant → canonical), never the raw ASR — same
  // deterministic normalization the internal Transcript tab shows.
  const rawSegments = ((transcriptRow as { segments?: TranscriptSegment[] } | null)?.segments ?? []) as TranscriptSegment[]
  const segments = rawSegments.length ? normalizeSegments(rawSegments, (rec.entity_map ?? null) as EntityMap | null) : []

  const participation = computeParticipation(segments.length ? segments : null, {
    speakerNames: (rec.speaker_names ?? null) as Record<string, string> | null,
    channelLabels: (rec.channel_labels ?? null) as string[] | null,
    audioChannels: (rec as { audio_channels?: number | null }).audio_channels ?? null,
    panel: null,
  })

  // Meeting timeline summary bar (single brand colour — internal flags never shown).
  const tlModel = buildTimelineModel(pairs, (rec as { source_duration_sec?: number | null }).source_duration_sec ?? null)

  const summary = (rec.analysis_summary ?? null) as RecordingAnalysisSummary | null
  const proceedings = (rec.proceedings_summary ?? null) as ProceedingsSummary | null
  const hasNotes = !!(proceedings && (proceedings.overview || (proceedings.items?.length ?? 0) > 0))

  // Topic order from the summary, then any extraction topics it didn't cover.
  const order: string[] = []
  for (const t of summary?.topic_summaries ?? []) if (!order.includes(t.topic)) order.push(t.topic)
  for (const p of pairs) { const t = p.topic || 'Other'; if (!order.includes(t)) order.push(t) }

  const meta = [fmtDate(rec.meeting_date), rec.location].filter(Boolean).join('  ·  ')
  const isDraft = !!(rec as { draft?: boolean }).draft

  // Every section is conditional — a meeting with no presentation, no action
  // items or a single-channel capture simply shows fewer tabs, and PublicTabs
  // drops the tab bar entirely when only one survives.
  const tabs: PublicTab[] = []
  if (hasNotes && proceedings) {
    tabs.push({ key: 'presentation', label: 'Presentation', content: <PresentationSection proceedings={proceedings} /> })
  }
  if (pairs.length > 0 || summary?.executive_summary) {
    tabs.push({
      key: 'qa',
      label: 'Q&A',
      content: (
        <QaSection
          pairs={pairs} order={order} summary={summary} hasNotes={hasNotes}
          timelineHtml={tlModel ? renderTimelineHtml(tlModel, '#0f766e') : null}
          verbatim={!!rec.share_verbatim}
        />
      ),
    })
  }
  if (actionItems.length > 0) {
    tabs.push({ key: 'actions', label: 'Action items', content: <ActionItemsSection items={actionItems} /> })
  }
  if (participation.ok) {
    tabs.push({ key: 'participation', label: 'Participation', content: <ParticipationSection model={participation} /> })
  }
  if (segments.length > 0) {
    tabs.push({ key: 'transcript', label: 'Transcript', content: <TranscriptSection segments={segments} /> })
  }

  return (
    <main className="relative min-h-screen bg-slate-50 text-slate-900">
      {isDraft && (
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden flex items-center justify-center" aria-hidden>
          <span className="text-[18vw] font-black text-amber-500/10 rotate-[-28deg] select-none whitespace-nowrap tracking-widest">DRAFT</span>
        </div>
      )}
      <div className="relative z-10 max-w-3xl mx-auto px-5 py-10">
        <header className="mb-8">
          <div className="text-xs font-semibold tracking-widest text-slate-400 uppercase mb-2">Meeting Report</div>
          <h1 className="text-3xl font-bold text-slate-900">{rec.name}</h1>
          {meta && <p className="text-sm text-slate-500 mt-2">{meta}</p>}
          {isDraft && (
            <div className="mt-4 rounded-xl bg-amber-50 border border-amber-300 px-4 py-3">
              <div className="text-sm font-bold text-amber-900">⚠ DRAFT — pending human review</div>
              <p className="text-xs text-amber-800 mt-0.5">This report was generated automatically and has not yet been reviewed by a person. Figures and attributions may change. It will be finalized after review.</p>
            </div>
          )}
        </header>

        <PublicTabs tabs={tabs} />

        <footer className="mt-12 pt-6 border-t border-slate-200 text-center text-xs text-slate-400">
          Prepared by{' '}
          <span className="font-bold"><span style={{ color: '#1FA8A8' }}>data</span><span style={{ color: '#F07040' }}>nautix</span></span>
          {'  ·  '}datanautix.com
        </footer>
      </div>
    </main>
  )
}

// ── Section builders ────────────────────────────────────────────────────────
// Each renders one public tab. Server components handed to PublicTabs as
// `content`, so no report data crosses into the client bundle.

function PresentationSection({ proceedings }: { proceedings: ProceedingsSummary }) {
  return (
    <section className={CARD}>
      <h2 className="text-sm font-bold text-slate-700 mb-3">Meeting Notes</h2>
      {proceedings.overview && (
        <p className="text-[15px] leading-relaxed text-slate-700 whitespace-pre-line">{proceedings.overview}</p>
      )}
      {(proceedings.items?.length ?? 0) > 0 && (
        <div className="space-y-3 mt-4">
          {proceedings.items.map((it, i) => (
            <div key={i} className="border border-slate-200 rounded-xl p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-semibold text-slate-900">{it.title}</h3>
                {it.slide_refs?.length > 0 && (
                  <span className="shrink-0 text-xs text-slate-400">
                    {it.slide_refs.length === 1 ? 'Slide' : 'Slides'} {it.slide_refs.join(', ')}
                  </span>
                )}
              </div>
              {it.presenter && <div className="text-xs text-slate-500 mt-0.5">{it.presenter}</div>}
              {it.what_was_presented && (
                <p className="text-sm text-slate-700 mt-2 leading-relaxed whitespace-pre-line">{it.what_was_presented}</p>
              )}
              {it.key_figures?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {it.key_figures.map((f, j) => (
                    <span key={j} className="inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                      <span className="text-slate-500">{f.label}</span>
                      <span className="font-semibold text-slate-900">{f.value}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-400 mt-3">Neutral AI summary of the presentation portion of the meeting. The Q&amp;A tab covers the discussion that followed.</p>
    </section>
  )
}

function QaSection({ pairs, order, summary, hasNotes, timelineHtml, verbatim }: {
  pairs: Extraction[]
  order: string[]
  summary: RecordingAnalysisSummary | null
  hasNotes: boolean
  timelineHtml: string | null
  verbatim: boolean
}) {
  return (
    <>
      {summary?.executive_summary && (
        <section className={`mb-8 ${CARD}`}>
          <h2 className="text-sm font-bold text-slate-700 mb-2">{hasNotes ? 'Q&A Overview' : 'Overview'}</h2>
          <p className="text-[15px] leading-relaxed text-slate-700 whitespace-pre-wrap">{summary.executive_summary}</p>
        </section>
      )}

      {timelineHtml && (
        <section className={`mb-8 ${CARD}`}>
          <div dangerouslySetInnerHTML={{ __html: timelineHtml }} />
        </section>
      )}

      <section className="space-y-8">
        {order.map(topic => {
          const tPairs = pairs.filter(p => (p.topic || 'Other') === topic)
          if (tPairs.length === 0) return null
          return (
            <div key={topic}>
              <h2 className="text-lg font-bold text-slate-900 border-b border-slate-200 pb-1.5 mb-4">{topic}</h2>
              <div className="space-y-5">
                {tPairs.map((p, i) => {
                  const qa = p.payload as QaPairPayload
                  // Owner setting: verbatim shows the words spoken; otherwise the
                  // display-of-record (human edit → AI polish → verbatim).
                  const q = displayQuestion(qa, { verbatim })
                  const a = displayAnswer(qa, { verbatim })
                  return (
                    <div key={i} className="rounded-xl bg-white border border-slate-200 overflow-hidden">
                      <div className="px-4 py-3 border-b border-slate-100">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-teal-700 mb-1">
                          Question{qa.asker_name ? `  ·  ${qa.asker_name}` : ''}
                        </div>
                        <p className="text-[15px] font-medium text-slate-900">{q}</p>
                      </div>
                      <div className="px-4 py-3 bg-slate-50/60">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-orange-700 mb-1">
                          Response{qa.panelist_name ? `  ·  ${qa.panelist_name}` : ''}
                        </div>
                        <p className="text-[15px] leading-relaxed text-slate-700 whitespace-pre-wrap">{a}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </section>
    </>
  )
}

function ActionItemsSection({ items }: { items: Extraction[] }) {
  return (
    <section className="space-y-3">
      <p className="text-[13px] text-slate-500">Commitments and follow-ups captured from the meeting.</p>
      {items.map((it, i) => {
        const a = it.payload as ActionItemPayload
        // Human edits win over the AI values, matching the internal report.
        const description = a.edited_description ?? a.description
        const owner = a.edited_owner ?? a.owner
        const due = a.edited_due_date ?? a.due_date
        return (
          <div key={i} className="rounded-xl bg-white border border-slate-200 p-4">
            <p className="text-[15px] leading-relaxed text-slate-800">{description}</p>
            {(owner || due || a.related_agenda_item) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {owner && (
                  <span className="inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                    <span className="text-slate-500">Owner</span><span className="font-semibold text-slate-900">{owner}</span>
                  </span>
                )}
                {due && (
                  <span className="inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                    <span className="text-slate-500">Due</span><span className="font-semibold text-slate-900">{fmtDate(due) || due}</span>
                  </span>
                )}
                {a.related_agenda_item && (
                  <span className="inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                    <span className="text-slate-500">Topic</span><span className="font-semibold text-slate-900">{a.related_agenda_item}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}

function ParticipationSection({ model }: { model: ParticipationModel }) {
  const tiles: Array<{ label: string; value: string }> = [
    { label: 'Speakers', value: String(model.speakerCount) },
    { label: 'Total speaking time', value: fmtTalkTime(model.totalTalkSec) },
    { label: 'Floor changes', value: String(model.floorChanges) },
    { label: 'Largest share', value: model.topSharePct + '%' },
  ]
  return (
    <section className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {tiles.map(t => (
          <div key={t.label} className="rounded-xl bg-white border border-slate-200 p-3.5">
            <div className="text-lg font-bold text-slate-900">{t.value}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{t.label}</div>
          </div>
        ))}
      </div>

      <div className={CARD}>
        <h2 className="text-sm font-bold text-slate-700 mb-3">Who spoke, and for how long</h2>
        <div className="space-y-2.5">
          {model.speakers.map(s => (
            <div key={s.key} className="flex items-center gap-3">
              <span className="w-36 shrink-0 truncate text-sm text-slate-700" title={s.name}>{s.name}</span>
              <div className="h-2 flex-1 rounded bg-slate-100 overflow-hidden">
                <div className="h-full rounded bg-teal-600" style={{ width: Math.max(1, Math.round(s.sharePct)) + '%' }} />
              </div>
              <span className="w-28 shrink-0 text-right text-xs text-slate-500">
                {fmtTalkTime(s.talkSec)} · {Math.round(s.sharePct)}%
              </span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-3">
          Share is of total speaking time, not meeting length. Speaker labels come from the recording&rsquo;s
          channels or voice separation and may group people who sound alike.
        </p>
      </div>
    </section>
  )
}

function TranscriptSection({ segments }: { segments: TranscriptSegment[] }) {
  return (
    <section className={CARD}>
      <h2 className="text-sm font-bold text-slate-700 mb-1">Full transcript</h2>
      <p className="text-[11px] text-slate-400 mb-4">
        Spelling-corrected transcript of the meeting. Automated transcription — wording may contain errors.
      </p>
      <div className="space-y-3">
        {segments.map((s, i) => {
          const prev = i > 0 ? segments[i - 1] : null
          const newSpeaker = !prev || prev.speaker !== s.speaker || prev.channel !== s.channel
          return (
            <div key={i} className={newSpeaker ? 'pt-2' : ''}>
              {newSpeaker && (
                <div className="flex items-baseline gap-2 mb-0.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {s.speaker || (s.channel != null ? 'Channel ' + (s.channel + 1) : 'Speaker')}
                  </span>
                  <span className="text-[11px] text-slate-400">{fmtClock(s.start)}</span>
                </div>
              )}
              <p className="text-[15px] leading-relaxed text-slate-700">{s.text}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
