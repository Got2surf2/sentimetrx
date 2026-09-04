// One-off: ANES finding brief — young men's top problems, 2020 vs 2024.
// Numbers computed 2026-09-04 through the platform path (segment_match_ids
// subgroups + the dataset's own theme model via commentMatchesTheme over
// EVERY matched response — exact, not sampled).
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { htmlToPdfBuffer, brandedPdfChrome } from '../../lib/htmlToPdf'

const css = `
  body { font-family: Inter, system-ui, sans-serif; color: #1A2421; font-size: 11.5px; line-height: 1.55; margin: 0; }
  h1 { font-size: 21px; margin: 0 0 2px; letter-spacing: -.3px; }
  .sub { color: #5C6B64; font-size: 12px; margin: 0 0 18px; }
  h2 { font-size: 14px; margin: 20px 0 8px; color: #0E7476; }
  .card { background: #F3F6F5; border-radius: 10px; padding: 12px 16px; margin: 10px 0; break-inside: avoid; }
  .head { background: #0E7476; color: #fff; border-radius: 10px; padding: 12px 16px; margin: 12px 0; font-size: 13px; break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; break-inside: avoid; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #5C6B64; padding: 4px 8px; border-bottom: 1.5px solid #1A2421; }
  td { padding: 5px 8px; border-bottom: 1px solid rgba(26,36,33,.12); }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .up { color: #B91C1C; font-weight: 700; } .down { color: #1D4ED8; font-weight: 700; }
  .kicker { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #E85A1A; font-weight: 700; margin-bottom: 4px; }
  section { break-inside: avoid; }
  .note { font-size: 10px; color: #5C6B64; border-top: 1px solid rgba(26,36,33,.12); margin-top: 18px; padding-top: 8px; }
  .vb { font-size: 10.5px; color: #384540; margin: 3px 0; }
  .vb b { color: #0E7476; font-weight: 700; }
`

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>

<div class="kicker">ANES 1984–2024 · Men under 40 · 2020 vs 2024 election studies</div>
<h1>Young men's top problems: 2020 to 2024</h1>
<p class="sub">What men under 40 named as the country's most important problems in the open-ended
"Top Problem" question — 2,999 respondents in 2020 and 1,669 in 2024.</p>

<div class="head"><b>The one-line story:</b> young men swapped a crisis-and-identity agenda for a
pocketbook-and-border agenda. The economy nearly doubled; immigration nearly quadrupled; the
2020-specific concerns — COVID, police violence, election integrity — drained out almost completely.</div>

<section>
<h2>Theme shares, 2020 vs 2024</h2>
<table>
  <tr><th>Theme</th><th style="text-align:right">2020</th><th style="text-align:right">2024</th><th style="text-align:right">Shift</th></tr>
  <tr><td><b>Economic Anxiety &amp; Fiscal Crisis</b></td><td class="num">29% (865)</td><td class="num"><b>54%</b> (897)</td><td class="num up">+25 pts</td></tr>
  <tr><td><b>Immigration &amp; Border Security</b></td><td class="num">8% (237)</td><td class="num"><b>31%</b> (510)</td><td class="num up">+23 pts</td></tr>
  <tr><td>Military, Foreign Policy &amp; National Security</td><td class="num">9% (277)</td><td class="num">16% (261)</td><td class="num up">+7 pts</td></tr>
  <tr><td>Education, Environment &amp; Moral Decline</td><td class="num">26% (789)</td><td class="num">20% (329)</td><td class="num down">−7 pts</td></tr>
  <tr><td>Political Dysfunction &amp; National Division</td><td class="num"><b>33%</b> (1,003)</td><td class="num">27% (456)</td><td class="num down">−6 pts</td></tr>
  <tr><td>Crime, Drugs &amp; Public Safety</td><td class="num">11% (318)</td><td class="num">14% (225)</td><td class="num up">+3 pts</td></tr>
  <tr><td>Social Inequality, Poverty &amp; Healthcare</td><td class="num">27% (809)</td><td class="num">30% (495)</td><td class="num up">+3 pts</td></tr>
</table>
</section>

<section>
<h2>What the shifts mean</h2>
<div class="card">
<b>2020 was about the moment.</b> Division was young men's #1 problem — its peak in this data — and the
verbatims are saturated with the year itself: COVID everywhere, police violence and racism on one side,
election integrity, censorship, and "government overreach" on the other. The economy ranked only mid-pack,
and read as a <i>symptom</i> of the pandemic ("covid effects on economy," "the pandemic-induced recession").
<br/><br/>
<b>2024 is about the checkout line and the border.</b> The economy's language changed from <i>jobs</i> to
<i>prices</i>: groceries, gas, rent, insurance, "living paycheck to paycheck," "cost of living is insane with
inflation." Immigration's near-quadrupling is the single most dramatic move of any theme — and by 2024 it
appears across the spectrum in young men's answers, not only from the right.
<br/><br/>
<b>What drained away, what crept in.</b> COVID, police brutality, and election-integrity language are nearly
absent from 2024 responses. Foreign wars (Ukraine, the Middle East, China) pushed security to 16%, and
abortion now appears from <i>both</i> directions — "protection of human life" sits beside "rights being taken
away" in the same sample.
</div>
</section>

<section>
<h2>In their words</h2>
<p class="vb"><b>2020</b> — "Covid, economy, foreign affairs" · "Racial injustice, political polarization" · "Voter fraud… big tech is censoring what we see" · "Police murdering black people without consequence" · "I think the most important problem facing this country is how divided we've become."</p>
<p class="vb"><b>2024</b> — "Prices of groceries n fuel n housing" · "cost of living is insane with inflation" · "immigration is number one, legal and especially illegal" · "national debt and inflation… foreign wars and entering them unnecessarily" · "Abortion rights, the increase in restrictive laws."</p>
</section>

<p class="note"><b>Method.</b> Subgroups resolved in-database (Sex = male, Age &le; 39, Year = 2020 / 2024); theme shares
counted exactly over every substantive response with the dataset's own theme model and matcher — the same engines the
platform's TextMine and Charts tabs use, so every figure is recreatable in the app via Filters + TextMine. A response
naming several problems counts in each matching theme, so columns do not sum to 100%. Shares are within-year, so the
different sample sizes do not distort the comparison. All young male respondents; not additionally filtered to validated
voters. Quotes verbatim as written. Source: ANES 1984–2024 dataset (125,897 responses), analyzed 2026-09-04.</p>

</body></html>`

async function main() {
  const chrome = brandedPdfChrome({
    brand: 'Datanautix',
    confidentiality: 'Confidential — Datanautix analysis',
  })
  const pdf = await htmlToPdfBuffer(html, { format: 'letter', ...chrome })
  const out = join(homedir(), 'Downloads', 'Datanautix_ANES_YoungMen_2020v2024.pdf')
  writeFileSync(out, pdf)
  console.log('Wrote', out, pdf.length, 'bytes')
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
