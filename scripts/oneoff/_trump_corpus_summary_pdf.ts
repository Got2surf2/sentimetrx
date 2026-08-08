// Run: node --conditions=react-server --import tsx scripts/oneoff/_trump_corpus_summary_pdf.ts
// Throwaway: two-page shareable summary of the "Silence Gap" corpus analysis, for an
// EXTERNAL reader (campaign / consultant / prospect). Renders to ~/Downloads.
//
// The long-form internal version is ~/Downloads/trump-corpus/REPORT_democratic_talking_points.md.
// This is the teaser, not a replacement — it carries the findings and enough method to be
// trusted, and stops short of the build recipe.
//
// NUMBER DISCIPLINE — every figure here traces to a script, none computed by hand:
//   _trump_corpus_salience.ts     attention shares (spoken n=49,046)
//   _trump_corpus_endorsements.ts post shares, endorsement-excluded (n=5,901)
//   _trump_corpus_ratios.ts       word counts + topic ratios, unscripted (n=25,743)
//   _trump_corpus_audit.ts        the zero-and-once claims
//
// DO NOT REINTRODUCE (both retracted 2026-08-08, see project_trump_corpus memory):
//   - "16x / sixteen posts about the border" — that is the UNCORRECTED ratio, 84% of it
//     endorsement boilerplate. The number is 6.2x. It has been retracted twice now.
//   - "voters rank immigration ninth" — Gallup's 9% misread as a rank.
// Endorsement count is stated as "more than 730" on purpose: the exact figure moves
// between 733 and 737 depending on how strictly the form letter is matched, and an
// external one-pager should not hang on a matcher choice.
//
// Poll figures are EXTERNAL and always labelled as such — a voter-priority % and an
// attention-share % are different units on different populations and are never divided.
import { htmlToPdfBuffer, brandedPdfChrome } from '../../lib/htmlToPdf'
import { writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const TEAL = '#0F7173'
const ORANGE = '#E85A1A'

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
         margin: 0; font-size: 10.4px; line-height: 1.5; color: #1f2937; }
  .pb { page-break-after: always; }
  .keep { break-inside: avoid; }

  .eyebrow { font-size: 8.5px; letter-spacing: .17em; text-transform: uppercase; color: #94a3b8;
             font-weight: 700; margin: 0 0 9px; }
  h1 { font-size: 26px; line-height: 1.08; margin: 0 0 8px; color: #0f172a; font-weight: 800; letter-spacing: -.015em; }
  .rule { height: 3px; width: 54px; background: ${ORANGE}; border-radius: 2px; margin: 0 0 14px; }
  .sub { font-size: 12.5px; color: #475569; margin: 0 0 6px; max-width: 660px; line-height: 1.45; }
  .sub b { color: #0f172a; font-weight: 700; }
  .scale { font-size: 9.4px; color: #94a3b8; margin: 0 0 14px; }

  h2 { font-size: 9.6px; color: ${TEAL}; text-transform: uppercase; letter-spacing: .13em;
       margin: 15px 0 7px; font-weight: 800; }
  p { margin: 0 0 9px; }
  p:last-child { margin-bottom: 0; }

  .lead { background: #f8fafc; border-left: 3px solid ${ORANGE}; border-radius: 0 5px 5px 0;
          padding: 11px 15px; margin: 0 0 14px; }
  .lead p { font-size: 13px; color: #0f172a; font-weight: 600; line-height: 1.4; margin: 0; }

  table { width: 100%; border-collapse: collapse; margin: 9px 0 0; font-size: 10.2px; }
  th { text-align: left; font-size: 8px; text-transform: uppercase; letter-spacing: .1em;
       color: #94a3b8; font-weight: 800; padding: 0 8px 6px 0; border-bottom: 1px solid #e2e8f0; }
  th.n, td.n { text-align: right; padding-right: 0; }
  td { padding: 5.5px 8px 5.5px 0; border-bottom: 1px solid #f1f5f9; color: #334155; }
  td.n { font-variant-numeric: tabular-nums; font-weight: 600; color: #0f172a; }
  tr.hi td { background: #fffaf5; }
  tr.hi td:first-child { font-weight: 700; color: #0f172a; }
  tr.hi td.n { color: ${ORANGE}; }
  .den { font-size: 8.6px; color: #94a3b8; margin: 6px 0 0; }

  /* Four-column "his words vs his words" table. The numeric columns sit mid-row,
     so they need explicit widths and right padding — without it the count butts
     straight into the next phrase and reads as one string. */
  table.pair th:nth-child(1), table.pair td:nth-child(1) { width: 31%; }
  table.pair th:nth-child(2), table.pair td:nth-child(2) { width: 14%; padding-right: 34px; }
  table.pair th:nth-child(3), table.pair td:nth-child(3) { width: 41%; }
  table.pair th:nth-child(4), table.pair td:nth-child(4) { width: 14%; }
  table.pair td:nth-child(3) { color: #64748b; }

  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-top: 3px solid ${TEAL};
          border-radius: 7px; padding: 12px 14px; }
  .card h3 { font-size: 10.6px; margin: 0 0 6px; color: #0f172a; font-weight: 700; }
  .card p { font-size: 9.9px; color: #475569; line-height: 1.45; }

  .quote { border-left: 2px solid ${ORANGE}; padding-left: 11px; margin: 9px 0 0;
           font-size: 10.4px; font-style: italic; color: #0f172a; }

  .note { background: #f8fafc; border-radius: 5px; padding: 11px 14px; margin: 14px 0 0; }
  .note .lbl { font-size: 8px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase;
               color: ${TEAL}; display: block; margin-bottom: 5px; }
  .note p { font-size: 9.6px; color: #475569; line-height: 1.45; }
</style></head><body>

<!-- ─────────────────────────── PAGE 1 ─────────────────────────── -->
<p class="eyebrow">Corpus analysis · August 2026</p>
<h1>The Silence Gap</h1>
<div class="rule"></div>
<p class="sub">What voters say matters — and what Donald Trump <b>actually talks about</b>.</p>
<p class="scale">Every word on the public record and every post in his own words since the January 2025 inauguration ·
  49,046 passages of speech · 6,638 posts · reporters' questions and other speakers removed throughout.</p>

<div class="lead"><p>He is not losing the argument on affordability. He is not having it.</p></div>

<h2>What he spends his attention on</h2>
<table>
  <thead><tr><th>Issue</th><th class="n">Share of speeches</th><th class="n">Share of posts</th></tr></thead>
  <tbody>
    <tr><td>Crime / public safety</td><td class="n">3.7%</td><td class="n">6.4%</td></tr>
    <tr><td>Tariffs / trade</td><td class="n">3.5%</td><td class="n">6.2%</td></tr>
    <tr><td>Immigration / border</td><td class="n">2.8%</td><td class="n">5.7%</td></tr>
    <tr><td>Cost of living / prices</td><td class="n">1.5%</td><td class="n">2.0%</td></tr>
    <tr class="hi"><td>Housing affordability</td><td class="n">0.4%</td><td class="n">1.0%</td></tr>
    <tr class="hi"><td>Health care</td><td class="n">0.8%</td><td class="n">0.9%</td></tr>
    <tr><td>Wages / jobs</td><td class="n">0.2%</td><td class="n">0.4%</td></tr>
    <tr class="hi"><td>Child care / family costs</td><td class="n">0.03%</td><td class="n">0.1%</td></tr>
  </tbody>
</table>
<p class="den">Two denominators, each used consistently down its own column: 49,046 spoken paragraphs, and 5,901 posts
  after removing the 730+ candidate-endorsement form letters, which recite a fixed checklist and would otherwise
  triple the immigration and crime figures without him having discussed either.</p>

<h2>What voters say matters <span style="color:#94a3b8;font-weight:700">— external polling, not this corpus</span></h2>
<p>Health care is <b>second</b> among national priorities at <b>52%</b> extremely or very important, and <b>64%</b>
  say they worry about affording it. Gallup's most-important-problem tracking in July 2026 put economic issues at
  <b>36%</b> and immigration at <b>9%</b>. His attention runs close to the reverse.</p>

<h2>Things he has not said once</h2>
<div class="grid2">
  <div>
    <table>
      <tbody>
        <tr><td>"good-paying jobs"</td><td class="n">0</td></tr>
        <tr><td>"uninsured"</td><td class="n">0</td></tr>
        <tr><td>"preschool"</td><td class="n">0</td></tr>
      </tbody>
    </table>
  </div>
  <div>
    <table>
      <tbody>
        <tr><td>"affordable housing"</td><td class="n">0</td></tr>
        <tr><td>"first-time buyer"</td><td class="n">0</td></tr>
        <tr><td>"minimum wage"</td><td class="n">1</td></tr>
      </tbody>
    </table>
  </div>
</div>
<p class="den">Across the full corpus, nineteen months. "Cost of living" appears in 11 of 49,046 spoken passages;
  "making ends meet", once.</p>

<h2>His own endorsement letter tells you what he cares about</h2>
<p>He has posted more than <b>730</b> candidate endorsements, all running off a fixed checklist — <i>Strong on Borders,
  Crime, the Military, the Second Amendment.</i> Measured across all of them:</p>
<table class="keep">
  <thead><tr><th>Mentioned in his endorsements</th><th class="n">Share</th></tr></thead>
  <tbody>
    <tr><td>The border</td><td class="n">84%</td></tr>
    <tr><td>Crime</td><td class="n">70%</td></tr>
    <tr class="hi"><td>Health care</td><td class="n">1%</td></tr>
  </tbody>
</table>
<p class="quote">He wrote out, seven hundred and thirty times, exactly what he thinks a good Republican stands for.
  Health care didn't make the list.</p>

<div class="pb"></div>

<!-- ─────────────────────────── PAGE 2 ─────────────────────────── -->
<p class="eyebrow">The Silence Gap · continued</p>

<h2>The finding that matters most</h2>
<p>Filtering the spoken record to <b>unscripted</b> material only — tarmac and plane exchanges, Oval Office sprays,
  phone interviews, gaggles; <b>384 documents, 25,743 paragraphs</b>, every set-piece speech removed — tests whether
  the absence is a staffing artefact or a genuine blind spot.</p>

<div class="grid2" style="margin-top:11px">
  <div class="card keep">
    <h3>It is not a staffing problem</h3>
    <p>Affordability is just as absent when he is unscripted as when he is reading prepared remarks — health care
      <b>0.7%</b> unscripted vs <b>0.9%</b> staged. Nobody is editing it out of his speeches. It is not in his head.
      In 25,743 unscripted paragraphs he said "cost of living" three times, and "minimum wage", "uninsured",
      "affordable housing" and "good-paying jobs" zero times each.</p>
  </div>
  <div class="card keep">
    <h3>Immigration is a script, not an instinct</h3>
    <p>It is <b>3.0%</b> of staged speeches but only <b>2.1%</b> unscripted. Tariffs run the other way —
      <b>3.0%</b> staged, <b>3.9%</b> unscripted. Left to his own devices he talks about trade, not the border.</p>
    <p class="quote">When someone writes his speech, he talks about the border. When he's just talking, he talks
      about tariffs. Neither one is your rent.</p>
  </div>
</div>

<h2>His words against his words</h2>
<p>Unscripted only, one corpus, one measure. No interpretation is possible here — he either said the word or he did not.</p>
<table class="pair">
  <thead><tr><th>He said…</th><th class="n">times</th><th>…and he said</th><th class="n">times</th></tr></thead>
  <tbody>
    <tr><td>"fake news"</td><td class="n">131</td><td>"cost of living"</td><td class="n">3</td></tr>
    <tr><td>"rigged"</td><td class="n">83</td><td>"minimum wage"</td><td class="n">0</td></tr>
    <tr><td>"golf"</td><td class="n">58</td><td>"child care"</td><td class="n">1</td></tr>
    <tr><td>"landslide"</td><td class="n">58</td><td>"affordable housing"</td><td class="n">0</td></tr>
    <tr><td>"beautiful"</td><td class="n">782</td><td>"good-paying jobs"</td><td class="n">0</td></tr>
  </tbody>
</table>
<p class="den">In 25,743 unscripted paragraphs he devoted <b>129</b> to attacking Joe Biden personally and <b>6</b> to
  the cost of raising a child; <b>150</b> to his election margin and <b>11</b> to wages and paychecks. The raw counts
  carry these, not the ratios — six paragraphs in nineteen months is the more damning number.</p>

<h2>Two ways to use this</h2>
<div class="grid2" style="margin-top:11px">
  <div class="card keep">
    <h3>Silence gaps</h3>
    <p><b>Health care, housing, child care, wages.</b> Do not argue with his position — he does not have one to argue
      with. Make the absence the story. Silence is harder to rebut than a bad policy, because there is no quote to
      fight back with.</p>
  </div>
  <div class="card keep">
    <h3>Position gaps</h3>
    <p><b>Immigration, crime, tariffs.</b> Here he is loud, so absence framing fails. Put what he actually said next
      to what the voter believes — in his own words, with a date and a source. The real quote is always stronger
      than a paraphrase.</p>
  </div>
</div>

<div class="note keep">
  <span class="lbl">Method, and what these numbers are not</span>
  <p>Sources are the official public record of presidential documents and a public archive of his posts, from
    20 January 2025. Only text attributed to him is counted — reporters' questions, cabinet officials and reposts
    of other people's words are excluded, which materially changes the result and is the step most analyses skip.
    Each issue is measured by an explicit, published word list, so every figure can be traced to the exact words
    that produced it, and every figure above is regenerated by script rather than counted by hand.</p>
  <p style="margin-top:7px">These are <b>lower bounds</b> — someone can discuss affordability without saying
    "affordability". The defensible claim is never the absolute percentage; it is the <b>comparison</b>, because
    every issue was measured by identical rules. Two limits to respect: voter-priority figures come from external
    polling and describe what voters want, never what this corpus measures, and the two are reported side by side
    and never divided. And the official spoken record publishes on roughly a five-week lag, so speech and posts
    should not be charted together across that boundary.</p>
</div>

</body></html>`

const out = join(homedir(), 'Downloads', 'Datanautix_TheSilenceGap_Summary.pdf')
const chrome = brandedPdfChrome({ brand: 'The Silence Gap', confidentiality: 'Confidential — for intended recipients only' })

htmlToPdfBuffer(html, { format: 'letter', ...chrome })
  .then((buf) => { writeFileSync(out, buf); console.log(`Wrote ${out}  (${Math.round(buf.length / 1024)} KB)`) })
  .catch((err) => { console.error(err); process.exit(1) })
