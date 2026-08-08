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
         margin: 0; font-size: 10.5px; line-height: 1.45; color: #334155; }
  .pb { page-break-after: always; }
  .keep { break-inside: avoid; }

  .eyebrow { font-size: 8.5px; letter-spacing: .18em; text-transform: uppercase; color: #94a3b8;
             font-weight: 700; margin: 0 0 8px; }
  h1 { font-size: 34px; line-height: 1.02; margin: 0 0 10px; color: #0f172a; font-weight: 800; letter-spacing: -.025em; }
  .rule { height: 3px; width: 52px; background: ${ORANGE}; border-radius: 2px; margin: 0 0 14px; }

  /* The thesis. Biggest non-numeric type on the page — everything else supports it. */
  .thesis { font-size: 17px; line-height: 1.28; color: #0f172a; font-weight: 700;
            letter-spacing: -.01em; margin: 0 0 6px; max-width: 620px; }
  .thesis em { color: ${ORANGE}; font-style: normal; }
  .deck { font-size: 10.6px; color: #64748b; margin: 0 0 18px; max-width: 620px; }

  h2 { font-size: 9.4px; color: ${TEAL}; text-transform: uppercase; letter-spacing: .14em;
       margin: 0 0 10px; font-weight: 800; }
  .sec { margin-top: 19px; }

  /* Hero stat: the number carries the point, the label explains it in <10 words,
     the tagline is the sentence a candidate actually says out loud. */
  .hero { display: grid; grid-template-columns: 128px 1fr; gap: 16px; align-items: center;
          background: #0f172a; border-radius: 9px; padding: 16px 18px; margin: 0 0 14px; }
  .hero .num { font-size: 52px; font-weight: 800; color: #fff; line-height: .92;
               letter-spacing: -.04em; text-align: center; }
  .hero .num small { display: block; font-size: 9px; font-weight: 700; color: #94a3b8;
                     letter-spacing: .1em; text-transform: uppercase; margin-top: 7px; }
  .hero .say { font-size: 14.5px; line-height: 1.32; color: #fff; font-weight: 600; margin: 0; }
  .hero .src { font-size: 8.8px; color: #94a3b8; margin: 7px 0 0; }

  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 11px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; }

  .stat { border: 1px solid #e2e8f0; border-top: 3px solid ${ORANGE}; border-radius: 7px;
          padding: 12px 13px 13px; background: #fff; }
  .stat .n { font-size: 31px; font-weight: 800; color: #0f172a; line-height: 1; letter-spacing: -.03em; }
  .stat .lbl { font-size: 9.4px; color: #64748b; margin: 6px 0 0; line-height: 1.35; }
  .stat .lbl b { color: #0f172a; font-weight: 700; }

  /* Taglines. These are the deliverable — quoted, italic, orange keyline. */
  .say { border-left: 2.5px solid ${ORANGE}; padding-left: 11px; margin: 9px 0 0;
         font-size: 11.4px; line-height: 1.34; font-style: italic; color: #0f172a; font-weight: 500; }

  table { width: 100%; border-collapse: collapse; font-size: 10.3px; }
  th { text-align: left; font-size: 8px; text-transform: uppercase; letter-spacing: .1em;
       color: #94a3b8; font-weight: 800; padding: 0 8px 5px 0; border-bottom: 1px solid #e2e8f0; }
  th.n, td.n { text-align: right; padding-right: 0; }
  td { padding: 5px 8px 5px 0; border-bottom: 1px solid #f1f5f9; }
  td.n { font-variant-numeric: tabular-nums; font-weight: 700; color: #0f172a; }
  tr.hi td { background: #fffaf5; }
  tr.hi td:first-child { font-weight: 700; color: #0f172a; }
  tr.hi td.n { color: ${ORANGE}; }

  table.pair th:nth-child(1), table.pair td:nth-child(1) { width: 30%; font-weight: 600; color: #0f172a; }
  table.pair th:nth-child(2), table.pair td:nth-child(2) { width: 15%; padding-right: 32px; }
  table.pair th:nth-child(3), table.pair td:nth-child(3) { width: 40%; color: #64748b; }
  table.pair th:nth-child(4), table.pair td:nth-child(4) { width: 15%; }
  table.pair td.z { color: ${ORANGE}; }

  /* Direct-child selector matters: a bare ".zero div" also hits the .n and .w
     children, boxing each number inside a second border. (No backticks in this
     comment -- the whole stylesheet lives in a JS template literal.) */
  .zero { display: grid; grid-template-columns: repeat(5, 1fr); gap: 9px; }
  .zero > div { text-align: center; border: 1px solid #e2e8f0; border-radius: 7px; padding: 12px 5px 11px; }
  .zero .n { font-size: 29px; font-weight: 800; color: ${ORANGE}; line-height: 1; }
  .zero .w { font-size: 8.7px; color: #475569; margin-top: 7px; line-height: 1.25; }

  .card { border: 1px solid #e2e8f0; border-top: 3px solid ${TEAL}; border-radius: 7px; padding: 12px 14px; background: #fff; }
  .card h3 { font-size: 11px; margin: 0 0 5px; color: #0f172a; font-weight: 700; }
  .card p { font-size: 9.8px; color: #475569; line-height: 1.42; margin: 0; }
  .card p b { color: #0f172a; }

  .method { border-top: 1px solid #e2e8f0; margin-top: 18px; padding-top: 10px; }
  .method .lbl { font-size: 8px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase;
                 color: #94a3b8; margin: 0 0 5px; }
  .method p { font-size: 8.9px; color: #94a3b8; line-height: 1.45; margin: 0 0 4px; }
  .method b { color: #64748b; }
</style></head><body>

<!-- ─────────────────────────── PAGE 1 ─────────────────────────── -->
<p class="eyebrow">Corpus analysis · August 2026</p>
<h1>The Silence Gap</h1>
<div class="rule"></div>
<p class="thesis">He is not losing the argument on affordability.<br>He is <em>not having it.</em></p>
<p class="deck">Every word Donald Trump has spoken on the public record and posted in his own words since the
  January 2025 inauguration — 49,046 passages of speech, 6,638 posts, nineteen months.</p>

<div class="hero keep">
  <div class="num">11<small>of 49,046</small></div>
  <div>
    <p class="say">He's given a thousand speeches about your country. He's given eleven sentences about your grocery bill.</p>
    <p class="src">Passages of speech containing the phrase "cost of living." "Making ends meet" appears once.</p>
  </div>
</div>

<div class="sec">
  <h2>Three numbers, three lines</h2>
  <div class="grid3">
    <div class="stat keep">
      <div class="n">6.2×</div>
      <p class="lbl">He posts about <b>the border</b> six times for every once about <b>health care</b></p>
    </div>
    <div class="stat keep">
      <div class="n">1%</div>
      <p class="lbl">Of his <b>730+ endorsement letters</b> mention health care. 84% mention the border</p>
    </div>
    <div class="stat keep">
      <div class="n">0.03%</div>
      <p class="lbl">Of everything he says is about <b>child care or family costs</b></p>
    </div>
  </div>
  <p class="say">He posts about the border six times for every once he posts about your doctor. Check which one is on your kitchen table.</p>
  <p class="say">He wrote out, seven hundred and thirty times, exactly what he thinks a good Republican stands for. Health care didn't make the list.</p>
  <p class="say">He'll tell you who to blame for your rent. He'll never tell you how to pay it.</p>
</div>

<div class="sec">
  <h2>Words he has never said. Not once.</h2>
  <div class="zero keep">
    <div><div class="n">0</div><div class="w">"good-paying<br>jobs"</div></div>
    <div><div class="n">0</div><div class="w">"uninsured"</div></div>
    <div><div class="n">0</div><div class="w">"preschool"</div></div>
    <div><div class="n">0</div><div class="w">"affordable<br>housing"</div></div>
    <div><div class="n">0</div><div class="w">"first-time<br>buyer"</div></div>
  </div>
  <p class="say">He said "rigged" eighty-three times. He has never once said "uninsured." One of those is happening to him. The other is happening to you.</p>
</div>

<div class="sec">
  <h2>Where his attention actually goes</h2>
  <table>
    <thead><tr><th>Issue</th><th class="n">Of his speeches</th><th class="n">Of his posts</th></tr></thead>
    <tbody>
      <tr><td>Crime</td><td class="n">3.7%</td><td class="n">6.4%</td></tr>
      <tr><td>Tariffs / trade</td><td class="n">3.5%</td><td class="n">6.2%</td></tr>
      <tr><td>Immigration</td><td class="n">2.8%</td><td class="n">5.7%</td></tr>
      <tr class="hi"><td>Housing</td><td class="n">0.4%</td><td class="n">1.0%</td></tr>
      <tr class="hi"><td>Health care</td><td class="n">0.8%</td><td class="n">0.9%</td></tr>
      <tr class="hi"><td>Child care</td><td class="n">0.03%</td><td class="n">0.1%</td></tr>
    </tbody>
  </table>
</div>

<div class="pb"></div>

<!-- ─────────────────────────── PAGE 2 ─────────────────────────── -->
<p class="eyebrow">The Silence Gap · continued</p>

<h2>The finding that matters most</h2>
<p class="thesis" style="font-size:15px;margin-bottom:12px">It isn't his speechwriters.<br>It <em>isn't in his head.</em></p>

<div class="grid2">
  <div class="card keep">
    <h3>Unscripted, he still doesn't say it</h3>
    <p>Strip out every set-piece speech and keep only tarmac exchanges, phone interviews and gaggles —
      <b>25,743 paragraphs</b> of him talking off the cuff. Health care: <b>0.7%</b>, against 0.9% when someone
      writes it for him. In all 25,743, "cost of living" appears <b>three times</b>. "Minimum wage," "uninsured,"
      "affordable housing": <b>zero</b>.</p>
  </div>
  <div class="card keep">
    <h3>Immigration is a script, not an instinct</h3>
    <p>It's <b>3.0%</b> of staged speeches but only <b>2.1%</b> unscripted. Tariffs run the other way —
      <b>3.0%</b> staged, <b>3.9%</b> unscripted. Left to himself, he talks about trade, not the border.</p>
  </div>
</div>
<p class="say">When someone writes his speech, he talks about the border. When he's just talking, he talks about tariffs. Neither one is your rent.</p>

<div class="sec">
  <h2>His words against his words</h2>
  <table class="pair">
    <thead><tr><th>He said…</th><th class="n">times</th><th>…and he said</th><th class="n">times</th></tr></thead>
    <tbody>
      <tr><td>"fake news"</td><td class="n">131</td><td>"cost of living"</td><td class="n z">3</td></tr>
      <tr><td>"rigged"</td><td class="n">83</td><td>"minimum wage"</td><td class="n z">0</td></tr>
      <tr><td>"golf"</td><td class="n">58</td><td>"child care"</td><td class="n z">1</td></tr>
      <tr><td>"beautiful"</td><td class="n">782</td><td>"good-paying jobs"</td><td class="n z">0</td></tr>
    </tbody>
  </table>
  <p class="say">He said "beautiful" seven hundred and eighty-two times. He has never once said "good-paying jobs."</p>
  <p class="say">He gave one hundred and twenty-nine paragraphs to attacking Joe Biden. He gave six to the cost of raising a child.</p>
</div>

<div class="sec">
  <h2>How to use it</h2>
  <div class="grid2">
    <div class="card keep">
      <h3>Silence gaps — health care, housing, child care, wages</h3>
      <p>Don't argue with his position. He doesn't have one. Make the absence the story. <b>Silence is harder to
        rebut than a bad policy — there's no quote to fight back with.</b></p>
    </div>
    <div class="card keep">
      <h3>Position gaps — immigration, crime, tariffs</h3>
      <p>Here he's loud, so absence framing fails. Put what he actually said next to what the voter believes —
        <b>his words, with a date and a source.</b> The real quote always beats a paraphrase.</p>
    </div>
  </div>
</div>

<div class="method">
  <p class="lbl">What these numbers are — and are not</p>
  <p>Sources are the official public record of presidential documents and a public archive of his posts, from 20 January
    2025. <b>Only text attributed to him is counted</b> — reporters' questions, cabinet officials and reposts of other
    people's words are stripped out, which materially changes the result and is the step most analyses skip. Every issue
    is measured by an explicit, published word list, and every figure is regenerated by script, never counted by hand.</p>
  <p><b>These are lower bounds.</b> Someone can discuss affordability without saying "affordability" — so the defensible
    claim is never the absolute percentage, it's the comparison, because every issue was measured by identical rules.
    Candidate-endorsement form letters are excluded from the post figures; they recite a fixed checklist and would
    otherwise triple immigration and crime without him having discussed either. Voter-priority polling is cited
    separately and never divided against these shares — different units, different populations.</p>
</div>

</body></html>`

const out = join(homedir(), 'Downloads', 'Datanautix_TheSilenceGap_Summary.pdf')
const chrome = brandedPdfChrome({ brand: 'The Silence Gap', confidentiality: 'Confidential — for intended recipients only' })

htmlToPdfBuffer(html, { format: 'letter', ...chrome })
  .then((buf) => { writeFileSync(out, buf); console.log(`Wrote ${out}  (${Math.round(buf.length / 1024)} KB)`) })
  .catch((err) => { console.error(err); process.exit(1) })
