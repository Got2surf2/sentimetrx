// Run: node --conditions=react-server --import tsx scripts/oneoff/_trump_corpus_summary_pdf.ts
// Throwaway: two-page shareable summary of the "Silence Gap" corpus analysis, for an
// EXTERNAL reader (campaign / consultant / prospect). Renders to ~/Downloads.
//
// The long-form internal version is ~/Downloads/trump-corpus/REPORT_democratic_talking_points.md.
// This is the teaser, not a replacement — it carries the findings and enough method to be
// trusted, and stops short of the build recipe.
//
// NUMBER DISCIPLINE — every figure here traces to a script, none computed by hand.
// ALL FIGURES ARE ON THE DEDUPED CORPUS (exact-duplicate units removed):
//   _trump_corpus_dedup_check.ts  denominators, unscripted/staged, endorsement letters
//   _trump_corpus_endorsements.ts post shares, endorsement-excluded
//   _trump_corpus_ratios.ts       word counts + topic ratios, unscripted
//   _trump_corpus_audit.ts        the zero-and-once claims
// Denominators: 49,033 spoken paragraphs · 6,385 own-word posts · 25,732 unscripted
// · 5,756 posts excluding endorsements. Do not mix these with the pre-dedup values
// (49,046 / 6,638 / 25,743 / 5,901) that earlier drafts used.
//
// DO NOT REINTRODUCE (all retracted 2026-08-08, see project_trump_corpus memory):
//   - "16x / sixteen posts about the border" — the UNCORRECTED ratio, 84% of it
//     endorsement boilerplate. The number is 6.3x. It has been retracted twice.
//   - "voters rank immigration ninth" — Gallup's 9% misread as a rank.
//   - "730+ endorsements" — 737 POSTS contain the form letter but 108 are duplicate
//     re-posts of an identical letter, so it is 629 DISTINCT letters. The count of
//     distinct PEOPLE is lower still (he re-endorses the same candidate) and is NOT
//     stated anywhere, because name extraction from the letters is not reliable.
//     Never phrase this as "730+ candidates" or "730+ different people".
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

  .thesis { font-size: 17px; line-height: 1.28; color: #0f172a; font-weight: 700;
            letter-spacing: -.01em; margin: 0 0 6px; max-width: 640px; }
  .thesis em { color: ${ORANGE}; font-style: normal; }
  .deck { font-size: 10.6px; color: #64748b; margin: 0 0 15px; max-width: 640px; }

  h2 { font-size: 9.4px; color: ${TEAL}; text-transform: uppercase; letter-spacing: .14em;
       margin: 0 0 9px; font-weight: 800; }
  .sec { margin-top: 17px; }

  /* Hero: the single starkest pair. Two bare word counts, no interpretation. */
  .hero { background: #0f172a; border-radius: 9px; padding: 15px 18px; margin: 0 0 13px; }
  .hero .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 11px; }
  .hero .side .n { font-size: 44px; font-weight: 800; line-height: .95; letter-spacing: -.04em; color: #fff; }
  .hero .side .n.z { color: ${ORANGE}; }
  .hero .side .w { font-size: 10px; color: #94a3b8; margin-top: 5px; }
  .hero .side .w b { color: #fff; font-weight: 700; }
  .hero .say { font-size: 14px; line-height: 1.32; color: #fff; font-weight: 600; margin: 0;
               border-top: 1px solid #334155; padding-top: 10px; }

  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 11px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; }

  .stat { border: 1px solid #e2e8f0; border-top: 3px solid ${ORANGE}; border-radius: 7px;
          padding: 11px 13px 12px; background: #fff; }
  .stat .n { font-size: 29px; font-weight: 800; color: #0f172a; line-height: 1; letter-spacing: -.03em; }
  .stat .lbl { font-size: 9.3px; color: #64748b; margin: 6px 0 0; line-height: 1.35; }
  .stat .lbl b { color: #0f172a; font-weight: 700; }

  .say { border-left: 2.5px solid ${ORANGE}; padding-left: 11px; margin: 9px 0 0;
         font-size: 11.4px; line-height: 1.34; font-style: italic; color: #0f172a; font-weight: 500; }

  table { width: 100%; border-collapse: collapse; font-size: 10.3px; }
  th { text-align: left; font-size: 8px; text-transform: uppercase; letter-spacing: .1em;
       color: #94a3b8; font-weight: 800; padding: 0 8px 5px 0; border-bottom: 1px solid #e2e8f0; }
  th.n, td.n { text-align: right; padding-right: 0; }
  td { padding: 5px 8px 5px 0; border-bottom: 1px solid #f1f5f9; }
  td.n { font-variant-numeric: tabular-nums; font-weight: 700; color: #0f172a; }

  /* Mid-row numeric columns need their own padding; the shared .n class zeroes it
     and the count would butt straight into the next phrase. */
  table.pair th:nth-child(1), table.pair td:nth-child(1) { width: 30%; font-weight: 600; color: #0f172a; }
  table.pair th:nth-child(2), table.pair td:nth-child(2) { width: 15%; padding-right: 32px; }
  table.pair th:nth-child(3), table.pair td:nth-child(3) { width: 40%; color: #64748b; }
  table.pair th:nth-child(4), table.pair td:nth-child(4) { width: 15%; }
  table.pair td.z { color: ${ORANGE}; }

  .card { border: 1px solid #e2e8f0; border-top: 3px solid ${TEAL}; border-radius: 7px; padding: 12px 14px; background: #fff; }
  .card h3 { font-size: 11px; margin: 0 0 5px; color: #0f172a; font-weight: 700; }
  .card p { font-size: 9.8px; color: #475569; line-height: 1.42; margin: 0; }
  .card p b { color: #0f172a; }

  .method { border-top: 1px solid #e2e8f0; margin-top: 16px; padding-top: 10px; }
  .method .lbl { font-size: 8px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase;
                 color: #94a3b8; margin: 0 0 5px; }
  .method p { font-size: 8.9px; color: #94a3b8; line-height: 1.45; margin: 0 0 4px; }
  .method b { color: #64748b; }
</style></head><body>

<!-- ─────────────────────────── PAGE 1 ─────────────────────────── -->
<p class="eyebrow">Corpus analysis · August 2026</p>
<h1>The Silence Gap</h1>
<div class="rule"></div>
<p class="thesis">Everything he found time to talk about.<br>And <em>what he never got to.</em></p>
<p class="deck">Every word Donald Trump has spoken on the public record and posted in his own words since the
  January 2025 inauguration — 55,418 passages, nineteen months. These are raw counts of his own words. He either
  said it or he didn't.</p>

<div class="hero keep">
  <div class="pair">
    <div class="side">
      <div class="n">209</div>
      <div class="w">times he has said <b>"ballroom"</b></div>
    </div>
    <div class="side">
      <div class="n z">0</div>
      <div class="w">times he has said <b>"preschool"</b></div>
    </div>
  </div>
  <p class="say">He has talked about his ballroom two hundred and nine times. He has never said the word "preschool."</p>
</div>

<div class="sec">
  <h2>He said it. He never said that.</h2>
  <table class="pair">
    <thead><tr><th>He said…</th><th class="n">times</th><th>…and in nineteen months, never</th><th class="n">times</th></tr></thead>
    <tbody>
      <tr><td>"ballroom"</td><td class="n">209</td><td>"preschool"</td><td class="n z">0</td></tr>
      <tr><td>"golf"</td><td class="n">159</td><td>"uninsured"</td><td class="n z">0</td></tr>
      <tr><td>"windmill"</td><td class="n">100</td><td>"good-paying jobs"</td><td class="n z">0</td></tr>
      <tr><td>"reflecting pool"</td><td class="n">69</td><td>"making ends meet"</td><td class="n z">0</td></tr>
      <tr><td>"Nobel"</td><td class="n">68</td><td>"first-time buyer"</td><td class="n z">0</td></tr>
      <tr><td>"teleprompter"</td><td class="n">32</td><td>"minimum wage"</td><td class="n z">1</td></tr>
    </tbody>
  </table>
  <p class="say">He has complained about teleprompters thirty-two times. He has said "minimum wage" once.</p>
</div>

<div class="sec">
  <h2>The obsession gap</h2>
  <div class="grid3">
    <div class="stat keep">
      <div class="n">70×</div>
      <p class="lbl">More on <b>the ballroom</b> than on <b>affordable housing</b> — 209 passages against 3</p>
    </div>
    <div class="stat keep">
      <div class="n">31×</div>
      <p class="lbl">More on <b>his golf courses</b> than on <b>child care</b> — 248 against 8</p>
    </div>
    <div class="stat keep">
      <div class="n">23×</div>
      <p class="lbl">More on <b>the Reflecting Pool</b> than on <b>affordable housing</b> — 69 against 3</p>
    </div>
  </div>
  <p class="say">He found the time for a ballroom, a reflecting pool, a triumphal arch and a Nobel Prize. He never found the time for your rent.</p>
</div>

<div class="pb"></div>

<!-- ─────────────────────────── PAGE 2 ─────────────────────────── -->
<p class="eyebrow">The Silence Gap · continued</p>

<h2>What he cannot stop talking about</h2>
<div class="grid2">
  <div>
    <table>
      <tbody>
        <tr><td>His golf courses and properties</td><td class="n">248</td></tr>
        <tr><td>The White House ballroom</td><td class="n">209</td></tr>
        <tr><td>The 2020 election</td><td class="n">134</td></tr>
        <tr><td>The Kennedy Center</td><td class="n">124</td></tr>
        <tr><td>Windmills</td><td class="n">103</td></tr>
      </tbody>
    </table>
  </div>
  <div>
    <table>
      <tbody>
        <tr><td>The Lincoln Memorial Reflecting Pool</td><td class="n">69</td></tr>
        <tr><td>Winning a Nobel Prize</td><td class="n">68</td></tr>
        <tr><td>Renaming the Gulf and Mount McKinley</td><td class="n">64</td></tr>
        <tr><td>Teleprompters</td><td class="n">32</td></tr>
        <tr><td>A triumphal arch for Washington</td><td class="n">13</td></tr>
      </tbody>
    </table>
  </div>
</div>
<p class="say">Six hundred and one passages on the ballroom, the golf courses, the arch, the Reflecting Pool and his Nobel Prize. Eleven on child care and affordable housing.</p>

<div class="sec">
  <h2>It isn't his speechwriters. It isn't in his head.</h2>
  <div class="grid2">
    <div class="card keep">
      <h3>Unscripted, nothing changes</h3>
      <p>Strip out every set-piece speech and keep only tarmac exchanges, phone interviews and gaggles —
        <b>25,732 paragraphs</b> off the cuff. Health care: <b>0.73%</b>, against 0.82% when someone writes it
        for him. Nobody is editing affordability out of his remarks. It simply isn't there.</p>
    </div>
    <div class="card keep">
      <h3>Silence is the harder thing to rebut</h3>
      <p>Don't argue with his position on housing or child care — <b>he doesn't have one.</b> Make the absence
        the story. There is no quote for him to fight back with, and no policy to defend. He can't produce a
        record that doesn't exist.</p>
    </div>
  </div>
</div>

<div class="sec">
  <h2>Lines you can use</h2>
  <p class="say">Two hundred and forty-eight times he talked about his golf courses. Eight times about child care.</p>
  <p class="say">He talked about windmills a hundred times. He has never once said "good-paying jobs."</p>
  <p class="say">He has a plan for the Kennedy Center. He doesn't have one for your health insurance.</p>
  <p class="say">One hundred and thirty-four passages about an election he lost six years ago. Thirty about your paycheck.</p>
  <p class="say">He renamed a mountain and renamed a gulf. He never once mentioned a first-time buyer.</p>
</div>

<div class="method">
  <p class="lbl">What these numbers are — and are not</p>
  <p>Sources are the official public record of presidential documents and a public archive of his posts, from 20 January
    2025. <b>Only text attributed to him is counted</b> — reporters' questions, cabinet officials and reposts of other
    people's words are stripped out, and exact duplicates removed. A "passage" is one paragraph of speech or one post;
    the denominator is <b>55,418</b> throughout. Every figure is regenerated by script, never counted by hand.</p>
  <p><b>The word counts are the strongest form of this evidence</b> — no interpretation is possible, he either used the
    word or he did not. The grouped topics carry a keyword list, published alongside, and each was audited so that no
    single word carries a topic: "gold" was tested and <b>dropped</b>, because it turned out to be the "golden age"
    slogan and "liquid gold" for oil rather than anything gilded. <b>These are lower bounds</b> — someone can discuss
    housing without saying "affordable housing" — so the defensible claim is the comparison, not the absolute count,
    because both sides were measured by identical rules.</p>
</div>

</body></html>`

const out = join(homedir(), 'Downloads', 'Datanautix_TheSilenceGap_Summary.pdf')
const chrome = brandedPdfChrome({ brand: 'The Silence Gap', confidentiality: 'Confidential — for intended recipients only' })

htmlToPdfBuffer(html, { format: 'letter', ...chrome })
  .then((buf) => { writeFileSync(out, buf); console.log(`Wrote ${out}  (${Math.round(buf.length / 1024)} KB)`) })
  .catch((err) => { console.error(err); process.exit(1) })
