// Run: node --conditions=react-server --import tsx scripts/oneoff/_trump_corpus_factoids_pdf.ts
// Companion to the two-page summary: a FACTOIDS reference sheet. The summary
// argues one thing well; this is the full bank of verified numbers with a usable
// line against each, to be picked from. Renders to ~/Downloads.
//
// EVERY NUMBER HERE IS SCRIPT-REPRODUCIBLE. Sources, by section:
//   obsession / days-in-office  _trump_corpus_vanity.ts      → vanity_gap.json
//   name-calling vs empathy     _trump_corpus_insults.ts     → insults_vs_empathy.json
//   economy claims              _trump_corpus_economy_claims.ts → economy_claims.json
//   measles                     _trump_corpus_measles.ts     → measles_contrast.json
//   attention shares            _trump_corpus_salience.ts, _trump_corpus_dedup_check.ts
//   endorsements                _trump_corpus_endorsements.ts, _trump_corpus_dedup_check.ts
//
// ⚠️ EXTERNAL FIGURES ARE TAGGED IN THE UI and are the only ones not counted by
// us: CDC measles and BLS inflation. They are never divided by an attention
// share — different units, different populations. cdc.gov and bls.gov both 403
// our fetcher, so both came from search summaries and carry a confirm-by-eye
// warning on the page itself.
//
// DO NOT REINTRODUCE: the border-vs-health-care ratio (the border is a real
// voter priority; owner killed the framing 2026-08-08), "730+ endorsements"
// (it is 629 distinct letters), "no inflation on 75 days" (mostly past tense
// about his FIRST term — the present-tense figure is 15 days).
import { htmlToPdfBuffer, brandedPdfChrome } from '../../lib/htmlToPdf'
import { writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const TEAL = '#0F7173'
const ORANGE = '#E85A1A'

interface Fact { n: string; fact: string; line?: string; ext?: boolean }
const section = (title: string, blurb: string, facts: Fact[]) => `
<div class="sec keep">
  <h2>${title}</h2>
  <p class="blurb">${blurb}</p>
  ${facts.map((f) => `
  <div class="f">
    <div class="fn${f.n.length > 6 ? ' sm' : ''}">${f.n}</div>
    <div class="fb">
      <p class="ff">${f.fact}${f.ext ? ' <span class="ext">external source</span>' : ''}</p>
      ${f.line ? `<p class="fl">${f.line}</p>` : ''}
    </div>
  </div>`).join('')}
</div>`

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Trump Corpus — Factoids</title><style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
         margin: 0; font-size: 10.2px; line-height: 1.45; color: #334155; }
  .keep { break-inside: avoid; }
  .eyebrow { font-size: 8.5px; letter-spacing: .18em; text-transform: uppercase; color: #94a3b8; font-weight: 700; margin: 0 0 8px; }
  h1 { font-size: 30px; line-height: 1.03; margin: 0 0 9px; color: #0f172a; font-weight: 800; letter-spacing: -.025em; }
  .rule { height: 3px; width: 50px; background: ${ORANGE}; border-radius: 2px; margin: 0 0 13px; }
  .deck { font-size: 10.5px; color: #64748b; margin: 0 0 6px; max-width: 660px; }
  .warn { font-size: 9px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a;
          border-radius: 6px; padding: 8px 11px; margin: 11px 0 0; }

  h2 { font-size: 9.4px; color: ${TEAL}; text-transform: uppercase; letter-spacing: .14em; margin: 0 0 4px; font-weight: 800; }
  .sec { margin-top: 20px; }
  .blurb { font-size: 9.2px; color: #94a3b8; margin: 0 0 9px; }

  .f { display: grid; grid-template-columns: 96px 1fr; gap: 13px; align-items: baseline;
       padding: 7px 0; border-bottom: 1px solid #f1f5f9; }
  .fn { font-size: 25px; font-weight: 800; color: #0f172a; line-height: 1; letter-spacing: -.03em; text-align: right; }
  .fn.sm { font-size: 17px; }
  .ff { font-size: 10.2px; color: #334155; margin: 0; line-height: 1.4; }
  .ff b { color: #0f172a; font-weight: 700; }
  .fl { font-size: 10.3px; font-style: italic; color: #0f172a; margin: 5px 0 0; line-height: 1.35;
        border-left: 2.5px solid ${ORANGE}; padding-left: 9px; font-weight: 500; }
  .ext { font-size: 7.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
         color: #92400e; background: #fef3c7; padding: 1.5px 5px; border-radius: 3px; margin-left: 4px; }

  .method { border-top: 1px solid #e2e8f0; margin-top: 20px; padding-top: 10px; }
  .method p { font-size: 8.8px; color: #94a3b8; line-height: 1.45; margin: 0 0 4px; }
  .method b { color: #64748b; }
</style></head><body>

<p class="eyebrow">Corpus analysis · August 2026</p>
<h1>Factoids</h1>
<div class="rule"></div>
<p class="deck">Every verified number from the corpus of everything Donald Trump has said on the public record and
  posted in his own words since the January 2025 inauguration. <b>55,418 passages</b> — 49,033 paragraphs of speech
  and 6,385 posts — across <b>565 days</b> in office. Reporters' questions, other speakers and reposts are excluded;
  exact duplicates removed. Every figure below is regenerated by script.</p>
<p class="warn"><b>Before sending:</b> the two external figures (CDC measles, BLS inflation) are tagged below. They
  were taken from search summaries of cdc.gov and bls.gov, which block automated reads — confirm those headline
  numbers by eye. Everything untagged is counted directly from the corpus.</p>

${section('The obsession gap', 'Things he returns to constantly that no voter ranks as a priority — against the things they do. Passage counts, one denominator (55,418).', [
  { n: '209', fact: 'passages about <b>the White House ballroom</b>. Three about affordable housing.', line: 'He has talked about his ballroom two hundred and nine times. He has never said the word "preschool."' },
  { n: '196', fact: 'passages about <b>his golf courses and properties</b>. Eight about child care.', line: 'One hundred and ninety-six times he talked about his golf courses. Eight times about child care.' },
  { n: '134', fact: 'passages about <b>the 2020 election</b>. Thirty about wages and paychecks.', line: 'One hundred and thirty-four passages about an election he lost six years ago. Thirty about your paycheck.' },
  { n: '124', fact: 'passages about <b>the Kennedy Center</b>. Twenty about being uninsured or facing medical bills.', line: "He has a plan for the Kennedy Center. He doesn't have one for your health insurance." },
  { n: '103', fact: 'passages about <b>windmills</b>. Eight about child care.', line: 'He talked about windmills a hundred times. He has never once said "good-paying jobs."' },
  { n: '69', fact: 'passages about <b>the Lincoln Memorial Reflecting Pool</b>.', line: 'He found the time for a ballroom, a reflecting pool, a triumphal arch and a Nobel Prize. He never found the time for your rent.' },
  { n: '68', fact: 'passages about <b>winning a Nobel Prize</b>. Sixty-four about renaming the Gulf and Mount McKinley.', line: 'He renamed a mountain and renamed a gulf. He never once mentioned a first-time buyer.' },
  { n: '549', fact: 'passages on the ballroom, golf courses, arch, Reflecting Pool and Nobel <b>combined</b>. Eleven on child care and affordable housing combined.' },
])}

${section('Words he has never said', 'Bare word counts. No interpretation is possible — he either used the word or he did not. This is the strongest evidence in the analysis.', [
  { n: '0', fact: '<b>"preschool"</b>, <b>"uninsured"</b>, <b>"good-paying jobs"</b>, <b>"making ends meet"</b>, <b>"first-time buyer"</b> — none said once in nineteen months.' },
  { n: '1', fact: 'time he has said <b>"minimum wage"</b>. He said "teleprompter" thirty-two times.', line: 'He has complained about teleprompters thirty-two times. He has said "minimum wage" once.' },
  { n: '3', fact: 'times he has said <b>"child care"</b>. He said "golf" a hundred and five times.' },
  { n: '12', fact: 'times he has said <b>"cost of living"</b> in 55,418 passages.', line: "He's given a thousand speeches about your country. He's given twelve sentences about your grocery bill." },
])}

${section('Name-calling versus empathy', 'Invented proper-noun epithets and unambiguous personal slurs only. An earlier draft published 1,575 by counting "fool" (which catches "foolish gift"), "loser" (which catches the legal doctrine "loser pays") and "disgrace" (which is about things) — those are excluded. Ritual condolence after a tragedy is counted separately; he does perform that duty, and pooling it would hide the real gap.', [
  { n: '718', fact: 'passages of <b>name-calling</b>. <b>148</b> acknowledge that ordinary people are struggling — a ratio of <b>4.9 to 1</b>.' },
  { n: '55%', fact: 'of his days in office he called someone a name — <b>312 of 565 days</b>. He mentioned child care on <b>seven</b>.', line: 'He called someone a name on three hundred and twelve of his five hundred and sixty-five days in office. He mentioned child care on seven.' },
  { n: '230', fact: 'times <b>"lunatic"</b>; 207 <b>"Sleepy Joe"</b>; 83 <b>"deranged"</b>; 72 <b>"Crooked Joe"</b>; 40 <b>"low IQ"</b>; 34 <b>"psycho"</b>.' },
  { n: '34', fact: 'passages of <b>condolence after a tragedy</b> — the formal duty of the office, which he does perform. The gap is ordinary hardship, not sympathy in the abstract.' },
])}

${section('"The economy is great" — against the official measure', 'Falsifiable factual assertions, not absences. BLS settles them. Counted in the present tense only: his past-tense boasts about his first term are excluded, which is why this figure is far smaller than a naive keyword count.', [
  { n: '15', fact: 'separate days he said, <b>in the present tense</b>, that there is <b>"no inflation"</b>. Inflation was never zero.', line: 'He told you there was no inflation. It never once hit zero — it ran between 2.7 and 4.2 percent.' },
  { n: '+4.2%', fact: 'CPI over the twelve months to May 2026 — the largest increase since April 2023. It was +2.7% in December 2025 and +3.5% by June 2026.', ext: true },
  { n: '22', fact: 'days he said <b>"groceries are down"</b>. Grocery prices <b>rose 2.7%</b> over the year to June 2026.', line: 'He said groceries were coming down. They went up.', ext: true },
  { n: '108', fact: 'days he described a <b>"golden age"</b>; 85 days <b>"the greatest economy"</b>; 72 days that <b>prices are down</b>.' },
])}

${section('What it cost — public health', 'The only outside statistic paired with his attention. The two are placed side by side and never divided: a case count and a share of days are different units. No causal claim is made or implied.', [
  { n: '+703%', fact: 'more <b>measles cases</b> — 285 in 2024, <b>2,289</b> in 2025, and <b>2,465</b> already by 6 August 2026. Separately, outbreaks tripled, 16 to 48.', ext: true },
  { n: '15.6%', fact: 'of his days in office he spent talking about <b>his new ballroom</b> — 88 of 565 days.', line: 'Is this what you voted for? And every Republican in Congress watched him do it. Is this why you voted for them?' },
])}

${section('The silence gap, in shares', 'Share of everything he says. Two denominators, each used consistently: 49,033 spoken paragraphs, 5,756 posts once the endorsement form letters are removed.', [
  { n: '0.8%', fact: 'of his speeches mention <b>health care</b>; 0.9% of his posts. Housing 0.4%. Child care <b>0.03%</b>.' },
  { n: '0.73%', fact: 'health care when <b>unscripted</b> — tarmac exchanges, phone interviews, gaggles — against 0.82% in staged speeches.', line: "It isn't his speechwriters. Nobody is editing affordability out of his remarks. It isn't in his head." },
  { n: '629', fact: 'distinct <b>candidate endorsement letters</b>, each running a fixed checklist. <b>85%</b> mention the border. <b>1%</b> mention health care.', line: "He wrote out, six hundred and twenty-nine times, exactly what he thinks a good Republican stands for. Health care didn't make the list." },
])}

<div class="method">
  <p><b>Method.</b> Sources are the official public record of presidential documents and a public archive of his
    posts, from 20 January 2025. Only text attributed to him is counted — reporters' questions, cabinet officials and
    reposts of other people's words are stripped out, and exact duplicates removed. Each grouped topic carries a
    published keyword list, and every list was audited so that no single word carries a topic.</p>
  <p><b>What was tested and thrown out</b>, so the method can be checked: "gold" (408 hits) was dropped — it is the
    "golden age" slogan and "liquid gold" for oil, not gilding. "crazy" (539) is "the numbers are crazy". A bare "no
    inflation" match returns 75 days, but most are past tense about his first term, so only present-tense assertions
    are counted. Every list was then re-audited for <b>prefix bleed</b>: the matcher also catches longer words starting
    with a keyword, which is correct for tariff/tariffs but wrong for <b>golf/golfer</b>, so passages only about other
    people golfing are now excluded (248 &rarr; 196). Candidate-endorsement form letters are excluded from post shares;
    they recite a fixed checklist and would otherwise triple immigration and crime without him having discussed either.</p>
  <p><b>These are lower bounds</b> — someone can discuss housing without saying "affordable housing" — so the
    defensible claim is always the comparison, never the absolute count, because both sides were measured by
    identical rules. Voter polling and the CDC and BLS figures are external, cited as such, and never divided
    against an attention share.</p>
</div>

</body></html>`

const out = join(homedir(), 'Downloads', 'Datanautix_TrumpCorpus_Factoids.pdf')
const chrome = brandedPdfChrome({ brand: 'Trump Corpus — Factoids', confidentiality: 'Confidential — for intended recipients only' })
htmlToPdfBuffer(html, { format: 'letter', ...chrome })
  .then((b) => { writeFileSync(out, b); console.log(`Wrote ${out}  (${Math.round(b.length / 1024)} KB)`) })
  .catch((e) => { console.error(e); process.exit(1) })
