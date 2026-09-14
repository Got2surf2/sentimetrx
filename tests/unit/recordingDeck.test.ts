// lib/pptx/recordingDeck.ts — the Town Hall Q&A session deck, rendered through
// REAL pptxgenjs and inspected as an archive. One rich input exercises every
// slide family (title with draft/objective/sign-off, meeting overview + detail
// cards, executive summary, sentiment, timeline, themes, actions/decisions with
// overflow, appendix); a bare input pins what is skipped when analysis is null.
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildRecordingDeck, type RecordingDeckInput } from '@/lib/pptx/recordingDeck'
import type { RecordingExtractionRow } from '@/lib/recordings/types'

async function open(input: RecordingDeckInput) {
  const bytes = await buildRecordingDeck(input)
  const zip = await JSZip.loadAsync(Buffer.from(bytes))
  const names = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
  const slides: string[] = []
  for (const n of names) slides.push(await zip.files[n].async('string'))
  const core = (await zip.files['docProps/core.xml']?.async('string')) || ''
  return { slides, all: slides.join('\n'), core }
}
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")

let n = 0
function ex(unit_type: 'qa_pair' | 'action_item', topic: string | null, payload: Record<string, unknown>, sort_order: number, timing?: { start: number; end: number }): RecordingExtractionRow {
  return { id: 'e' + n++, recording_id: 'rec', org_id: 'org', unit_type, topic, payload, start_sec: timing?.start ?? null, end_sec: timing?.end ?? null, source_file: null, confidence: 0.9, flagged_for_review: false, flag_reason: null, sort_order, created_at: '' } as unknown as RecordingExtractionRow
}

const RICH: RecordingDeckInput = {
  name: 'Community Meeting #2',
  meeting_date: '2026-06-16T12:00:00Z',
  location: 'Apopka City Hall',
  analysis_org: null,
  analysts: [{ name: 'Alex Kim' }, { name: '' }],
  objectives: { summary: 'Understand resident concerns about the Vick Road alignment.', questions: [] },
  confidentiality_class: 'client_confidential',
  signoff: { approved_by: 'Dana Lee', approved_at: '2026-06-20T00:00:00Z' },
  config_version: 3,
  analysis_summary: {
    executive_summary: 'Residents pressed on traffic and safety; the panel committed to signal timing studies.',
    headline: 'Traffic and safety dominate',
    sentiment_overall: 'mixed',
    sentiment_breakdown: { positive: 9, neutral: 9, negative: 9, mixed: 9 },   // deliberately stale — the deck must recount from the pairs
    topic_summaries: [
      { topic: 'Traffic', qa_count: 99, summary: 'Signals and queues. A second sentence that runs long enough to be truncated on a sentence boundary when the card budget is reached because it keeps going and going well past the limit of the box.', sentiment: 'negative', representative_exchanges: [{ question: 'Why is Kelly Park so slow in the morning', answer: 'We are studying signal timing.', asker: 'Bob Smith', panelist: 'Jane Doe' }] },
      { topic: 'Safety', qa_count: 1, summary: 'Crossings.', sentiment: 'positive', representative_exchanges: [] },
      { topic: 'Budget', qa_count: 1, summary: 'Funding.', sentiment: 'neutral', representative_exchanges: [{ question: 'Who pays', answer: 'The county, mostly.' }] },
    ],
    decisions: Array.from({ length: 7 }, (_, i) => ({ decision: `Decision number ${i + 1} committed by the panel.`, topic: null })),
    generated_at: '', model: 'test',
  },
  proceedings_summary: {
    overview: 'Staff presented the alignment options and the funding plan.',
    items: [
      { title: 'Alignment options', presenter: 'Jane Doe', what_was_presented: 'Three alignments were shown. The preferred one follows Vick Road.', key_figures: [{ label: 'miles', value: '4.2' }, { label: 'homes affected', value: '18' }, { label: 'x', value: '1' }, { label: 'dropped', value: '0' }], slide_refs: [2, 3] },
      { title: 'Funding', presenter: null, what_was_presented: 'A mix of county and state funds.', key_figures: [], slide_refs: [] },
      { title: 'Timeline', presenter: 'Sam', what_was_presented: 'Construction begins 2027.', key_figures: [], slide_refs: [5] },
    ],
    generated_at: '', model: 'test',
  },
  extractions: [
    ex('qa_pair', 'Traffic', { question: 'why is kelly park so slow in the morning', answer: 'we are studying signal timing', asker_name: 'Bob Smith', panelist_name: 'Jane Doe', question_typology: 'ask', sentiment: 'negative', polished_question: 'Why is Kelly Park so slow in the morning?', polished_answer: 'We are studying signal timing.' }, 0, { start: 600, end: 660 }),
    ex('qa_pair', 'Safety', { question: 'the crossing by the school is dangerous', answer: 'agreed, we will add a signal', asker_name: 'Cy', question_typology: 'complaint', sentiment: 'positive', edited_question: 'The crossing by the school is dangerous.', edited_answer: 'Agreed — we will add a signal.' }, 1, { start: 630, end: 700 }),
    ex('qa_pair', null, { question: 'who pays', answer: 'the county, mostly', question_typology: 'clarification' }, 2, { start: 2400, end: 2450 }),
    ...Array.from({ length: 6 }, (_, i) => ex('action_item', null, { description: `Action item ${i + 1}`, owner: i === 0 ? 'Pat' : null, due_date: i === 0 ? '2026-07-01' : null, edited_description: i === 1 ? 'Edited action two' : null, edited_owner: i === 1 ? 'Quinn' : null }, 10 + i)),
  ],
  entity_map: null,
  source_duration_sec: 3600,
  polished: true,
  draft: true,
}

describe('buildRecordingDeck — rich input', () => {
  it('renders every slide family with Datanautix branding, recounts sentiment from the pairs, and caps overflow', async () => {
    const { slides, all, core } = await open(RICH)
    const text = decode(all)
    expect(core).toMatch(/Datanautix/)
    // title slide: draft watermark, classification, attribution, objective, sign-off
    const title = decode(slides[0])
    expect(title).toContain('DRAFT')
    expect(title).toContain('⚠  DRAFT — PENDING HUMAN REVIEW')
    expect(title).toContain('Community Meeting #2')
    expect(title).toContain('Meeting Report')                                  // has a presentation → not "Q&A Session Report"
    expect(title).toContain('June 16, 2026  ·  Apopka City Hall')
    expect(title).toContain('Prepared by Alex Kim  ·  Datanautix  ·  Config v3')
    expect(title).toContain('Traffic and safety dominate')
    expect(title).toContain('OBJECTIVE')
    expect(title).toContain('Reviewed & approved by Dana Lee')
    expect(text).toContain('Confidential — Client Only')
    expect(text).not.toContain('Proprietary and Confidential')
    // meeting overview + detail cards (2 per slide → 3 items = 2 slides), key figures capped at 3
    expect(text).toContain('Meeting Overview')
    expect(text).toContain('PRESENTED')
    expect(text).toContain('Alignment options')
    expect((text.match(/What Was Presented/g) || []).length).toBe(2)
    expect(text).toContain('KEY FIGURES')
    expect(text).toContain('homes affected')
    expect(text).not.toContain('dropped')
    // executive summary KPIs come from the rendered pairs, not the stale summary
    expect(text).toContain('Executive Summary')
    expect(decode(slides.find(s => s.includes('Executive Summary'))!)).toMatch(/>3<[\s\S]*Questions/)
    expect(text).toContain('Action Items')
    expect(text).toContain('Overall Tone')
    expect(text).toContain('Mixed')
    // sentiment overview recounted: 1 negative, 1 positive, 1 neutral → 33% each; the stale 9/9/9/9 never appears
    const sent = decode(slides.find(s => s.includes('Sentiment Overview'))!)
    expect(sent).toContain('Positive  ·  33%')
    expect(sent).toContain('Mixed  ·  0%')
    expect(sent).not.toContain('>9<')
    // timeline from the timed pairs
    expect(text).toContain('Meeting Timeline')
    expect(text).toContain('3 questions across')
    // themes: 3 topics → 2 slides; representative exchange resolved to the polished pair text; badge counts from pairs
    expect((text.match(/Conversation Themes/g) || []).length).toBe(2)
    expect(text).toContain('REPRESENTATIVE EXCHANGE')
    expect(text).toContain('Q · Bob Smith')
    expect(text).toContain('Why is Kelly Park so slow in the morning?')          // polished, not the verbatim lowercase
    expect(text).toContain('1 question')                                         // Traffic recounted from pairs (summary said 99)
    expect(text).not.toContain('99 questions')
    expect(text).toContain('Negative'); expect(text).toContain('Positive'); expect(text).toContain('Neutral')
    // actions (cap 5 → "+ 1 more") and decisions (cap 6 → "+ 1 more"), edit overlay preferred
    expect(text).toContain('Action Items & Decisions')
    expect(text).toContain('Owner: Pat  ·  Due: 2026-07-01')
    expect(text).toContain('Edited action two')
    expect(text).toContain('Owner: Quinn')
    expect((text.match(/\+ 1 more/g) || []).length).toBe(2)
    expect(text).toContain('Decision number 6')
    expect(text).not.toContain('Decision number 7')
    // appendix divider + one slide per pair, display precedence edited → polished → verbatim
    expect(text).toContain('APPENDIX')
    expect(text).toContain('One slide per question  ·  3 questions')
    expect(text).toContain('Appendix — Q&A 1 of 3')
    expect(text).toContain('Appendix — Q&A 3 of 3')
    expect(text).toContain('QUESTION  ·  Bob Smith')
    expect(text).toContain('RESPONSE  ·  Jane Doe')
    expect(text).toContain('The crossing by the school is dangerous.')
    expect(text).toContain('Agreed — we will add a signal.')
    expect(text).toContain('Clarification')
    // slide arithmetic: title + overview + 2 detail + exec + sentiment + timeline + 2 themes + actions + divider + 3 appendix
    expect(slides).toHaveLength(14)
    // §6 tripwire
    const bad = all.match(/="\d{9,}"/g)?.filter(m => m !== '="4294967295"') || []
    expect(bad).toEqual([])
  })

  it('polished:false renders the verbatim question/answer everywhere', async () => {
    const { all } = await open({ ...RICH, polished: false, draft: false, signoff: null, objectives: null })
    const text = decode(all)
    expect(text).toContain('why is kelly park so slow in the morning')
    expect(text).not.toContain('Why is Kelly Park so slow in the morning?')
    expect(text).toContain('the crossing by the school is dangerous')
    expect(text).not.toContain('PENDING HUMAN REVIEW')
    expect(text).not.toContain('Reviewed & approved')
  })
})

describe('buildRecordingDeck — bare input', () => {
  it('null analysis, no proceedings, no timings → title + appendix only, default classification and report kind', async () => {
    const { slides, all } = await open({
      name: 'Bare session', meeting_date: null, location: null, analysis_summary: null,
      extractions: [ex('qa_pair', 'Other', { question: 'A question?', answer: 'An answer.', question_typology: 'ask' }, 0)],
    })
    const text = decode(all)
    expect(text).toContain('Q&A Session Report')
    expect(text).toContain('Prepared by Datanautix')
    expect(text).toContain('Proprietary and Confidential')
    expect(text).not.toContain('Executive Summary')
    expect(text).not.toContain('Sentiment Overview')
    expect(text).not.toContain('Meeting Timeline')
    expect(text).not.toContain('Conversation Themes')
    expect(text).not.toContain('Action Items & Decisions')
    expect(text).toContain('One slide per question  ·  1 question')
    expect(text).toContain('Neutral')                                             // sentiment defaults when absent
    expect(slides).toHaveLength(3)                                                // title + divider + 1 appendix
  })
  it('no pairs at all → just the title slide', async () => {
    const { slides } = await open({ name: '', meeting_date: null, location: null, analysis_summary: null, extractions: [] })
    expect(slides).toHaveLength(1)
    expect(decode(slides[0])).toContain('Q&A Session')                            // name fallback
  })
})
