// One-off deck: Regret framework survey design for Dr. Sunil Contractor.
// Run: npx tsx scripts/_regret_framework_deck.ts
// Output: ~/Downloads/Regret-Framework-Survey-Design.pptx

import PptxGenJS from 'pptxgenjs'
import os from 'os'
import path from 'path'

const W = 13.33
const H = 7.5

const C = {
  navy:        '0D2B45',
  teal:        '0F7173',
  tealMid:     '4DBFC1',
  tealLight:   'E0F0F0',
  tealTint:    'E5F1F1',
  orange:      'E8632A',
  orangeTint:  'FBE6DA',
  gold:        'E8B84B',
  white:       'FFFFFF',
  slate:       '8FA3AE',
  slateCard:   'F4F7F8',
  ink:         '111827',
  mid:         '374151',
  faint:       '9CA3AF',
  green:       '059669',
  red:         'DC2626',
  purple:      '7C3AED',
  purpleTint:  'F4EFFC',
  border:      'E5E7EB',
}

function hdr(slide: any, title: string, sub?: string) {
  slide.addShape('rect', { x: 0, y: 0, w: W, h: 1.1, fill: { color: C.navy } })
  slide.addShape('rect', { x: 0, y: 0, w: 0.07, h: 1.1, fill: { color: C.teal } })
  slide.addShape('rect', { x: 0, y: 1.1, w: W, h: 0.04, fill: { color: C.gold } })
  slide.addText(title, { x: 0.55, y: 0.1, w: 10.5, h: 0.6, fontSize: 26, fontFace: 'Arial', color: C.white, bold: true })
  if (sub) slide.addText(sub, { x: 0.55, y: 0.66, w: 10.5, h: 0.34, fontSize: 13, fontFace: 'Arial', color: C.tealLight })
}

function ftr(slide: any, n: number) {
  slide.addText('Prepared for Dr. Sunil Contractor  ·  Discussion draft', { x: 0.5, y: H - 0.36, w: 7, h: 0.26, fontSize: 8, color: C.faint, fontFace: 'Arial' })
  slide.addText(String(n), { x: W - 0.9, y: H - 0.36, w: 0.4, h: 0.26, fontSize: 8, color: C.faint, fontFace: 'Arial', align: 'right' })
}

function card(slide: any, x: number, y: number, w: number, h: number, title: string, body: string, accent = C.teal) {
  slide.addShape('roundRect', { x, y, w, h, rectRadius: 0.1, fill: { color: C.white }, line: { color: C.border, width: 0.5 } })
  slide.addShape('rect', { x, y, w: 0.06, h, fill: { color: accent } })
  slide.addText(title, { x: x + 0.22, y: y + 0.12, w: w - 0.38, h: 0.42, fontSize: 14, fontFace: 'Arial', color: C.navy, bold: true })
  slide.addText(body, { x: x + 0.22, y: y + 0.55, w: w - 0.38, h: h - 0.7, fontSize: 12, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.35, valign: 'top' })
}

function quietCard(slide: any, x: number, y: number, w: number, h: number, body: string, color = C.tealTint) {
  slide.addShape('roundRect', { x, y, w, h, rectRadius: 0.08, fill: { color }, line: { color: C.border, width: 0.3 } })
  slide.addText(body, { x: x + 0.18, y: y + 0.12, w: w - 0.36, h: h - 0.24, fontSize: 12, fontFace: 'Arial', color: C.ink, wrap: true, lineSpacingMultiple: 1.35, valign: 'top' })
}

const pptx = new PptxGenJS()
pptx.layout = 'LAYOUT_WIDE'
pptx.author = 'Datanautix'
pptx.title  = 'Regret Framework Survey Design'
let p = 0

// ──────────────────────────────────────────────────────────────────────────
// Slide 1 — Title
{
  const s = pptx.addSlide(); p++
  s.background = { color: C.navy }
  s.addShape('rect', { x: 0, y: 0, w: 0.16, h: H, fill: { color: C.teal } })
  s.addShape('rect', { x: 0, y: H - 0.5, w: W, h: 0.08, fill: { color: C.gold } })
  s.addText('Empirically Testing the Comparative Evaluation Framework', {
    x: 0.9, y: 2.4, w: 11.5, h: 1.2, fontSize: 34, fontFace: 'Arial', color: C.white, bold: true,
  })
  s.addText('A conversational survey design to elicit upward behavioral counterfactuals — without naming them', {
    x: 0.9, y: 3.65, w: 11.5, h: 0.8, fontSize: 17, fontFace: 'Arial', color: C.tealLight, italic: true,
  })
  s.addText('Prepared for Dr. Sunil Contractor', { x: 0.9, y: 5.4, w: 11.5, h: 0.4, fontSize: 15, fontFace: 'Arial', color: C.gold })
  s.addText('Discussion draft  ·  Datanautix / Sentimetrx  ·  May 2026', { x: 0.9, y: 5.85, w: 11.5, h: 0.4, fontSize: 11, fontFace: 'Arial', color: C.slate })
  s.addNotes(
    `Goal of this conversation: get Contractor's reaction to an instrument that operationalizes his framework directly, rather than re-using legacy regret scales that conflate self-blame with regret. We are not pitching a product — we are proposing a research-grade instrument and asking him whether it would generate evidence he would find compelling.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 2 — Why this exists
{
  const s = pptx.addSlide(); p++
  hdr(s, 'Why this instrument', 'The paper proposes a generative mechanism. Existing scales measure correlates of it.')
  card(s, 0.55, 1.45, 4.0, 2.4, 'The gap',
    'Most regret scales measure self-blame, dissatisfaction, or "would you decide differently." Per the paper, none of these is the mechanism. They co-occur with regret without producing it.', C.red)
  card(s, 4.75, 1.45, 4.0, 2.4, 'What we need',
    'An instrument that detects whether a respondent constructs an upward behavioral counterfactual (UBC), and at what magnitude — without supplying one or priming valence.', C.teal)
  card(s, 8.95, 1.45, 4.0, 2.4, 'Why conversational',
    'Open-ended response with adaptive drill-down is the only way to surface a respondent\'s own counterfactual without naming it for them. Sentimetrx\'s Sarina is built for this.', C.purple)

  s.addShape('roundRect', { x: 0.55, y: 4.15, w: 12.4, h: 2.7, rectRadius: 0.1, fill: { color: C.tealTint }, line: { color: C.border, width: 0.3 } })
  s.addText('In one sentence', { x: 0.85, y: 4.3, w: 11.8, h: 0.4, fontSize: 13, fontFace: 'Arial', color: C.teal, bold: true })
  s.addText(
    'If regret is generated by upward behavioral counterfactual thinking, the right measurement question is not "how much do you regret it?" but "does an action-linked superior alternative come to mind unprompted, and how big is the gap?" — and that requires a survey built around silence and mirroring, not Likert scales.',
    { x: 0.85, y: 4.7, w: 11.8, h: 2.0, fontSize: 15, fontFace: 'Arial', color: C.ink, italic: true, wrap: true, lineSpacingMultiple: 1.4 }
  )
  ftr(s, p)
  s.addNotes(
    `The pitch in plain terms: existing instruments are testing the wrong thing. They show that self-blame correlates with reported regret, but per the paper this is because both co-occur with UBC — not because self-blame causes regret. To distinguish co-occurrence from causation we need an instrument that captures UBC directly, and that means open-ended elicitation, not rating scales.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 3 — Core thesis recap
{
  const s = pptx.addSlide(); p++
  hdr(s, 'The paper in one slide', 'Contractor (2026): regret is a comparative evaluation process, not an attributional one')
  card(s, 0.55, 1.45, 6.15, 2.55, 'Generative mechanism', 'Regret is generated by upward behavioral counterfactual thinking (UBC) — mentally constructing an alternative action that would have produced a superior attainable outcome.', C.teal)
  card(s, 6.85, 1.45, 6.15, 2.55, 'What it is NOT', 'Self-blame, internal attribution, and decision responsibility are neither necessary nor sufficient. They may co-occur with regret but do not generate it.', C.red)

  card(s, 0.55, 4.15, 4.0, 2.55, 'Direction (P3a/b)', 'Upward counterfactuals amplify regret. Downward counterfactuals attenuate it. Intensity scales with the magnitude of the comparative gap (P3c).', C.orange)
  card(s, 4.75, 4.15, 4.0, 2.55, 'Three responsibilities (P4)', 'Decision responsibility attenuates regret when outcomes are reversible. Management responsibility amplifies it. Outcome responsibility (self-blame) has no independent effect.', C.purple)
  card(s, 8.95, 4.15, 4.0, 2.55, 'Filtering (P4b, §4.5)', 'Confirmatory bias and post-outcome justification determine whether upward counterfactuals are constructed, maintained, or suppressed in the first place.', C.navy)

  ftr(s, p)
  s.addNotes(
    `This slide is a fidelity check — if Contractor disagrees with any framing here, the rest of the deck doesn't matter. The four cards map to: §3-4 (mechanism), §4.6 (what it's not), Propositions 3a-3c (direction & magnitude), Propositions 4a-4e (responsibility forms), §4.5 (filtering).`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 4 — Design constraints
{
  const s = pptx.addSlide(); p++
  hdr(s, 'Four design constraints', 'Translated from the paper\'s spirit into rules the instrument must honor')

  card(s, 0.55, 1.45, 6.15, 2.55, '1. Do not prime "regret"',
    'The word and its synonyms (wish, should, mistake) bias the construct we are measuring. Let the respondent reveal counterfactuals unprompted — or reveal that none come to mind.', C.red)
  card(s, 6.85, 1.45, 6.15, 2.55, '2. Do not lead with responsibility',
    'Asking "whose fault" or "how much control did you have" reproduces the attribution-theory misframe the paper retires. Capture decision vs management role behaviorally, not evaluatively.', C.orange)
  card(s, 0.55, 4.15, 6.15, 2.55, '3. Do not supply alternatives',
    'If we name foregone options for the respondent, we contaminate the explicit-foregone vs imagined-retrospective distinction (P2a vs P2b) — one of the framework\'s core empirical claims.', C.teal)
  card(s, 6.85, 4.15, 6.15, 2.55, '4. Echo, don\'t suggest',
    'Drill-downs mirror the respondent\'s own nouns and verbs to surface UBCs without inventing them. The AI never proposes an action the respondent has not themselves named.', C.purple)
  ftr(s, p)
  s.addNotes(
    `These four constraints are the difference between an instrument that tests the paper's propositions and one that smuggles in the assumptions the paper is arguing against. Every design decision downstream descends from these.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 5 — The platform
{
  const s = pptx.addSlide(); p++
  hdr(s, 'The platform: Sentimetrx + Sarina', 'A conversational survey engine with an AI clarifier already built for adaptive open-ended drill-down')

  card(s, 0.55, 1.45, 6.15, 2.55, 'Sarina (AI clarifier)',
    'Generates a follow-up only when the answer is vague or invites probing. Sees the prior answer, sentiment, and any rating; can return SKIP if the answer is already sufficient. Capped at 25 words per probe.', C.teal)
  card(s, 6.85, 1.45, 6.15, 2.55, 'Open-ended question support',
    'Open questions accept AI follow-ups (useAI: true) with per-session cap (maxClarifierCount, default 5). Likert questions support per-response branching follow-ups. Skip-logic available at the survey level.', C.purple)

  card(s, 0.55, 4.15, 6.15, 2.55, 'Guardrails already in place',
    'Input/output safety filters, refusal detection, prompt-leak sanitization, multi-language (16 languages), partial-save on every turn. PII detection is the one gap (not needed for this study).', C.orange)
  card(s, 6.85, 4.15, 6.15, 2.55, 'What we need to add',
    'A study-scoped system-prompt augmentation: ~5 neutrality clauses telling Sarina to avoid the words regret / wish / should / blame / responsibility, and to never propose alternatives the respondent has not named.', C.gold)
  ftr(s, p)
  s.addNotes(
    `Important to convey: 90% of what this instrument needs already exists in production. The new development surface is a small study-scoped prompt augmentation, not a new product. That means we can be in field within weeks of design lock.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 6 — Construct → capability map
{
  const s = pptx.addSlide(); p++
  hdr(s, 'Construct → instrument mapping', 'Each paper construct maps to a specific Sarina mechanism')

  const rows: [string, string, string][] = [
    ['Realized outcome',                       'Open Q (Q2), AI drill on vagueness only',          'Establishes facts before any counterfactual surfaces'],
    ['Upward behavioral counterfactual (P1a)', 'Open Q (Q3), AI drill via verbatim-echo matrix',    'The core elicitation — silence-tolerant'],
    ['Foregone vs imagined (P2a/2b)',          'Second drill turn on Q3',                           '"Considered at the time, or come up since?"'],
    ['Direction (P3a/b)',                       'Sentiment + Q3 coding',                            'Direction emerges from language, not asked'],
    ['Magnitude (P3c)',                         'Likert anchored to respondent\'s own comparison',   'Only shown if Q3 surfaced an alternative'],
    ['Decision vs management role (P4a/c)',    'Q5 behavioral framing',                            '"Did you make the call, carry it out, both?"'],
    ['Reversibility (P4a moderator)',          'Q6 single open',                                   '"Still room to change or revisit?"'],
    ['Confirmatory bias / justification',      'Q3 conditional probe + Q7 open close',             'Surfaces what the structured probes missed'],
  ]

  const tableY = 1.5
  const colX  = [0.55, 4.45, 8.05]
  const colW  = [3.85, 3.55, 4.95]
  // Header row
  s.addShape('rect', { x: 0.55, y: tableY, w: 12.4, h: 0.45, fill: { color: C.navy } })
  s.addText('Paper construct',            { x: colX[0] + 0.12, y: tableY + 0.05, w: colW[0] - 0.2, h: 0.35, fontSize: 12, fontFace: 'Arial', color: C.white, bold: true })
  s.addText('Sarina mechanism',           { x: colX[1] + 0.12, y: tableY + 0.05, w: colW[1] - 0.2, h: 0.35, fontSize: 12, fontFace: 'Arial', color: C.white, bold: true })
  s.addText('Notes',                      { x: colX[2] + 0.12, y: tableY + 0.05, w: colW[2] - 0.2, h: 0.35, fontSize: 12, fontFace: 'Arial', color: C.white, bold: true })
  let ry = tableY + 0.45
  const rh = 0.6
  rows.forEach((r, i) => {
    const bg = i % 2 === 0 ? C.white : C.slateCard
    s.addShape('rect', { x: 0.55, y: ry, w: 12.4, h: rh, fill: { color: bg }, line: { color: C.border, width: 0.3 } })
    s.addText(r[0], { x: colX[0] + 0.12, y: ry + 0.1, w: colW[0] - 0.2, h: rh - 0.2, fontSize: 11, fontFace: 'Arial', color: C.ink, bold: true,  valign: 'middle' })
    s.addText(r[1], { x: colX[1] + 0.12, y: ry + 0.1, w: colW[1] - 0.2, h: rh - 0.2, fontSize: 11, fontFace: 'Arial', color: C.mid,                       valign: 'middle' })
    s.addText(r[2], { x: colX[2] + 0.12, y: ry + 0.1, w: colW[2] - 0.2, h: rh - 0.2, fontSize: 11, fontFace: 'Arial', color: C.mid, italic: true,        valign: 'middle' })
    ry += rh
  })
  ftr(s, p)
  s.addNotes(
    `This table is the spine of the instrument. Each row is a falsifiable claim: "this construct is captured by this mechanism." If Contractor objects to any mapping, that row gets redesigned before field.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 7 — Survey at a glance
{
  const s = pptx.addSlide(); p++
  hdr(s, 'The survey at a glance', '7 seed questions  ·  2-drill cap per seed  ·  5–7 minutes  ·  ~6 turns of AI follow-up max')

  const items: [string, string][] = [
    ['Q1', 'Decision in mind  (open, no drill)'],
    ['Q2', 'How it turned out  (open, AI drill if vague)'],
    ['Q3', 'What comes to mind now  (open, verbatim-echo drill matrix)'],
    ['Q4', 'Magnitude of the gap  (likert, only if Q3 surfaced an alternative)'],
    ['Q5', 'Your role  (open, behavioral framing, no drill)'],
    ['Q6', 'Room to change it  (open, one drill max)'],
    ['Q7', 'Anything else  (open, no drill)'],
  ]
  let y = 1.45
  items.forEach(([q, t], i) => {
    const accent = i === 2 ? C.orange : i === 3 ? C.gold : C.teal
    s.addShape('roundRect', { x: 0.55, y, w: 12.4, h: 0.65, rectRadius: 0.06, fill: { color: i === 2 ? C.orangeTint : C.white }, line: { color: C.border, width: 0.4 } })
    s.addShape('rect', { x: 0.55, y, w: 0.08, h: 0.65, fill: { color: accent } })
    s.addText(q, { x: 0.75, y: y + 0.13, w: 0.65, h: 0.4, fontSize: 14, fontFace: 'Arial', color: accent, bold: true })
    s.addText(t, { x: 1.40, y: y + 0.13, w: 11.4, h: 0.4, fontSize: 13, fontFace: 'Arial', color: C.ink })
    if (i === 2) {
      s.addText('CORE', { x: 12.0, y: y + 0.16, w: 0.85, h: 0.35, fontSize: 10, fontFace: 'Arial', color: C.orange, bold: true, align: 'right' })
    }
    y += 0.72
  })
  ftr(s, p)
  s.addNotes(
    `Two design choices to flag: (1) Q3 is the central instrument — everything before it sets context, everything after it triangulates. (2) The 2-drill cap per seed is a non-bias guardrail — the longer Sarina pushes, the more she co-constructs the respondent's counterfactual. We tolerate missing data to preserve construct validity.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 8 — Q1–Q2
{
  const s = pptx.addSlide(); p++
  hdr(s, 'Q1 + Q2: Establish the case', 'Set the scene before any counterfactual signal can be measured')

  card(s, 0.55, 1.45, 6.15, 2.7, 'Q1 — Context',
    'Seed: "Think of a decision you made in the last few months — work, personal, anything — that\'s still on your mind. What was the decision?"\n\nDrill: none. We need the unprompted framing.', C.teal)
  card(s, 6.85, 1.45, 6.15, 2.7, 'Q2 — Realized outcome',
    'Seed: "How did it turn out?"\n\nDrill rules: probe once if answer is ≤8 words. If evaluative language appears ("good", "bad", "wish"), do NOT echo it — ask one factual probe. Skip if already concrete.', C.teal)

  quietCard(s, 0.55, 4.35, 12.4, 2.4,
    'Why "still on your mind" instead of "you regret"\n\n' +
    'Filters for memorable decisions without specifying valence. Admits both proud and uneasy memories. ' +
    'Lets us measure base rates of UBC construction across positive and negative outcomes — directly testing P2b ' +
    '(that imagined upward counterfactuals are more likely following negative outcomes, but not exclusive to them).',
    C.tealTint)
  ftr(s, p)
  s.addNotes(
    `Q1's "still on your mind" phrasing is deliberate. If we said "a decision you regret," we'd only get cases where regret is already explicit — and we'd never observe the cases where the framework predicts no regret (e.g., decision responsibility + reversible outcome). The instrument has to admit null UBC cases or it can't falsify P1a.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 9 — Q3 the core drill matrix
{
  const s = pptx.addSlide(); p++
  hdr(s, 'Q3: The comparative space  (the core question)', 'Seed: "When you think about that decision now, what comes to mind?"')

  s.addShape('rect', { x: 0.55, y: 1.5, w: 12.4, h: 0.45, fill: { color: C.orange } })
  s.addText('Verbatim-echo drill matrix — Sarina selects path based on what the respondent already said', {
    x: 0.7, y: 1.55, w: 12.1, h: 0.35, fontSize: 12, fontFace: 'Arial', color: C.white, bold: true,
  })

  const rows: [string, string, string][] = [
    ['Mentions an alternative ("I could have…", "if I\'d…")',
     '"What do you think would have happened if you\'d done that?"',
     'Captures attainable outcome → P3c magnitude'],
    ['Mentions another path WITHOUT an action ("things could\'ve been different")',
     '"Anything specific that comes to mind about how it could\'ve gone differently?"',
     'Tests whether they construct a behavioral counterfactual when prompted neutrally'],
    ['Justifies the decision ("it was the right call", "I don\'t see what else…")',
     '"Has anything come to mind that you\'d weigh differently now?"',
     'Gentle probe for suppressed UBCs — confirmatory-bias signal'],
    ['Pure emotion, no content ("it sucks", "I\'m at peace with it")',
     '"What\'s the piece of it you keep coming back to?"',
     'Surfaces whatever the respondent has been ruminating on'],
  ]
  const tableY = 2.05
  const colX  = [0.55, 4.85, 9.35]
  const colW  = [4.3,  4.5,  3.6]
  s.addShape('rect', { x: 0.55, y: tableY, w: 12.4, h: 0.4, fill: { color: C.navy } })
  s.addText('If respondent…',  { x: colX[0] + 0.12, y: tableY + 0.04, w: colW[0] - 0.2, h: 0.32, fontSize: 11, fontFace: 'Arial', color: C.white, bold: true })
  s.addText('Sarina drill 1',  { x: colX[1] + 0.12, y: tableY + 0.04, w: colW[1] - 0.2, h: 0.32, fontSize: 11, fontFace: 'Arial', color: C.white, bold: true })
  s.addText('What it captures', { x: colX[2] + 0.12, y: tableY + 0.04, w: colW[2] - 0.2, h: 0.32, fontSize: 11, fontFace: 'Arial', color: C.white, bold: true })
  let ry = tableY + 0.4
  const rh = 0.85
  rows.forEach((r, i) => {
    const bg = i % 2 === 0 ? C.white : C.slateCard
    s.addShape('rect', { x: 0.55, y: ry, w: 12.4, h: rh, fill: { color: bg }, line: { color: C.border, width: 0.3 } })
    s.addText(r[0], { x: colX[0] + 0.12, y: ry + 0.08, w: colW[0] - 0.2, h: rh - 0.16, fontSize: 10.5, fontFace: 'Arial', color: C.ink, italic: true, valign: 'middle', wrap: true })
    s.addText(r[1], { x: colX[1] + 0.12, y: ry + 0.08, w: colW[1] - 0.2, h: rh - 0.16, fontSize: 10.5, fontFace: 'Arial', color: C.teal, bold: true,   valign: 'middle', wrap: true })
    s.addText(r[2], { x: colX[2] + 0.12, y: ry + 0.08, w: colW[2] - 0.2, h: rh - 0.16, fontSize: 10.5, fontFace: 'Arial', color: C.mid,                valign: 'middle', wrap: true })
    ry += rh
  })

  quietCard(s, 0.55, ry + 0.15, 12.4, H - (ry + 0.15) - 0.55,
    'Drill 2 (only fires if Drill 1 surfaced an alternative):  "Was that something you\'d considered at the time, or has it come up since?"   →  Maps to P2a (explicit foregone) vs P2b (imagined retrospective).',
    C.orangeTint)
  ftr(s, p)
  s.addNotes(
    `This is the slide to spend the most time on with Contractor. The drill matrix is where the framework's neutrality lives — Sarina is forbidden from proposing alternatives, only from echoing what the respondent already named. Drill 2's exact wording is also worth getting his sign-off on: it has to feel casual but cleanly distinguish P2a from P2b.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 10 — Q4 magnitude
{
  const s = pptx.addSlide(); p++
  hdr(s, 'Q4: Magnitude  (likert anchored to their own comparison)', 'Only shown if Q3 surfaced an alternative — preserves missing-data interpretability')

  quietCard(s, 0.55, 1.45, 12.4, 1.2,
    'Seed:  "Compared to how it actually turned out, how much better do you think that other path would have been?"',
    C.tealTint)

  const opts: [string, string, string][] = [
    ['About the same',         'Likely zero or downward comparison',                'Sarina: "What keeps the two from feeling like a real difference?"'],
    ['A little better',        'Mild upward comparison',                            '(no follow-up)'],
    ['Noticeably better',      'Moderate upward — calibration anchor',              '(no follow-up)'],
    ['A lot better',           'Strong upward comparison → P3c high intensity',     'Sarina: "What makes the gap feel that big?"'],
    ['Hard to even compare',   'High salience, possibly imagined alternative',      'Sarina: "What makes the gap feel that big?"'],
  ]
  const tY = 2.85
  const cX = [0.55, 4.1, 8.1]
  const cW = [3.5, 3.9, 4.85]
  s.addShape('rect', { x: 0.55, y: tY, w: 12.4, h: 0.4, fill: { color: C.navy } })
  s.addText('Response',     { x: cX[0] + 0.12, y: tY + 0.04, w: cW[0] - 0.2, h: 0.32, fontSize: 11, fontFace: 'Arial', color: C.white, bold: true })
  s.addText('Interpretation',{ x: cX[1] + 0.12, y: tY + 0.04, w: cW[1] - 0.2, h: 0.32, fontSize: 11, fontFace: 'Arial', color: C.white, bold: true })
  s.addText('Per-response follow-up', { x: cX[2] + 0.12, y: tY + 0.04, w: cW[2] - 0.2, h: 0.32, fontSize: 11, fontFace: 'Arial', color: C.white, bold: true })
  let ry = tY + 0.4
  const rh = 0.62
  opts.forEach((r, i) => {
    const bg = i % 2 === 0 ? C.white : C.slateCard
    s.addShape('rect', { x: 0.55, y: ry, w: 12.4, h: rh, fill: { color: bg }, line: { color: C.border, width: 0.3 } })
    s.addText(r[0], { x: cX[0] + 0.12, y: ry + 0.08, w: cW[0] - 0.2, h: rh - 0.16, fontSize: 11, fontFace: 'Arial', color: C.ink, bold: true,     valign: 'middle' })
    s.addText(r[1], { x: cX[1] + 0.12, y: ry + 0.08, w: cW[1] - 0.2, h: rh - 0.16, fontSize: 11, fontFace: 'Arial', color: C.mid, italic: true,    valign: 'middle', wrap: true })
    s.addText(r[2], { x: cX[2] + 0.12, y: ry + 0.08, w: cW[2] - 0.2, h: rh - 0.16, fontSize: 11, fontFace: 'Arial', color: C.teal,                valign: 'middle', wrap: true })
    ry += rh
  })
  ftr(s, p)
  s.addNotes(
    `This is the only scale in the instrument. It works because by the time it appears, the respondent has already named the alternative — we're asking them to size their own comparison, not ours. If Q3 produced no alternative, this question is skipped entirely (a null is meaningful: it likely means strong confirmatory bias or post-outcome justification).`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 11 — Q5–Q7
{
  const s = pptx.addSlide(); p++
  hdr(s, 'Q5 + Q6 + Q7: Triangulate responsibility, reversibility, and what we missed', 'Behavioral framing throughout — no "responsibility," no "fault"')

  card(s, 0.55, 1.45, 4.1, 5.3, 'Q5 — Your role',
    'Seed: "Walk me through your role in this. Did you make the call, carry it out, both, or was it more complicated?"\n\nDrill: none.\n\nCaptures decision vs management responsibility (P4a vs P4c) without using either word. Behavioral framing only.',
    C.teal)
  card(s, 4.85, 1.45, 4.1, 5.3, 'Q6 — Room to change',
    'Seed: "Is this still something you have any room to change or revisit?"\n\nDrill: one max, only if yes/maybe — "What would changing it look like from here?"\n\nCaptures outcome reversibility (the moderator on P4a). Asked behaviorally, not as a scale, to avoid anchoring.',
    C.purple)
  card(s, 9.15, 1.45, 3.8, 5.3, 'Q7 — Open close',
    'Seed: "Anything else about this you wanted to say?"\n\nDrill: none.\n\nCatch-all. Useful for confirmatory-bias coding — do new alternatives surface here when respondent feels unconstrained? If yes, signals suppression earlier in the chain.',
    C.orange)
  ftr(s, p)
  s.addNotes(
    `Q5 is the slide most likely to draw pushback from a traditional decision researcher: "why not just ask 'were you responsible?'" The reason is that the word "responsibility" carries attribution-theory baggage that the paper is explicitly trying to retire. Behavioral framing ("did you make the call, carry it out, both") gets the same information without priming the construct.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 12 — Sarina prompt augmentation
{
  const s = pptx.addSlide(); p++
  hdr(s, 'Sarina prompt augmentation', 'Study-scoped neutrality clauses appended to the existing Clarify system prompt')

  s.addShape('roundRect', { x: 0.55, y: 1.45, w: 12.4, h: 5.3, rectRadius: 0.1, fill: { color: '0F172A' }, line: { color: C.teal, width: 1 } })
  s.addText('Additional rules for this study  (framework: regret_v1)', {
    x: 0.85, y: 1.6, w: 11.8, h: 0.35, fontSize: 12, fontFace: 'Arial', color: C.tealMid, bold: true,
  })

  const rules = [
    '1.  Do not use these words in any follow-up:',
    '          regret  ·  wish  ·  should  ·  mistake  ·  fault  ·  blame  ·  responsibility  ·  control',
    '',
    '2.  Do not name an alternative course of action the respondent has not themselves mentioned.',
    '',
    '3.  Mirror the respondent\'s own nouns and verbs. If they call it "the move," call it "the move."',
    '       If they call it "the deal," call it "the deal."',
    '',
    '4.  Never validate or invalidate the decision. No "that makes sense," no "that sounds tough."',
    '',
    '5.  If the respondent has clearly justified the decision and constructed no alternative,',
    '       do not push for one. Return SKIP.',
  ]
  s.addText(rules.join('\n'), {
    x: 0.85, y: 2.05, w: 11.8, h: 4.5, fontSize: 13, fontFace: 'Courier New', color: C.tealLight, lineSpacingMultiple: 1.3, valign: 'top',
  })
  ftr(s, p)
  s.addNotes(
    `These five clauses are the entire net-new engineering surface. They get appended to Sarina's existing Clarify system prompt (which already has max-25-words, no-metacognitive-leakage, etc.) when the study is tagged framework: regret_v1. Rule 5 is the most important — it's what lets the instrument produce meaningful null observations.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 13 — Coding schema → propositions tested
{
  const s = pptx.addSlide(); p++
  hdr(s, 'Post-hoc coding schema  →  propositions tested', 'Each conversation produces 8 coded fields; combinations test specific propositions')

  card(s, 0.55, 1.45, 6.15, 5.3, '8-field coding schema',
    '• counterfactual_constructed:  none / non-behavioral / behavioral\n\n' +
    '• cf_direction:  upward / downward / mixed / n/a\n\n' +
    '• cf_origin:  explicit-foregone / imagined-retrospective / n/a\n\n' +
    '• cf_magnitude:  1–5 + verbatim\n\n' +
    '• decision_responsibility:  self / shared / other / circumstantial\n\n' +
    '• management_responsibility:  self / shared / other / n/a\n\n' +
    '• outcome_reversibility:  reversible / partial / irreversible\n\n' +
    '• justification_signal:  strong / weak / none', C.teal)

  card(s, 6.85, 1.45, 6.15, 5.3, 'Propositions this lets us test',
    '• P1a holds if regret-language in Q7 correlates with cf_constructed = behavioral AND cf_direction = upward\n\n' +
    '• P3c holds if intensity (Q4 + Q7 emotional language) tracks cf_magnitude\n\n' +
    '• P4a holds if decision_responsibility = self attenuates regret-language WHEN reversibility = reversible, but NOT when irreversible\n\n' +
    '• P4e holds if outcome_responsibility (self-blame language) does NOT independently predict regret-language once UBC is controlled\n\n' +
    '• §4.5 holds if justification_signal = strong predicts cf_constructed = none', C.purple)
  ftr(s, p)
  s.addNotes(
    `Coding is done by a Claude prompt that consumes the full conversation transcript and emits the 8-field JSON. We'd want human coding on a stratified sample (~150 conversations) to validate the AI coder before relying on it. Inter-rater reliability target: kappa ≥ 0.7 on each field.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 14 — What we deliberately do NOT do
{
  const s = pptx.addSlide(); p++
  hdr(s, 'What this instrument deliberately does NOT do', 'Each absence is a deliberate design choice grounded in the framework')

  card(s, 0.55, 1.45, 6.15, 2.55, 'No NPS, no satisfaction rating',
    'Both prime valence before the respondent has had a chance to construct (or not construct) a counterfactual unprompted. Their absence is the price of measuring the construct cleanly.', C.red)
  card(s, 6.85, 1.45, 6.15, 2.55, 'No "rate your regret 1–10"',
    'Direct measurement of the construct is what the paper says prior research got wrong. We measure the mechanism (UBC + magnitude) and let regret intensity fall out of language analysis.', C.red)
  card(s, 0.55, 4.15, 6.15, 2.55, 'No fault, blame, or responsibility questions',
    'The paper\'s argument is that these are confounds, not causes. The instrument captures the behavioral facts of decision and management roles without priming the construct that confounds them.', C.red)
  card(s, 6.85, 4.15, 6.15, 2.55, 'No more than 2 drills per seed',
    'Conversation length is the enemy of unbiased response. The longer Sarina pushes, the more she co-constructs the respondent\'s counterfactual. We accept missing data to preserve construct validity.', C.red)
  ftr(s, p)
  s.addNotes(
    `Each "no" on this slide will get questioned. The defense is the same in every case: the absence preserves the construct's separability from its confounds. An instrument that includes these would be more conventional but would not produce evidence that distinguishes Contractor's framework from the prior literature.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 15 — Questions for Contractor
{
  const s = pptx.addSlide(); p++
  hdr(s, 'Questions for Dr. Contractor', 'Where we\'d most value your reaction before we move to pilot')

  card(s, 0.55, 1.45, 12.4, 1.4, 'On the Q3 drill matrix',
    'Are the four respondent-signal categories (explicit alternative / path-without-action / decision-justified / pure-emotion) collectively exhaustive enough? Any signal class we\'re missing that would route the respondent to a different probe?', C.teal)

  card(s, 0.55, 3.0, 12.4, 1.4, 'On the P2a vs P2b distinction',
    'Drill 2 reads: "Was that something you\'d considered at the time, or has it come up since?" — does this cleanly distinguish explicit foregone from imagined retrospective in conversational form, or does it need to be split into two probes?', C.purple)

  card(s, 0.55, 4.55, 12.4, 1.4, 'On the responsibility framing in Q5',
    '"Did you make the call, carry it out, both, or more complicated?" — does this give us enough to code decision vs management responsibility without using the words, or do we lose too much fidelity vs a direct ask?', C.orange)

  card(s, 0.55, 6.1, 12.4, 0.7, 'On pilot design',
    'If the design holds, would you want to co-design the recruitment frame (e.g., recent purchase vs job decision vs medical) and the analysis plan before we field?', C.gold)
  ftr(s, p)
  s.addNotes(
    `These four questions are the only places where the instrument can be redesigned without rebuilding it from scratch. Everything else (platform, neutrality clauses, coding schema) is downstream of these decisions. The fourth question is the open door — if he wants to be the co-PI, the instrument benefits hugely from his framing decisions on recruitment.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
const outPath = path.join(os.homedir(), 'Downloads', 'Regret-Framework-Survey-Design.pptx')
pptx.writeFile({ fileName: outPath }).then((p: string) => {
  console.log(`Deck written: ${p}`)
})
