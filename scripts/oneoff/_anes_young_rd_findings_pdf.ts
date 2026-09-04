// One-off: ANES finding brief — what young Republicans and Democrats share
// and where they split, 2012-2024. Numbers computed 2026-09-04 through the
// platform path (segment_match_ids subgroups + the dataset's own theme model
// via commentMatchesTheme over EVERY matched row — exact, not sampled).
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
  table { width: 100%; border-collapse: collapse; margin: 8px 0; break-inside: avoid; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #5C6B64; padding: 4px 8px; border-bottom: 1.5px solid #1A2421; }
  td { padding: 5px 8px; border-bottom: 1px solid rgba(26,36,33,.12); }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .gapR { color: #B91C1C; font-weight: 700; } .gapD { color: #1D4ED8; font-weight: 700; }
  .kicker { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #E85A1A; font-weight: 700; margin-bottom: 4px; }
  section { break-inside: avoid; }
  .note { font-size: 10px; color: #5C6B64; border-top: 1px solid rgba(26,36,33,.12); margin-top: 18px; padding-top: 8px; }
  q { font-style: italic; }
  .vb { font-size: 10.5px; color: #384540; margin: 3px 0; }
  .vb b { color: #0E7476; font-weight: 700; }
`

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>

<div class="kicker">ANES 1984–2024 · Voters under 40 · 2012 onward</div>
<h1>Young Republicans and Democrats: shared ground, split screens</h1>
<p class="sub">What each group names as the country's top problems — 6,472 young Republicans and 9,869 young Democrats
(leaners included) who answered the open-ended "Top Problem" question across the 2012–2024 election studies.</p>

<section>
<h2>What they have in common</h2>
<table>
  <tr><th>Theme</th><th style="text-align:right">Young Republicans</th><th style="text-align:right">Young Democrats</th></tr>
  <tr><td><b>Economic Anxiety &amp; Fiscal Crisis</b></td><td class="num"><b>51%</b> (3,310)</td><td class="num"><b>45%</b> (4,401)</td></tr>
  <tr><td>Political Dysfunction &amp; National Division</td><td class="num">22% (1,397)</td><td class="num">19% (1,832)</td></tr>
  <tr><td>Military, Foreign Policy &amp; National Security</td><td class="num">15% (992)</td><td class="num">15% (1,436)</td></tr>
  <tr><td>Crime, Drugs &amp; Public Safety</td><td class="num">9% (588)</td><td class="num">12% (1,177)</td></tr>
</table>
<div class="card">
<b>The economy is the #1 concern for both — by a wide margin.</b> Over half of young Republicans and nearly half
of young Democrats name it, and the content converges: 2012 verbatims on both sides are jobs and unemployment;
2024 verbatims on both sides are inflation, housing, and the cost of living, in nearly interchangeable words.
<br/><br/>
<b>They agree the country is torn apart.</b> About one in five of <i>both</i> groups names division itself as a
top problem — a young Republican quotes Lincoln's "house divided"; a young Democrat writes "too much political
divide." The theme grows on both sides from 2020 onward. Foreign policy and security concerns are dead even,
and both groups voice distrust of government and corruption in their own words.
</div>
</section>

<section>
<h2>Where they diverge</h2>
<table>
  <tr><th>Theme</th><th style="text-align:right">Young Republicans</th><th style="text-align:right">Young Democrats</th><th style="text-align:right">Gap</th></tr>
  <tr><td>Education, Environment &amp; Moral Decline</td><td class="num">15% (938)</td><td class="num"><b>31%</b> (3,017)</td><td class="num gapD">D +16 pts</td></tr>
  <tr><td>Social Inequality, Poverty &amp; Healthcare</td><td class="num">24% (1,551)</td><td class="num"><b>37%</b> (3,637)</td><td class="num gapD">D +13 pts</td></tr>
  <tr><td>Immigration &amp; Border Security</td><td class="num"><b>21%</b> (1,337)</td><td class="num">10% (982)</td><td class="num gapR">R +11 pts</td></tr>
</table>
<div class="card">
<b>Immigration is the signature young-Republican issue</b> — twice the Democratic rate, present in every wave
(2012 "illegal immigration" &rarr; 2024 "immigration is the biggest issue"). When young Democrats raise it, the
framing flips to family separation and a broken system, not the border.
<br/><br/>
<b>Climate change is the signature young-Democrat issue.</b> The theme it lives in blends education, environment,
and moral decline — the Democratic side of that 31% is overwhelmingly climate; the Republican side of the same
theme is moral-decline and education-cost language. Same bucket, almost entirely different content.
<br/><br/>
<b>Healthcare: both say the word, opposite meanings.</b> Young Democrats frame it as access and equity (insurance
for everyone, a tax code favoring the wealthy, discrimination). Young Republicans frame it as cost ("Obamacare
costing too much," "healthcare costs too much money").
</div>
</section>

<section>
<h2>The arc since 2012</h2>
<p class="vb"><b>2012</b> — Closest together: a shared jobs-and-economy crisis dominates both groups.</p>
<p class="vb"><b>2016</b> — The split hardens. Republicans: terrorism, ISIS, immigration. Democrats: inequality, racism, the tax code.</p>
<p class="vb"><b>2020</b> — Both name COVID and division; Republicans add election integrity and censorship, Democrats add climate, systemic racism, and police violence.</p>
<p class="vb"><b>2024</b> — Partial reconvergence on inflation and housing — while each keeps its signature issue (R: the border · D: democracy itself and reproductive rights).</p>
</section>

<p class="note"><b>Method.</b> Subgroups resolved in-database (Party ID 3-cat, Age &le; 39, Year &ge; 2012); theme shares
counted exactly over every substantive response with the dataset's own theme model and matcher — the same engines the
platform's TextMine and Charts tabs use, so every figure is recreatable in the app via Filters + TextMine. A response
naming several problems counts in each matching theme, so columns do not sum to 100%. Qualitative characterizations are
drawn from evenly-spread verbatim samples read across all four waves. Source: ANES 1984–2024 dataset (125,897 responses),
analyzed 2026-09-04.</p>

</body></html>`

async function main() {
  const chrome = brandedPdfChrome({
    brand: 'Datanautix',
    confidentiality: 'Confidential — Datanautix analysis',
  })
  const pdf = await htmlToPdfBuffer(html, { format: 'letter', ...chrome })
  const out = join(homedir(), 'Downloads', 'Datanautix_ANES_YoungVoters_Findings.pdf')
  writeFileSync(out, pdf)
  console.log('Wrote', out, pdf.length, 'bytes')
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
