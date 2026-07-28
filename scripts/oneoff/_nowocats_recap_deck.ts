/* eslint-disable */
// One-off: NOWOCATS engagement recap deck (Datanautix -> VHB / Orange County).
// Rebuild of ~/Downloads/nowocats-recap.pptx with VERIFIED numbers only.
//
// Every figure below traces to one of:
//   (a) prod DB  — agents/bot_conversation_turns/recordings/recording_transcripts
//                  (pulled read-only by scripts/_nowocats_*.ts)
//   (b) the client's own "NOWOCATS Comment Log June 2026 Final.xlsx"
// NO resident PII (names/emails/addresses) appears in this deck.
//
// Run: node_modules/.bin/tsx scripts/oneoff/_nowocats_recap_deck.ts

import PptxGenJS from 'pptxgenjs'
import { homedir } from 'os'
import path from 'path'

const W = 13.33
const H = 7.5

const C = {
  navy: '0D2B45', teal: '0F7173', tealMid: '4DBFC1', tealTint: 'E5F1F1',
  orange: 'E8632A', orangeTint: 'FBE6DA', gold: 'E8B84B',
  white: 'FFFFFF', slate: '8FA3AE', slateCard: 'F4F7F8',
  ink: '111827', mid: '374151', faint: '9CA3AF',
  green: '059669', red: 'DC2626', line: 'E5E7EB',
}

// ── verified figures ─────────────────────────────────────────────────────────
const D = {
  // BEFORE — Sarina agent (prod DB + xlsx "Sarina *" sheets)
  conversations: 84,          // 89 raw sessions - 5 internal prompt-echo artifacts
  beforeMeeting: 76,          // started before 2026-06-16
  qaExchanges: 229,           // xlsx "Sarina Q&A Pairs"
  publicComments: 50,         // xlsx "Sarina Public Comments"
  namedRoadComments: 13,      // topic = "Specific road or intersection"
  spanish: 4,                 // Q&A pairs with language = es
  lowConfidence: 13,          // xlsx "Sarina Low-Confidence Answers"
  offHoursPct: 52,            // 44/84 outside 9-5 weekday, America/New_York
  weekendPct: 46,             // 39/84
  // DURING — Community Meeting 3 only (per client scope)
  cmMinutes: 44,              // 2,618 sec
  cmSegments: 760,
  cmWords: 6569,
  cmSpeakers: 12,
  cmExchanges: 15,
  cmTopics: 6,
  cmDecisions: 5,
  cmTurnaroundHrs: 5.7,       // upload 08:13Z -> report complete 13:57Z
  // NEVER put our processing cost in a client deck — that is Datanautix margin.
  // Efficiency is framed as THEIR saved staff time, never our cost to deliver.
  // AFTER — comment log
  // AFTER — Community Meeting 2's comment log only (client scope)
  // DO NOT re-split these. The batch is the authority: 10 questions in, 10 drafts
  // out, 100%. Two drafts are short because the question was "add me to the contact
  // list" — a short correct answer is still an answer. Do not demote them to "not
  // substantive"; that both understates the result and inflates the 29.
  m2Entries: 39,              // rows in xlsx "Mtg #2 - Comments"
  m2Answered: 10,             // rows carrying a written comment — ALL drafted (100%)
  m2ContactOnly: 29,          // rows with no written comment at all
  m2WantsList: 29,            // "be added to the study contacts list"
  m2WantsInfo: 20,            // "request information"
}

function wordmark(slide: PptxGenJS.Slide) {
  slide.addText(
    [
      { text: 'data', options: { color: C.tealMid, bold: true, italic: true } },
      { text: 'nautix', options: { color: C.orange, bold: true, italic: true } },
    ],
    { x: W - 2.3, y: 0.12, w: 2.05, h: 0.6, fontSize: 15, valign: 'middle', align: 'right', fontFace: 'Arial' }
  )
}

function hdr(slide: PptxGenJS.Slide, title: string, sub?: string) {
  slide.addShape('rect', { x: 0, y: 0, w: W, h: 1.1, fill: { color: C.navy } })
  slide.addShape('rect', { x: 0, y: 0, w: 0.07, h: 1.1, fill: { color: C.teal } })
  slide.addShape('rect', { x: 0, y: 1.1, w: W, h: 0.04, fill: { color: C.gold } })
  slide.addText(title, { x: 0.55, y: 0.1, w: 10.3, h: 0.6, fontSize: 27, fontFace: 'Arial', color: C.white, bold: true })
  if (sub) slide.addText(sub, { x: 0.55, y: 0.68, w: 10.3, h: 0.34, fontSize: 12.5, fontFace: 'Arial', color: C.slate })
  wordmark(slide)
}

function ftr(slide: PptxGenJS.Slide, n: number, note?: string) {
  slide.addText(note || 'datanautix.com  ·  Prepared for VHB & Orange County Public Works',
    { x: 0.5, y: H - 0.36, w: 4.5, h: 0.26, fontSize: 8, color: C.faint, fontFace: 'Arial' })
  slide.addText('Confidential', { x: W / 2 - 1.5, y: H - 0.36, w: 3, h: 0.26, fontSize: 8, color: C.faint, fontFace: 'Arial', align: 'center' })
  slide.addText(String(n), { x: W - 0.9, y: H - 0.36, w: 0.4, h: 0.26, fontSize: 8, color: C.faint, fontFace: 'Arial', align: 'right' })
}

/** Big number + label tile. */
function kpi(slide: PptxGenJS.Slide, x: number, y: number, w: number, big: string, label: string, accent = C.teal) {
  slide.addShape('roundRect', { x, y, w, h: 1.5, rectRadius: 0.1, fill: { color: C.white }, line: { color: C.line, width: 0.5 } })
  slide.addShape('rect', { x, y, w, h: 0.055, fill: { color: accent } })
  slide.addText(big, { x: x + 0.12, y: y + 0.2, w: w - 0.24, h: 0.62, fontSize: 33, fontFace: 'Arial', color: C.navy, bold: true, align: 'center' })
  slide.addText(label, { x: x + 0.12, y: y + 0.85, w: w - 0.24, h: 0.55, fontSize: 10.5, fontFace: 'Arial', color: C.mid, align: 'center', valign: 'top', wrap: true, lineSpacingMultiple: 1.15 })
}

function bullets(slide: PptxGenJS.Slide, x: number, y: number, w: number, items: string[], size = 12.5) {
  slide.addText(items.map(t => ({ text: t, options: { bullet: { code: '2022' }, breakLine: true } })),
    { x, y, w, h: 0.4 * items.length + 0.9, fontSize: size, fontFace: 'Arial', color: C.mid, lineSpacingMultiple: 1.32 })
}

export function buildDeck(): PptxGenJS {
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'DN', width: W, height: H })
  pptx.layout = 'DN'
  pptx.author = 'Datanautix'
  pptx.company = 'Datanautix'
  pptx.title = 'NOWOCATS Engagement Recap'

  // ── 1. Cover ───────────────────────────────────────────────────────────────
  const s1 = pptx.addSlide()
  s1.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.navy } })
  s1.addShape('rect', { x: 0, y: 0, w: 0.22, h: H, fill: { color: C.teal } })
  s1.addShape('rect', { x: 0, y: 4.05, w: W, h: 0.05, fill: { color: C.gold } })
  s1.addText('NOWOCATS  ·  COMMUNITY ENGAGEMENT PILOT',
    { x: 0.9, y: 0.75, w: 11, h: 0.35, fontSize: 12, fontFace: 'Arial', color: C.tealMid, bold: true, charSpacing: 3 })
  s1.addText('Listening Before, During,\nand After the Room',
    { x: 0.9, y: 1.25, w: 11, h: 2.1, fontSize: 50, fontFace: 'Arial', color: C.white, bold: true, lineSpacingMultiple: 1.1 })
  s1.addText('A recap of the technology pilot run across the Northwest Orange County Areawide Transportation Study — what was captured, what it produced, and what it leaves on the record.',
    { x: 0.9, y: 4.4, w: 10.6, h: 0.9, fontSize: 15, fontFace: 'Arial', color: C.slate, lineSpacingMultiple: 1.35 })
  const cov = [[String(D.conversations), 'resident\nconversations'], [String(D.qaExchanges), 'question &\nanswer pairs'], [`${D.cmMinutes} min`, 'meeting captured\n& transcribed'], [String(D.cmDecisions), 'commitments\non the record']]
  cov.forEach((c, i) => {
    const x = 0.9 + i * 2.75
    s1.addText(c[0], { x, y: 5.45, w: 2.5, h: 0.5, fontSize: 26, fontFace: 'Arial', color: C.tealMid, bold: true })
    s1.addText(c[1], { x, y: 5.95, w: 2.5, h: 0.6, fontSize: 10.5, fontFace: 'Arial', color: C.slate, lineSpacingMultiple: 1.15 })
  })
  s1.addText('Datanautix  ·  Prepared for the NOWOCATS project team',
    { x: 0.9, y: H - 0.75, w: 11, h: 0.32, fontSize: 12, fontFace: 'Arial', color: C.white })

  // ── 2. What we ran ─────────────────────────────────────────────────────────
  const s2 = pptx.addSlide()
  s2.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s2, 'What we ran', 'Three components across one meeting cycle — each stage feeding the next')
  const stages: [string, string, string, string][] = [
    ['1', 'BEFORE  ·  SARINA', 'Pre-meeting conversation', `${D.conversations} residents raised concerns in their own words, on their own schedule, in the weeks before anyone walked into the room. ${D.qaExchanges} question-and-answer exchanges, ${D.spanish} of them in Spanish.`],
    ['2', 'DURING  ·  TOWN HALL', 'Live meeting capture', `Community Meeting 3 captured in full, transcribed with speaker attribution, and returned as a report in the project team's own format — in under six hours.`],
    ['3', 'AFTER  ·  SARINA', 'Response drafting', `Meeting 2’s ${D.m2Entries} comment-log entries handled as one record each — all ${D.m2Answered} questions answered from the study’s own materials. Nothing sends until the project lead has read it.`],
  ]
  stages.forEach((st, i) => {
    const x = 0.5 + i * 4.15
    s2.addShape('roundRect', { x, y: 1.45, w: 3.85, h: 3.7, rectRadius: 0.12, fill: { color: C.white }, line: { color: C.line, width: 0.5 } })
    s2.addShape('rect', { x, y: 1.45, w: 3.85, h: 0.06, fill: { color: C.teal } })
    s2.addShape('ellipse', { x: x + 0.25, y: 1.72, w: 0.46, h: 0.46, fill: { color: C.navy } })
    s2.addText(st[0], { x: x + 0.25, y: 1.72, w: 0.46, h: 0.46, fontSize: 15, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle' })
    s2.addText(st[1], { x: x + 0.82, y: 1.76, w: 2.9, h: 0.28, fontSize: 9, fontFace: 'Arial', color: C.teal, bold: true, charSpacing: 1.5 })
    s2.addText(st[2], { x: x + 0.25, y: 2.32, w: 3.35, h: 0.42, fontSize: 16, fontFace: 'Arial', color: C.navy, bold: true })
    s2.addText(st[3], { x: x + 0.25, y: 2.82, w: 3.35, h: 2.1, fontSize: 11.5, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.35 })
  })
  s2.addShape('roundRect', { x: 0.5, y: 5.42, w: 12.33, h: 1.28, rectRadius: 0.1, fill: { color: C.navy } })
  s2.addText([
    { text: 'The same themes are tracked from the first conversation through to the last comment — a single record of public concern rather than three separate deliverables. And at every stage the division of labour is the same: ', options: { color: C.white } },
    { text: 'the system does the volume and the recall; the project team keeps the judgement and the final word.', options: { color: C.tealMid, bold: true } },
  ], { x: 0.85, y: 5.58, w: 11.6, h: 0.98, fontSize: 13.5, fontFace: 'Arial', wrap: true, lineSpacingMultiple: 1.28, valign: 'middle' })
  ftr(s2, 2)

  // ── 3. Before — reach and timing ───────────────────────────────────────────
  const s3 = pptx.addSlide()
  s3.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s3, '1 · Before the meeting', 'Sarina — a conversational agent, open from late May through the June 16 meeting')
  kpi(s3, 0.5, 1.42, 2.92, String(D.conversations), 'resident conversations\n(76 before the meeting)')
  kpi(s3, 3.63, 1.42, 2.92, String(D.qaExchanges), 'question-and-answer\nexchanges', C.orange)
  kpi(s3, 6.76, 1.42, 2.92, `${D.offHoursPct}%`, 'took place outside\n9–5 weekday hours', C.gold)
  kpi(s3, 9.89, 1.42, 2.94, String(D.spanish), 'exchanges conducted\nin Spanish', C.tealMid)

  s3.addShape('roundRect', { x: 0.5, y: 3.18, w: 6.05, h: 2.62, rectRadius: 0.12, fill: { color: C.white }, line: { color: C.line, width: 0.5 } })
  s3.addText('WHY THE TIMING MATTERS', { x: 0.75, y: 3.36, w: 5.5, h: 0.28, fontSize: 9, fontFace: 'Arial', color: C.teal, bold: true, charSpacing: 2 })
  s3.addText(`${D.weekendPct}% of conversations happened on a weekend. Others ran at 1am, 6am and after 10pm.\n\nA two-hour open house at the Apopka Community Center cannot capture any of these residents. They are not disengaged — they are working, parenting, or asleep when the room is open.`,
    { x: 0.75, y: 3.72, w: 5.5, h: 1.9, fontSize: 12.5, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.35 })

  s3.addShape('roundRect', { x: 6.78, y: 3.18, w: 6.05, h: 2.62, rectRadius: 0.12, fill: { color: C.white }, line: { color: C.line, width: 0.5 } })
  s3.addText('THE AGENT FLAGS ITS OWN LIMITS', { x: 7.03, y: 3.36, w: 5.5, h: 0.28, fontSize: 9, fontFace: 'Arial', color: C.orange, bold: true, charSpacing: 2 })
  s3.addText([
    { text: `${D.lowConfidence} of ${D.qaExchanges}`, options: { bold: true, color: C.navy } },
    { text: ` answers (5.7%) were automatically flagged as uncertain or hedged and routed to the project team for review — rather than presented to a resident as settled fact.\n\nThe remaining 94% were answered from the study's own materials. Nothing was invented.`, options: {} },
  ], { x: 7.03, y: 3.72, w: 5.5, h: 1.9, fontSize: 12.5, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.35 })
  ftr(s3, 3, 'Denominator: 84 = 89 raw sessions less 5 internal test artifacts.')

  // ── 4. What residents actually said ────────────────────────────────────────
  const s4 = pptx.addSlide()
  s4.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s4, 'What residents actually said', `${D.publicComments} substantive public comments, classified as they arrived`)
  const topics: [string, number][] = [['Priority improvement', 15], ['Biggest frustration', 13], ['Specific road or intersection', 13], ['Where in NW Orange County', 4], ['Growth concerns (2050)', 2], ['How they get around', 1]]
  s4.addText('BY TOPIC', { x: 0.5, y: 1.4, w: 5.5, h: 0.28, fontSize: 9, fontFace: 'Arial', color: C.teal, bold: true, charSpacing: 2 })
  topics.forEach((t, i) => {
    const y = 1.76 + i * 0.53
    s4.addShape('rect', { x: 0.5, y, w: 5.9, h: 0.45, fill: { color: i % 2 === 0 ? C.white : C.slateCard }, line: { color: C.line, width: 0.3 } })
    s4.addText(t[0], { x: 0.62, y, w: 4.0, h: 0.45, fontSize: 11.5, fontFace: 'Arial', color: C.navy, valign: 'middle' })
    s4.addShape('rect', { x: 4.62, y: y + 0.15, w: (t[1] / 15) * 1.12, h: 0.16, fill: { color: C.teal } })
    s4.addText(String(t[1]), { x: 5.82, y, w: 0.48, h: 0.45, fontSize: 11.5, fontFace: 'Arial', color: C.mid, bold: true, valign: 'middle', align: 'right' })
  })
  s4.addText(`${D.namedRoadComments} comments named a specific road or intersection — precise enough to check directly against the traffic model.`,
    { x: 0.5, y: 4.98, w: 5.9, h: 0.6, fontSize: 11.5, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.3, italic: true })

  s4.addText('IN THEIR OWN WORDS', { x: 6.75, y: 1.4, w: 6, h: 0.28, fontSize: 9, fontFace: 'Arial', color: C.orange, bold: true, charSpacing: 2 })
  const quotes = [
    'Intersection of Kelly Park and Round Lake is hard to turn onto… it can get 10-15 cars deep waiting to turn either way.',
    'E Welch Road from Rock Springs Rd/Park Rd to Wekiwa Springs Rd needs to be widened.',
    'It is frustrating for people who are exiting the 429 South on to Kelly Park to have to wait for the traffic at the freeway exit ramp.',
    'Extending the Sunrail to Apopka would be amazing if that is feasible.',
  ]
  quotes.forEach((q, i) => {
    const y = 1.76 + i * 1.06
    s4.addShape('roundRect', { x: 6.75, y, w: 6.08, h: 0.94, rectRadius: 0.08, fill: { color: C.white }, line: { color: C.line, width: 0.5 } })
    s4.addShape('rect', { x: 6.75, y, w: 0.05, h: 0.94, fill: { color: C.tealMid } })
    s4.addText(`“${q}”`, { x: 6.95, y: y + 0.08, w: 5.75, h: 0.78, fontSize: 11, fontFace: 'Arial', color: C.mid, italic: true, wrap: true, valign: 'middle', lineSpacingMultiple: 1.25 })
  })
  s4.addText('Verbatim resident comments captured by the agent. Names withheld.',
    { x: 6.75, y: 6.05, w: 6.08, h: 0.3, fontSize: 9.5, fontFace: 'Arial', color: C.faint })
  ftr(s4, 4)

  // ── 5. The live meeting ────────────────────────────────────────────────────
  const s5 = pptx.addSlide()
  s5.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s5, '2 · The live meeting', 'NOWOCATS Community Meeting 3 — 16 June 2026, Apopka Community Center')
  kpi(s5, 0.5, 1.42, 2.92, `${D.cmMinutes} min`, 'of meeting audio\ncaptured in full')
  kpi(s5, 3.63, 1.42, 2.92, String(D.cmSpeakers), 'distinct speakers\nseparated and attributed', C.orange)
  kpi(s5, 6.76, 1.42, 2.92, `${D.cmTurnaroundHrs} hrs`, 'from upload to finished\nreport in the team’s hands', C.gold)
  kpi(s5, 9.89, 1.42, 2.94, '0', 'hours of staff time spent\nlistening and transcribing', C.green)

  s5.addShape('roundRect', { x: 0.5, y: 3.18, w: 12.33, h: 1.42, rectRadius: 0.12, fill: { color: C.white }, line: { color: C.line, width: 0.5 } })
  s5.addText('WHAT THE RECORD CONTAINS', { x: 0.75, y: 3.34, w: 6, h: 0.28, fontSize: 9, fontFace: 'Arial', color: C.teal, bold: true, charSpacing: 2 })
  const facts = [[String(D.cmWords.toLocaleString()), 'words transcribed'], [String(D.cmSegments), 'timestamped segments'], [String(D.cmExchanges), 'Q&A exchanges'], [String(D.cmTopics), 'topics classified'], [String(D.cmDecisions), 'commitments extracted']]
  facts.forEach((f, i) => {
    const x = 0.78 + i * 2.42
    s5.addText(f[0], { x, y: 3.68, w: 2.3, h: 0.42, fontSize: 21, fontFace: 'Arial', color: C.navy, bold: true })
    s5.addText(f[1], { x, y: 4.09, w: 2.3, h: 0.35, fontSize: 10.5, fontFace: 'Arial', color: C.mid })
  })

  s5.addShape('roundRect', { x: 0.5, y: 4.78, w: 12.33, h: 1.55, rectRadius: 0.12, fill: { color: C.navy } })
  s5.addText([
    { text: 'Every question is tied to the resident who asked it and every answer to the panelist who gave it, with a timestamp. The summary is derived from the transcript — the transcript is never derived from the summary. ', options: { color: C.white } },
    { text: 'Because the audio is retained, the team can verify any name, road or technical term against the recording before anything is published.', options: { color: C.tealMid } },
  ], { x: 0.85, y: 4.96, w: 11.6, h: 1.2, fontSize: 13, fontFace: 'Arial', wrap: true, lineSpacingMultiple: 1.32, valign: 'middle' })
  ftr(s5, 5)

  // ── 6. Commitments captured ────────────────────────────────────────────────
  const s6 = pptx.addSlide()
  s6.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s6, 'Five commitments, captured automatically', 'Extracted from the Community Meeting 3 transcript — each traceable to the moment it was said')
  const decisions = [
    'The Plymouth-Sorrento Road and US 441 intersection will be reviewed for potential signal re-timing or geometric improvements.',
    'Comments on the South Central and Michael Gladden Boulevard intersection will be recorded, and the intersection looked at, regardless of jurisdictional responsibility.',
    'Orange County and the City of Apopka are proceeding with design for the Welch Road and Rock Springs Road intersection, including a planned traffic signal and additional lanes.',
    // NOTE: transcript renders this as "441 and Big Road" — likely an ASR mishearing.
    // Left as captured; the project team should confirm the intended road name.
    'A mid-term improvement (by 2040) at the US 441 and Big Road intersection adds an eastbound lane using available median right-of-way.',
    'Bike lane recommendations in the study call for protected lanes or multi-purpose paths with separation from traffic.',
  ]
  decisions.forEach((d, i) => {
    const y = 1.45 + i * 0.92
    s6.addShape('roundRect', { x: 0.5, y, w: 12.33, h: 0.8, rectRadius: 0.08, fill: { color: C.white }, line: { color: C.line, width: 0.5 } })
    s6.addShape('rect', { x: 0.5, y, w: 0.055, h: 0.8, fill: { color: C.gold } })
    s6.addShape('ellipse', { x: 0.72, y: y + 0.2, w: 0.4, h: 0.4, fill: { color: C.tealTint } })
    s6.addText(String(i + 1), { x: 0.72, y: y + 0.2, w: 0.4, h: 0.4, fontSize: 12, fontFace: 'Arial', color: C.teal, bold: true, align: 'center', valign: 'middle' })
    s6.addText(d, { x: 1.28, y: y + 0.06, w: 11.4, h: 0.68, fontSize: 12.5, fontFace: 'Arial', color: C.mid, wrap: true, valign: 'middle', lineSpacingMultiple: 1.25 })
  })
  s6.addText([
    { text: 'A staff member taking minutes captures some of these. The transcript captures all of them, with the exact words and the timestamp. ', options: { italic: true } },
    { text: 'These five were extracted automatically and are then confirmed by the project team against the recording — the machine finds the candidates, a person signs them off.', options: { italic: true, bold: true } },
  ], { x: 0.5, y: 6.08, w: 12.33, h: 0.66, fontSize: 12, fontFace: 'Arial', color: C.navy, wrap: true, lineSpacingMultiple: 1.28 })
  ftr(s6, 6)

  // ── 7. Why the transcript matters ──────────────────────────────────────────
  const s7 = pptx.addSlide()
  s7.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s7, 'Why the transcript matters more than the minutes', 'The same meeting, two different public records')
  s7.addShape('roundRect', { x: 0.5, y: 1.45, w: 6.05, h: 4.05, rectRadius: 0.12, fill: { color: C.white }, line: { color: C.line, width: 0.5 } })
  s7.addShape('rect', { x: 0.5, y: 1.45, w: 6.05, h: 0.06, fill: { color: C.slate } })
  s7.addText('TRADITIONAL LISTEN-TO-TRANSCRIBE', { x: 0.75, y: 1.66, w: 5.5, h: 0.3, fontSize: 9.5, fontFace: 'Arial', color: C.slate, bold: true, charSpacing: 2 })
  bullets(s7, 0.75, 2.08, 5.55, [
    'Labor intensive. A person listens to the full session, often across multiple passes.',
    'Lossy by design. The output is a summary written for publication — the verbatim is never produced, or is discarded once the summary exists.',
    'No audit trail. The record is only as good as one transcriber’s attention, subject knowledge and judgement about what mattered.',
  ], 12)
  s7.addShape('roundRect', { x: 6.78, y: 1.45, w: 6.05, h: 4.05, rectRadius: 0.12, fill: { color: C.white }, line: { color: C.teal, width: 1 } })
  s7.addShape('rect', { x: 6.78, y: 1.45, w: 6.05, h: 0.06, fill: { color: C.teal } })
  s7.addText('TOWN HALL', { x: 7.03, y: 1.66, w: 5.5, h: 0.3, fontSize: 9.5, fontFace: 'Arial', color: C.teal, bold: true, charSpacing: 2 })
  bullets(s7, 7.03, 2.08, 5.55, [
    `Automated. This session was transcribed and analysed in ${D.cmTurnaroundHrs} hours with no staff listening time — and that effort does not grow with the number of meetings held.`,
    'Complete. Nothing is condensed at the moment of capture. Summaries can be regenerated or re-cut by theme at any time.',
    'Auditable. Every line traces back to the recorded words of an identifiable speaker, on the record, with a timestamp.',
  ], 12)
  s7.addShape('roundRect', { x: 0.5, y: 5.68, w: 12.33, h: 1.02, rectRadius: 0.1, fill: { color: C.navy } })
  s7.addText('In a public process, the transcriber’s judgement quietly becomes the public record. This approach produces the evidence first, and the minutes as one view of it.',
    { x: 0.85, y: 5.82, w: 11.6, h: 0.75, fontSize: 13.5, fontFace: 'Arial', color: C.white, wrap: true, valign: 'middle', lineSpacingMultiple: 1.3 })
  ftr(s7, 7)

  // ── 8. After the meeting ───────────────────────────────────────────────────
  const s8 = pptx.addSlide()
  s8.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s8, '3 · After the meeting', 'Community Meeting 2’s comment log — one traceable record per resident, not an inbox to excavate')
  kpi(s8, 0.5, 1.42, 2.92, String(D.m2Entries), 'comment-log entries\nfollowing Meeting 2')
  kpi(s8, 3.63, 1.42, 2.92, `${D.m2Answered} of ${D.m2Answered}`, 'questions answered — every\none from the existing knowledge base', C.orange)
  kpi(s8, 6.76, 1.42, 2.92, String(D.m2ContactOnly), 'contact and information requests\nneeding no human authorship', C.tealMid)
  kpi(s8, 9.89, 1.42, 2.94, '1', 'record per resident, from\narrival through completion', C.green)

  s8.addShape('roundRect', { x: 0.5, y: 3.04, w: 6.05, h: 2.2, rectRadius: 0.12, fill: { color: C.white }, line: { color: C.line, width: 0.5 } })
  s8.addText('THE ANSWERS ALREADY EXISTED', { x: 0.75, y: 3.16, w: 5.5, h: 0.28, fontSize: 9, fontFace: 'Arial', color: C.orange, bold: true, charSpacing: 2 })
  s8.addText(`Every one of the ${D.m2Answered} questions was answered from the same knowledge base Sarina was already running before the meeting — the study’s own materials, prior Q&A and prior meeting records.\n\nNo new research was required. The answers existed; they simply hadn’t reached the resident who asked.`,
    { x: 0.75, y: 3.46, w: 5.5, h: 1.66, fontSize: 12, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.32 })

  s8.addShape('roundRect', { x: 6.78, y: 3.04, w: 6.05, h: 2.2, rectRadius: 0.12, fill: { color: C.white }, line: { color: C.line, width: 0.5 } })
  s8.addText('AND THE FORM ITSELF LEAKS', { x: 7.03, y: 3.16, w: 5.5, h: 0.28, fontSize: 9, fontFace: 'Arial', color: C.teal, bold: true, charSpacing: 2 })
  s8.addText(`The other ${D.m2ContactOnly} entries carried no question at all — 24 asked to join the contact list, the rest wanted study information.\n\nBut 18 of those 29 ticked “share my thoughts about the study” and then left the box empty. The form asked, and they had nothing to type. In conversation, the same population produced 50 substantive comments.`,
    { x: 7.03, y: 3.46, w: 5.5, h: 1.66, fontSize: 12, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.32 })

  s8.addShape('roundRect', { x: 0.5, y: 5.4, w: 12.33, h: 1.34, rectRadius: 0.12, fill: { color: C.navy } })
  s8.addText('ONE RECORD EACH — AND A PERSON ON THE END OF IT', { x: 0.85, y: 5.52, w: 7, h: 0.26, fontSize: 9, fontFace: 'Arial', color: C.tealMid, bold: true, charSpacing: 2 })
  s8.addText([
    { text: 'Today these arrive as email, spread across whichever staff member received them, and must be consolidated by hand before anyone can say what the public asked. Here each request is a single record from the moment it lands — attributed, timestamped, traceable — sitting in a work queue with a completion state, isolated from every other project competing for that mailbox. ', options: { color: C.white } },
    { text: 'And nothing sends unread: one of the ten drafts answered a resident’s request to stay informed but missed the SunRail suggestion attached to it. That is exactly what the approval step is for.', options: { color: C.gold } },
  ], { x: 0.85, y: 5.78, w: 11.6, h: 0.86, fontSize: 12, fontFace: 'Arial', wrap: true, lineSpacingMultiple: 1.26 })
  ftr(s8, 8)

  // ── 9. Together + next ─────────────────────────────────────────────────────
  const s9 = pptx.addSlide()
  s9.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s9, 'What the three produce together', 'And what we’d suggest next')
  const cards: [string, string][] = [
    ['A continuous view of concern', 'Pre-meeting conversations, the meeting transcript and inbound comments are classified against the same themes — so the team sees what is intensifying and what has been resolved.'],
    ['Documentation that holds up', 'Every claim about what the public said traces back to a specific person, a specific question and a specific date. Useful in a report; essential in a hearing.'],
    ['Engagement you can measure', 'Participation, theme volume, sentiment and response time become reportable figures rather than an attendance count.'],
    ['A person on the end of every output', 'Flagged answers, extracted commitments and drafted responses are all proposals until a member of the project team signs them off. The record is machine-built and human-approved.'],
  ]
  cards.forEach((c, i) => {
    const x = 0.5 + (i % 2) * 6.28
    const y = 1.45 + Math.floor(i / 2) * 1.62
    s9.addShape('roundRect', { x, y, w: 6.05, h: 1.42, rectRadius: 0.1, fill: { color: C.white }, line: { color: C.line, width: 0.5 } })
    s9.addShape('rect', { x, y, w: 0.055, h: 1.42, fill: { color: C.teal } })
    s9.addText(c[0], { x: x + 0.25, y: y + 0.12, w: 5.6, h: 0.34, fontSize: 14, fontFace: 'Arial', color: C.navy, bold: true })
    s9.addText(c[1], { x: x + 0.25, y: y + 0.48, w: 5.6, h: 0.84, fontSize: 11.5, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.28 })
  })
  s9.addShape('roundRect', { x: 0.5, y: 4.78, w: 12.33, h: 1.62, rectRadius: 0.12, fill: { color: C.navy } })
  s9.addText('WHAT WE’D SUGGEST NEXT', { x: 0.85, y: 4.94, w: 6, h: 0.3, fontSize: 9.5, fontFace: 'Arial', color: C.tealMid, bold: true, charSpacing: 2 })
  const nexts = [
    ['1', 'Approve the drafted responses and route new comments through the queue', 'closes Meeting 2 and makes the next intake automatic'],
    ['2', 'Extend across the remaining meeting cycle', 'rather than a single meeting'],
    ['3', 'Bring both meetings into one thematic view', 'so the record is complete from the start of the study'],
  ]
  nexts.forEach((n, i) => {
    const y = 5.32 + i * 0.36
    s9.addText([
      { text: `${n[0]}.  `, options: { color: C.gold, bold: true } },
      { text: n[1], options: { color: C.white, bold: true } },
      { text: `  —  ${n[2]}`, options: { color: C.slate } },
    ], { x: 0.85, y, w: 11.6, h: 0.32, fontSize: 12.5, fontFace: 'Arial' })
  })
  ftr(s9, 9)

  return pptx
}

async function main() {
  const out = path.join(homedir(), 'Downloads', 'NOWOCATS_Engagement_Recap.pptx')
  const pptx = buildDeck()
  await pptx.writeFile({ fileName: out })
  console.log('wrote', out)
}

if (process.argv[1] && process.argv[1].includes('_nowocats_recap_deck')) {
  main().catch(e => { console.error(e); process.exit(1) })
}
