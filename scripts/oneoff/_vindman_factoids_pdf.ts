// Run: node --conditions=react-server --import tsx scripts/oneoff/_vindman_factoids_pdf.ts
// Side-by-side factoid sheet for the Vindman campaign (FL Senate special, vs
// appointed Sen. Ashley Moody). Renders to ~/Downloads.
//
// ⚠️ THE ONE RULE THIS SHEET EXISTS TO ENFORCE — NO TRANSFER CLAIMS.
// The owner's draft line was "he took $XXX to paint the reflecting pool and took
// away $YYY from SNAP to feed your baby". Do not write that. The ballroom and
// the Mall work are not funded out of SNAP; they are different appropriations,
// and the ballroom has been publicly described as privately funded. A claim that
// money moved from one to the other is false ON MECHANISM even when both dollar
// figures are true, and it is the single easiest thing on this sheet for an
// opponent to get fact-checked and win.
// Everything here is a JUXTAPOSITION: two separately sourced facts placed side
// by side. The reader draws the line. The page never draws it for them.
//
// ⚠️ ATTENTION, NOT MONEY. Every left-hand figure is a COUNT OF WHAT HE SAID,
// measured in this corpus. None of them is a dollar amount. Do not let a
// designer or a copywriter turn "209 passages" into "$209" or into a spend
// claim — the sheet says "passages" and "days" on every line for that reason.
//
// SOURCES
//   corpus     55,418 passages / 565 days, deduped, his words only
//   CDC        measles cases and deaths — external
//   Senate.gov roll call 52 (13 Feb 2025) and 372 (1 Jul 2025) — Moody's votes,
//              read off the official roll call pages, not inferred from party
//
// ⚠️ MOODY — THE TWO VOTES ARE NOT EQUALLY STRONG AND THE SHEET SAYS SO.
//   H.R.1 passed 50-50 with the Vice President breaking the tie. Had she voted
//   no it would have FAILED. That is a decisive-vote claim and it is true.
//   RFK Jr. was confirmed 52-48. Had she voted no he would STILL have been
//   confirmed, 51-49. She voted for him; she was not decisive. Saying otherwise
//   is the kind of overreach that gets the whole sheet discounted.
import { htmlToPdfBuffer, brandedPdfChrome } from '../../lib/htmlToPdf'
import { writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const ORANGE = '#E85A1A'
const TEAL = '#0F7173'

interface Row { l: string; lsub: string; r: string; rsub: string; line?: string; ext?: boolean }
const pairs = (title: string, blurb: string, rows: Row[]) => `
<div class="sec keep">
  <h2>${title}</h2>
  <p class="blurb">${blurb}</p>
  ${rows.map((x) => `
  <div class="pair">
    <div class="side a"><div class="n">${x.l}</div><div class="s">${x.lsub}</div></div>
    <div class="vs">vs</div>
    <div class="side b"><div class="n">${x.r}</div><div class="s">${x.rsub}${x.ext ? ' <span class="ext">external</span>' : ''}</div></div>
  </div>
  ${x.line ? `<p class="say">${x.line}</p>` : ''}`).join('')}
</div>`

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Side-by-Side Factoids</title><style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
       margin:0;font-size:10.2px;line-height:1.45;color:#334155}
  .keep{break-inside:avoid}
  .eyebrow{font-size:8.5px;letter-spacing:.18em;text-transform:uppercase;color:#94a3b8;font-weight:700;margin:0 0 8px}
  h1{font-size:29px;line-height:1.04;margin:0 0 9px;color:#0f172a;font-weight:800;letter-spacing:-.025em}
  .rule{height:3px;width:50px;background:${ORANGE};border-radius:2px;margin:0 0 13px}
  .deck{font-size:10.4px;color:#64748b;margin:0 0 6px;max-width:680px}
  .warn{font-size:9px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;
        padding:9px 12px;margin:11px 0 0}
  h2{font-size:9.4px;color:${TEAL};text-transform:uppercase;letter-spacing:.14em;margin:0 0 4px;font-weight:800}
  .sec{margin-top:19px}
  .blurb{font-size:9.2px;color:#94a3b8;margin:0 0 10px}

  .pair{display:grid;grid-template-columns:1fr 42px 1fr;align-items:center;gap:8px;
        padding:9px 0;border-bottom:1px solid #f1f5f9}
  .side .n{font-size:26px;font-weight:800;line-height:1;letter-spacing:-.03em}
  .side.a .n{color:#0f172a}
  .side.b .n{color:${ORANGE}}
  .side .s{font-size:9.4px;color:#64748b;margin-top:5px;line-height:1.35}
  .side .s b{color:#0f172a}
  .vs{font-size:8.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#cbd5e1;text-align:center}
  .ext{font-size:7.2px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
       color:#92400e;background:#fef3c7;padding:1.5px 5px;border-radius:3px}
  .say{font-size:10.3px;font-style:italic;color:#0f172a;margin:7px 0 2px;line-height:1.35;
       border-left:2.5px solid ${ORANGE};padding-left:9px;font-weight:500}

  .vote{border:1px solid #e2e8f0;border-left:3px solid ${ORANGE};border-radius:6px;padding:10px 13px;margin:9px 0 0}
  .vote .h{font-size:11px;font-weight:800;color:#0f172a}
  .vote .d{font-size:9.4px;color:#475569;margin-top:4px;line-height:1.45}
  .vote .d b{color:#0f172a}

  table.ties{width:100%;border-collapse:collapse;font-size:9.3px;margin-top:6px}
  table.ties th{text-align:left;font-size:7.6px;text-transform:uppercase;letter-spacing:.09em;color:#94a3b8;
                font-weight:800;padding:0 7px 5px 0;border-bottom:1px solid #e2e8f0}
  table.ties td{padding:6px 7px 6px 0;border-bottom:1px solid #f1f5f9;color:#475569;vertical-align:top}
  table.ties td b{color:#0f172a}
  table.ties .c{text-align:center;font-weight:800;width:52px}
  table.ties .y{color:${ORANGE}}
  table.ties .n{color:#64748b}
  table.ties tr.hi td{background:#fffaf5}
  .fine{font-size:9.3px;color:#475569;margin:9px 0 0;line-height:1.45}
  .fine b{color:#0f172a}
  .method{border-top:1px solid #e2e8f0;margin-top:19px;padding-top:10px}
  .method p{font-size:8.7px;color:#94a3b8;line-height:1.45;margin:0 0 4px}
  .method b{color:#64748b}
</style></head><body>

<p class="eyebrow">Corpus analysis · August 2026</p>
<h1>What he talked about &mdash; and what he didn't</h1>
<div class="rule"></div>
<p class="deck">Every word Donald Trump has spoken on the public record and posted in his own words since the January
  2025 inauguration: <b>55,418 passages</b> across <b>565 days</b>. Reporters' questions, other speakers and reposts
  removed; exact duplicates removed. Left-hand figures are <b>counts of what he said</b> &mdash; never dollars.</p>
<p class="warn"><b>Read this before writing copy.</b> These are two facts placed side by side, not a budget transfer.
  The ballroom and the Mall work are not paid for out of SNAP &mdash; different appropriations, and the ballroom has
  been described publicly as privately funded. <b>Do not write "he took $X from SNAP to pay for the pool."</b> It is
  false on mechanism even when both numbers are true, and it is the easiest claim here for an opponent to win.</p>

${pairs('His projects against the food on your table',
  'Both sides counted the same way, in the same corpus, over the same 565 days.', [
  { l: '209', lsub: 'passages about <b>the White House ballroom</b>, on 87 separate days',
    r: '40', rsub: 'passages about <b>SNAP and food stamps</b>, on 21 days',
    line: 'He talked about his ballroom five times more than he talked about food assistance.' },
  { l: '289', lsub: 'passages about <b>the ballroom, the Reflecting Pool and his triumphal arch</b>, on 114 days',
    r: '60', rsub: 'passages about <b>SNAP, WIC, school lunch and hunger</b>, on 39 days' },
  { l: '209', lsub: 'passages about <b>the ballroom</b>', r: '10',
    rsub: 'passages using the words <b>"hungry," "hunger" or "food bank"</b> &mdash; in nineteen months',
    line: 'In nineteen months as President he used the word "hungry" ten times.' },
  { l: '209', lsub: 'passages about <b>the ballroom</b>', r: '97', rsub: 'passages about <b>Medicaid</b>, on 52 days' },
])}

${pairs('The thing he raises most, and the question he never answers',
  'Tariffs are his single largest topic. This is a silence gap inside a loud one.', [
  { l: '1,885', lsub: 'passages about <b>tariffs</b> &mdash; on <b>339 of 565 days</b>, six days in every ten',
    r: '14', rsub: 'of those passages say <b>Americans or consumers</b> pay them. 22 say a foreign country does.',
    line: 'He has raised tariffs on six days out of every ten. He has told you who pays fourteen times.' },
])}

${pairs('Public health', 'His attention against the CDC record over the same period.', [
  { l: '281', lsub: 'passages about <b>the stock market</b>, on 137 days',
    r: '3', rsub: 'times he has said the word <b>"measles"</b> &mdash; not once to address the outbreak',
    line: 'He mentioned the stock market on a hundred and thirty-seven days. He said "measles" three times.' },
  { l: '285', lsub: 'measles cases in <b>2024</b>', r: '2,289', rsub: 'measles cases in <b>2025</b> &mdash; a <b>703%</b> increase, with 2,465 already by August 2026', ext: true },
  { l: '9', lsub: 'years with <b>no measles death</b> in America, 2016 through 2024', r: '3',
    rsub: 'Americans <b>died of measles in 2025</b> &mdash; the first in a decade. All three unvaccinated.', ext: true,
    line: 'Nine years without a single measles death. Then three in one year.' },
])}

<div class="sec keep">
  <h2>What Ashley Moody voted for</h2>
  <p class="blurb">Read off the official Senate roll call pages, not inferred from party. The two votes are not equally strong and are stated differently on purpose.</p>

  <div class="vote">
    <div class="h">She voted to confirm Robert F. Kennedy Jr. as Secretary of Health and Human Services</div>
    <div class="d">Roll call vote <b>52</b>, 13 February 2025. Confirmed <b>52&ndash;48</b>. <b>Moody: Yea.</b><br>
      Kennedy told Fox News on 11 March 2025 that the measles vaccine "does cause deaths every year." That is false.
      Measles cases rose 703% that year and three Americans died.<br>
      <b>Say it accurately:</b> she voted to confirm him. At 52&ndash;48 her vote was <b>not</b> decisive &mdash; he
      would have been confirmed without it. Claiming otherwise is an unforced error.</div>
  </div>

  <div class="vote">
    <div class="h">She cast a vote without which the Medicaid and SNAP cuts would have failed</div>
    <div class="d">Roll call vote <b>372</b>, 1 July 2025. H.R.1, the reconciliation bill. Passed <b>50&ndash;50</b>,
      with the Vice President breaking the tie. <b>Moody: Yea.</b><br>
      <b>This one IS decisive and can be said so.</b> At 50&ndash;50, a single Republican no vote defeats the bill.
      Three Republicans did vote no. She did not.</div>
  </div>
  <p class="say">Fifty to fifty. If Ashley Moody had voted no, it would have failed. She didn't.</p>
</div>

<div class="sec keep" style="page-break-before:always">
  <h2>Twelve times the Senate tied. She was on the winning side of all twelve.</h2>
  <p class="blurb">Every 50&ndash;50 roll call of this Congress, from the official Senate vote records. At 50&ndash;50 a single senator changing sides changes the outcome &mdash; so each of these is decisive by definition, whichever way she voted.</p>

  <table class="ties">
    <thead><tr><th>Roll call</th><th>Date</th><th>What it was</th><th class="c">Moody</th><th>Outcome</th></tr></thead>
    <tbody>
      <tr class="hi"><td>15</td><td>24 Jan 2025</td><td><b>Pete Hegseth</b> confirmed Secretary of Defense</td><td class="c y">Yea</td><td>Confirmed, VP broke the tie</td></tr>
      <tr class="hi"><td>372</td><td>1 Jul 2025</td><td><b>H.R.1 reconciliation</b> &mdash; the Medicaid and SNAP cuts</td><td class="c y">Yea</td><td>Passed, VP broke the tie</td></tr>
      <tr class="hi"><td>9</td><td>14 Jan 2026</td><td>Killed the privileged status of a resolution to <b>remove US forces from unauthorised hostilities against Venezuela</b></td><td class="c y">Yea</td><td>Resolution blocked, VP broke the tie</td></tr>
      <tr><td>371</td><td>1 Jul 2025</td><td>The substitute amendment carrying H.R.1</td><td class="c y">Yea</td><td>Agreed to, VP broke the tie</td></tr>
      <tr><td>370</td><td>1 Jul 2025</td><td>Graham amendment to H.R.1</td><td class="c y">Yea</td><td>Agreed to, VP broke the tie</td></tr>
      <tr><td>358</td><td>1 Jul 2025</td><td>Amendment to <b>eliminate the private and religious school scholarship program</b></td><td class="c n">Nay</td><td>Defeated</td></tr>
      <tr><td>368</td><td>1 Jul 2025</td><td>Amendment to strike the appropriation for the Office of Management and Budget</td><td class="c n">Nay</td><td>Defeated</td></tr>
      <tr><td>367</td><td>1 Jul 2025</td><td>Amendment on airport lease revenues for aviation safety</td><td class="c n">Nay</td><td>Defeated</td></tr>
      <tr><td>391</td><td>15 Jul 2025</td><td rowspan="2">H.R.4, the package <b>rescinding money Congress had already appropriated</b></td><td class="c y">Yea</td><td>Agreed to, VP broke the tie</td></tr>
      <tr><td>392</td><td>15 Jul 2025</td><td class="c y">Yea</td><td>Agreed to, VP broke the tie</td></tr>
      <tr><td>654</td><td>18 Dec 2025</td><td>Resolution to overturn the HHS rule <b>"Adhering to the Text of the Administrative Procedure Act"</b></td><td class="c n">Nay</td><td>Defeated &mdash; rule stands</td></tr>
      <tr><td>122</td><td>13 May 2026</td><td>Motion to take up restoring the <b>CFPB debt-collection rule</b></td><td class="c n">Nay</td><td>Rejected</td></tr>
    </tbody>
  </table>

  <p class="say">Twelve times this Senate has split straight down the middle. Twelve times Ashley Moody was on the winning side. Not once did she break with them.</p>
  <p class="fine"><b>Three worth naming on their own.</b> She cast a decisive vote to put <b>Pete Hegseth</b> at the Pentagon. She cast a decisive vote for the bill that <b>cut Medicaid and SNAP</b>. And she cast a decisive vote to <b>block a resolution reining in unauthorised military action against Venezuela</b> &mdash; a war-powers vote, decided by one seat.</p>
  <p class="fine"><b>Say it precisely.</b> "Decisive" is accurate for every vote on this page because the chamber was tied. It is <b>not</b> accurate for the RFK Jr. confirmation on the previous page, which was 52&ndash;48. Keep the two claims separate.</p>
</div>

<div class="method">
  <p><b>Method.</b> Corpus figures come from the official public record of presidential documents and a public archive
    of his posts, from 20 January 2025. Only text attributed to him is counted; exact duplicates are removed. Each
    topic carries an explicit published keyword list, and every list was audited against its own matches &mdash;
    "golf" was excluded where it meant "golfer", "fool" where it meant "foolish", "loser" where it meant the legal
    doctrine "loser pays". Every figure regenerates from a script.</p>
  <p><b>What is external and what is ours.</b> The CDC measles figures and the Senate roll calls are outside sources,
    tagged and cited. They are placed beside the attention figures and <b>never divided by them</b> &mdash; a case
    count and a share of days are different units. <b>No causal claim is made or implied</b> anywhere on this page.</p>
  <p><b>These are lower bounds.</b> He can discuss hunger without saying "hunger". So the defensible claim is always
    the comparison, never the absolute count, because both sides were measured by identical rules.</p>
</div>

</body></html>`

const out = join(homedir(), 'Downloads', 'SideBySide_Factoids_FL_Senate.pdf')
const chrome = brandedPdfChrome({ brand: 'Side-by-Side Factoids', confidentiality: 'Confidential — for intended recipients only' })
htmlToPdfBuffer(html, { format: 'letter', ...chrome })
  .then((b) => { writeFileSync(out, b); console.log(`Wrote ${out}  (${Math.round(b.length / 1024)} KB)`) })
  .catch((e) => { console.error(e); process.exit(1) })
