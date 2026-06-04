// app/th/[token]/page.tsx
//
// Public, read-only Town Hall report (docs/RECORDINGS.md §4.7). Gated PURELY by
// the share token + share_enabled + expiry — no auth, no org. So it must:
//   - look the recording up by share_token alone (service role),
//   - 404 unless share_enabled AND not expired AND status='complete',
//   - render ONLY shareable fields: meeting meta, exec summary, polished Q&A by
//     topic. NEVER the raw transcript, flags, confidence, cost, org, or IDs.
// The polished (public-shareable) question/answer are shown, falling back to
// verbatim per pair. /th is reserved for this product (PulseIQ moved to /pi).

import { notFound } from 'next/navigation'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { RecordingAnalysisSummary, QaPairPayload, RecordingExtractionRow } from '@/lib/recordings/types'

export const dynamic = 'force-dynamic'

function fmtDate(s: string | null): string {
  if (!s) return ''
  // meeting_date is a date-only column — format in UTC so a value like
  // '2026-05-21' doesn't shift to the 20th in negative-UTC timezones.
  try { return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) } catch { return '' }
}

export default async function PublicTownHallReport({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token) notFound()

  const service = createServiceRoleClient()
  const { data: rec } = await service
    .from('recordings')
    .select('id, org_id, name, meeting_date, location, status, share_enabled, share_expires_at, share_verbatim, analysis_summary')
    .eq('share_token', token)
    .maybeSingle()

  // Fail closed: unknown token, sharing off, expired, or not finished → 404.
  if (!rec || !rec.share_enabled || rec.status !== 'complete') notFound()
  if (rec.share_expires_at && new Date(rec.share_expires_at).getTime() < Date.now()) notFound()

  const { data: rows } = await service
    .from('recording_extractions')
    .select('unit_type, topic, payload, sort_order')
    .eq('recording_id', rec.id)
    .eq('org_id', rec.org_id)
    .order('sort_order', { ascending: true })

  const pairs = ((rows ?? []) as Pick<RecordingExtractionRow, 'unit_type' | 'topic' | 'payload' | 'sort_order'>[])
    .filter(e => e.unit_type === 'qa_pair')

  const summary = (rec.analysis_summary ?? null) as RecordingAnalysisSummary | null

  // Topic order from the summary, then any extraction topics it didn't cover.
  const order: string[] = []
  for (const t of summary?.topic_summaries ?? []) if (!order.includes(t.topic)) order.push(t.topic)
  for (const p of pairs) { const t = p.topic || 'Other'; if (!order.includes(t)) order.push(t) }

  const meta = [fmtDate(rec.meeting_date), rec.location].filter(Boolean).join('  ·  ')

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-3xl mx-auto px-5 py-10">
        <header className="mb-8">
          <div className="text-xs font-semibold tracking-widest text-slate-400 uppercase mb-2">Meeting Q&amp;A Summary</div>
          <h1 className="text-3xl font-bold text-slate-900">{rec.name}</h1>
          {meta && <p className="text-sm text-slate-500 mt-2">{meta}</p>}
        </header>

        {summary?.executive_summary && (
          <section className="mb-8 rounded-2xl bg-white border border-slate-200 p-5">
            <h2 className="text-sm font-bold text-slate-700 mb-2">Overview</h2>
            <p className="text-[15px] leading-relaxed text-slate-700 whitespace-pre-wrap">{summary.executive_summary}</p>
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
                    // Owner setting: verbatim shows the words spoken; polished
                    // (default) shows the editorial version, verbatim fallback.
                    const q = rec.share_verbatim ? qa.question : (qa.polished_question || qa.question)
                    const a = rec.share_verbatim ? qa.answer : (qa.polished_answer || qa.answer)
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

        <footer className="mt-12 pt-6 border-t border-slate-200 text-center text-xs text-slate-400">
          Prepared by{' '}
          <span className="font-bold"><span style={{ color: '#1FA8A8' }}>data</span><span style={{ color: '#F07040' }}>nautix</span></span>
          {'  ·  '}datanautix.com
        </footer>
      </div>
    </main>
  )
}
