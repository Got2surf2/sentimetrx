/* eslint-disable */
// One-off: brainstorm memo on using Sir O'Gate (and Sentimetrx core
// capabilities) to surface non-response bias in the Alex Vindman for
// Senate campaign.
//
// Output: ~/Downloads/sirogate_nonresponse_brainstorm_2026-05-19.docx

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType,
} from 'docx'
import { writeFileSync } from 'fs'
import { homedir } from 'os'
import path from 'path'

const FONT = 'Calibri'

function p(text: string, opts: { bold?: boolean; italic?: boolean; size?: number; before?: number; after?: number; indent?: number } = {}) {
  return new Paragraph({
    spacing: { before: opts.before, after: opts.after ?? 120 },
    indent: opts.indent ? { left: opts.indent } : undefined,
    children: [new TextRun({ text, font: FONT, size: opts.size ?? 22, bold: opts.bold, italics: opts.italic })],
  })
}

function bullet(text: string, opts: { bold?: boolean } = {}) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, font: FONT, size: 22, bold: opts.bold })],
  })
}

function richBullet(parts: Array<{ text: string; bold?: boolean; italic?: boolean }>) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 80 },
    children: parts.map(part => new TextRun({ text: part.text, font: FONT, size: 22, bold: part.bold, italics: part.italic })),
  })
}

function h1(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, font: FONT, size: 32, bold: true })],
  })
}

function h2(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, font: FONT, size: 26, bold: true })],
  })
}

function callout(text: string, fill: string = 'FFF9DB') {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:    { style: BorderStyle.SINGLE, size: 4, color: 'E8D078' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E8D078' },
      left:   { style: BorderStyle.SINGLE, size: 12, color: 'E8632A' },
      right:  { style: BorderStyle.SINGLE, size: 4, color: 'E8D078' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideVertical:   { style: BorderStyle.NONE, size: 0, color: 'auto' },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, color: 'auto', fill },
            children: [new Paragraph({
              spacing: { before: 80, after: 80 },
              children: [new TextRun({ text, font: FONT, size: 22, italics: true })],
            })],
          }),
        ],
      }),
    ],
  })
}

const BORDERS = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
  insideVertical:   { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
}

function tableCell(text: string, opts: { bold?: boolean; shading?: string; size?: number; width?: number; align?: typeof AlignmentType[keyof typeof AlignmentType] } = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.shading ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.shading } : undefined,
    children: [new Paragraph({
      alignment: opts.align,
      children: [new TextRun({ text, font: FONT, size: opts.size ?? 20, bold: opts.bold })],
    })],
  })
}

function headerRow(cells: string[]) {
  return new TableRow({
    tableHeader: true,
    children: cells.map(c => new TableCell({
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: '0A1628' },
      children: [new Paragraph({
        children: [new TextRun({ text: c, font: FONT, size: 18, bold: true, color: 'FFFFFF' })],
      })],
    })),
  })
}

// ── Document content ─────────────────────────────────────────────────

const children = [
  // Title
  new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: 'Surfacing Non-Response Bias — Sir O\'Gate', font: FONT, size: 36, bold: true })],
  }),
  new Paragraph({
    spacing: { after: 240 },
    children: [new TextRun({
      text: 'Using the Vindman campaign\'s conversational agent (and the rest of Sentimetrx) to hear from voters who won\'t engage with the campaign directly.',
      font: FONT, size: 22, italics: true, color: '6B7280',
    })],
  }),

  // Context / framing
  h2('The problem this is trying to solve'),
  p(
    'Sir O\'Gate is reached by people who either visited alexvindman.com or scanned a campaign QR code. ' +
    'That population is heavily self-selected — already supporters, already curious detractors, or already politically engaged. ' +
    'The voters who will actually decide a 2026 Florida special election sit somewhere else: persuadable independents, ' +
    'low-propensity voters who don\'t engage with campaign material, voters in opposition-leaning counties, and ' +
    'demographics the campaign hasn\'t systematically reached (Spanish-speaking households, Haitian Creole households, ' +
    'younger voters with no recent vote history, working-class voters who don\'t consume campaign communications).',
  ),
  p(
    'Sir O\'Gate, by itself, will never hear from those people. The question is what we can build alongside it ' +
    '— using core Sentimetrx capabilities — that does.',
  ),

  // The original instinct, methodologically tightened
  h2('1. The counter-perspective probe (today, low effort)'),
  p(
    'The starting instinct — have Sir O\'Gate ask respondents what their friends and family think — is directionally ' +
    'right but methodologically risky in its raw form. Proxy reporting is a well-known bias amplifier: people project ' +
    'their own views, misremember, or report a stylized version of what others said. Aggregating proxy data as ' +
    '"voter opinion" wouldn\'t survive scrutiny if the campaign\'s polling consultant or a journalist asked how it was collected.',
  ),
  p('The same instinct, done in a way that holds up:', { bold: true }),
  callout(
    '"Before we wrap up — is there a perspective on this issue you\'ve heard from neighbors, family, or coworkers ' +
    'that you don\'t share but the campaign should hear? We track those separately so the team sees the full picture."',
  ),
  p(
    'Why this version works: the respondent explicitly labels the view as a counter-perspective they don\'t hold. ' +
    'The data is tagged "respondent-reported counter-perspective" — never aggregated as opinion, never quoted as a polling result. ' +
    'It deliberately surfaces concerns the campaign needs to counter, without claiming the magnitude is representative. ' +
    'In a campaign context this is more useful than raw opinion data — it\'s exactly the doubts a persuasion message needs to address.',
    { before: 80 },
  ),
  p('Cost: a one-paragraph addition to Sir O\'Gate\'s system prompt and a new focus tag (e.g. counter-perspective-reported). About thirty minutes of work.', { bold: true, before: 80 }),

  // Tier: Distribution
  h2('2. Reach the voters who won\'t visit the website (low effort, existing modules)'),
  p('Sentimetrx already supports everything below — these are deployment choices, not new code.'),
  richBullet([
    { text: 'Aggressive multilingual deployment. ', bold: true },
    { text: 'Sir O\'Gate already supports 16 languages with one-click translation. Florida has the third-largest Hispanic population in the country and significant Haitian Creole pockets in Miami-Dade, Broward, and Orange. Most political campaigns don\'t translate. Sir O\'Gate fully translated reaches a demographic the campaign currently doesn\'t.' },
  ]),
  richBullet([
    { text: 'Strategic QR placement beyond the website. ', bold: true },
    { text: 'A QR on the campaign site only reaches site visitors. Print QR for: town halls in non-Vindman-leaning counties, community events in heavy Republican-registered areas, college campuses, Spanish-language community organizations, faith-group bulletins. Each placement reaches a non-overlapping slice of non-responders.' },
  ]),
  richBullet([
    { text: 'Canvasser-held QR. ', bold: true },
    { text: 'Sir O\'Gate is conversational — perfect to hand off to in a door-knock. After a brief exchange, the canvasser leaves the QR. The resident continues the conversation with Sir O\'Gate later, in their own time, in their own language, more honestly than they would with a stranger on the porch. Logged into the same response set the campaign already uses.' },
  ]),
  richBullet([
    { text: 'Embed in partner properties. ', bold: true },
    { text: 'The bot widget already embeds anywhere. Place it inside partner organizations\' newsletters, school PTA pages, union locals\' member portals. Residents respond through a trusted intermediary, not the campaign — which dramatically shifts who shows up.' },
  ]),

  // Tier: Public discourse listening
  h2('3. Listen to what voters say when the campaign isn\'t in the room (medium effort, existing modules)'),
  p(
    'This is the highest-leverage one and we already have most of the pieces. Sir O\'Gate hears voters in a campaign-flavored context. ' +
    'Reddit, local Facebook groups, comment threads on local news articles, and Twitter/X mentions of Vindman or Moody hear voters ' +
    'in their own context — much closer to the real persuasion environment.',
  ),
  bullet('Sentimetrx already has the Reddit module. Scrape r/Florida, r/florida_politics, r/Tampa, r/Orlando, r/Miami, r/Jacksonville, and any subs related to the major Florida media outlets for posts mentioning Vindman, Moody, or the special-election issues.'),
  bullet('The social module already monitors social platforms — extend it to track mentions of the Vindman and Moody handles + the issue terms from the Florida First Agenda.'),
  bullet('Run Ana on the resulting corpus. Compare themes from Sir O\'Gate conversations against themes from public discourse. The gaps are where the campaign isn\'t hearing what voters are saying.'),
  bullet('Example gap analysis: "Cost-of-living is theme #4 in Sir O\'Gate conversations and theme #1 in r/florida_politics — Sir O\'Gate respondents are over-indexing on national policy compared to where actual voter attention sits."'),
  bullet('Track the opposition narrative. Pull comment threads on Moody\'s social posts. Sir O\'Gate sees what Vindman-curious voters say; her audience sees what Moody-curious voters say. The campaign needs both.'),
  p(
    'This makes Sentimetrx into a campaign-grade "what are we missing" tool, not just "what are supporters saying." ' +
    'It also produces something the campaign\'s polling firm can\'t deliver — polling captures opinions on prompted questions, ' +
    'this captures the themes voters spontaneously raise about the race.',
    { before: 80, italic: true },
  ),

  // Tier: Demographic gap dashboard
  h2('4. Demographic gap dashboard (higher effort, real commercial differentiator)'),
  p(
    'Sir O\'Gate collects (when respondents opt in) name, ZIP, language, plus inferred demographics from the conversation. ' +
    'The campaign has voter-file access (L2, TargetSmart, etc.). The combination is powerful.',
  ),
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: BORDERS,
    rows: [
      headerRow(['What we add', 'What that buys the campaign']),
      new TableRow({ children: [
        tableCell('Voter-file overlay on Sir O\'Gate response demographics', { width: 40 }),
        tableCell('Quantifies the response gap explicitly. Example: "Sir O\'Gate respondents are 78% registered Democrats vs. 30% in the FL electorate. Hispanic voters under-represented by 40%. NPA voters under-represented by 60%."', { width: 60 }),
      ]}),
      new TableRow({ children: [
        tableCell('Theme distribution by demographic slice', { width: 40 }),
        tableCell('Surface where persuadable voters\' concerns differ from the base. "NPA respondents cite cost-of-living 2.1× more than registered Democrats. Healthcare is roughly equal across both. Foreign policy matters 3× more to Vindman-leaning Democrats — drop it from persuasion messaging for NPA voters."', { width: 60 }),
      ]}),
      new TableRow({ children: [
        tableCell('Statistical weighting toward the voter-file target', { width: 40 }),
        tableCell('Sentimetrx becomes the first text-analytics tool that delivers polling-grade weighted output. The campaign can report findings as defensibly representative rather than as "what enthusiasts told the bot."', { width: 60 }),
      ]}),
    ],
  }),
  p(
    'Effort: real — probably one to two weeks for a campaign-specific build, longer for a polished product. But this is ' +
    'the kind of feature that turns Sentimetrx into a defensible offering to political consulting firms generally, not just one campaign.',
    { before: 120 },
  ),

  // Tier: Persuasion testing
  h2('5. Persuasion testing (campaign-specific upside, medium effort)'),
  p(
    'A natural extension once Sir O\'Gate has volume: A/B-test the framings of an issue inside the conversation itself. ' +
    'Half of conversations get framing A on healthcare; half get framing B. Measure which produces more "I\'d consider voting for Alex" ' +
    'moments, more shares, more donate/volunteer intent. The campaign\'s media team currently A/B-tests ads — this would A/B-test ' +
    'the underlying persuasion message in a more conversational, lower-noise environment than display creative.',
  ),
  p(
    'Sentimetrx pivots from listening tool to message-testing tool. Competitive landscape here is much smaller than the listening market — ' +
    'and the political-consulting buyer is willing to pay real money for it.',
    { italic: true, before: 80 },
  ),

  // Recommended path
  h2('Recommended path'),
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: BORDERS,
    rows: [
      headerRow(['When', 'What', 'Effort']),
      new TableRow({ children: [
        tableCell('This week', { bold: true, width: 15 }),
        tableCell('Add the counter-perspective probe to Sir O\'Gate\'s system prompt (§1). Confirm Spanish + Haitian Creole deployment is on (§2).', { width: 65 }),
        tableCell('< 1 hour', { width: 20 }),
      ]}),
      new TableRow({ children: [
        tableCell('Next 2 weeks', { bold: true, width: 15 }),
        tableCell('Wire the Reddit + social module for Florida political discourse (§3). Stand up the Ana comparison view that puts Sir O\'Gate themes next to public-discourse themes.', { width: 65 }),
        tableCell('2-3 days', { width: 20 }),
      ]}),
      new TableRow({ children: [
        tableCell('Pilot in the next 1-2 months', { bold: true, width: 15 }),
        tableCell('Demographic gap dashboard (§4) using whichever voter-file source the campaign already has. Initially a Vindman-specific build; refactor into a reusable product once the second campaign client signs.', { width: 65 }),
        tableCell('1-2 weeks', { width: 20 }),
      ]}),
      new TableRow({ children: [
        tableCell('Later', { bold: true, width: 15 }),
        tableCell('Persuasion testing inside Sir O\'Gate (§5). Worth doing once we have at least one paying political-consulting client to monetize the differentiation.', { width: 65 }),
        tableCell('1-2 weeks', { width: 20 }),
      ]}),
    ],
  }),

  // One thing not to do
  h2('One thing not to build'),
  p(
    'A literal "tell me what your friends think" prompt — aggregating those responses as voter opinion — would actively ' +
    'hurt the campaign\'s credibility if any of the data made it into a polling memo or a journalist\'s hands. The counter-perspective ' +
    'probe in §1 captures the same underlying insight with the methodological labeling that lets the campaign actually use the data.',
  ),
]

const doc = new Document({
  creator: 'Sentimetrx',
  title: 'Surfacing Non-Response Bias — Sir O\'Gate',
  styles: {
    default: {
      document: { run: { font: FONT, size: 22 } },
    },
  },
  sections: [{ children }],
})

async function main() {
  const buf = await Packer.toBuffer(doc)
  const outPath = path.join(homedir(), 'Downloads', 'sirogate_nonresponse_brainstorm_2026-05-19.docx')
  writeFileSync(outPath, buf)
  console.log('Wrote ' + outPath + ' (' + buf.length.toLocaleString() + ' bytes)')
}

main().catch(e => { console.error(e); process.exit(1) })
