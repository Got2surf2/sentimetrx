// Run: node --conditions=react-server --import tsx scripts/_ea_brief_pdf.ts
// Throwaway: renders the warm-meeting brief for the EA / Seann Graddy meeting
// to ~/Downloads as a clean PDF. Personal prep doc — not committed, not a deck route.
import { htmlToPdfBuffer, brandedPdfChrome } from '../../lib/htmlToPdf'
import { writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
         color: #1e2a33; font-size: 11.5px; line-height: 1.45; margin: 0; }
  .wrap { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 22px; color: #0D2B45; margin: 0 0 2px; }
  .meta { color: #5b6b76; font-size: 11px; margin: 0 0 14px; }
  h2 { font-size: 12.5px; color: #0F7173; text-transform: uppercase; letter-spacing: .04em;
       margin: 16px 0 6px; border-bottom: 1.5px solid #D4DDE2; padding-bottom: 3px; }
  .keep { break-inside: avoid; }
  p { margin: 4px 0; }
  ul { margin: 4px 0 4px 0; padding-left: 18px; }
  li { margin: 3px 0; }
  .quote { background: #F4F7F8; border-left: 3px solid #00B4D8; padding: 8px 12px; margin: 6px 0;
           color: #0D2B45; font-style: italic; }
  .ask { background: #0D2B45; color: #fff; padding: 10px 14px; border-radius: 6px; margin: 8px 0;
         font-style: italic; }
  .ask b { color: #4DBFC1; font-style: normal; }
  .hook b, .why b { color: #0D2B45; }
  .tag { color: #E85A1A; font-weight: 700; }
  .muted { color: #5b6b76; }
  .pocket { color: #5b6b76; font-style: italic; font-size: 10.5px; }
  ol { margin: 4px 0 4px 0; padding-left: 18px; }
</style></head><body><div class="wrap">

  <h1>Wednesday — Seann Graddy / EA</h1>
  <p class="meta">Warm first meeting · he invited us in off the pro-bono / board relationship (via Larry).
  Goal: deepen trust, hear what <i>he</i> wants, plant one idea, leave with a small next step. Not a pitch.</p>

  <div class="keep">
  <h2>Who he is</h2>
  <ul>
    <li><b>VP / Executive Producer, EA</b> — owns <b>both</b> football franchises (College Football + Madden). Came up NCAA Football → Madden.</li>
    <li><b>Craft guy, not finance/marketing.</b> Self-described creative ("I make music and edit videos"); makes games for the player experience. → speak <b>player truth &amp; roadmap</b>, not renewal economics.</li>
    <li><b>Orlando neighbor</b> — Winter Garden, FL, beside EA Tiburon.</li>
  </ul>
  </div>

  <div class="keep hook">
  <h2>Warmth hooks (all real)</h2>
  <ol>
    <li><b>Orlando roots</b> — UCF Rosen validated our work; MCO + Orlando-resort engagements. Neighbors, not fly-ins.</li>
    <li><b>Craft to craft</b> — he makes games for the craft; we're 40 years of <i>insight</i> craft.</li>
    <li><b>The pro-bono throughline</b> — trust is already there. Lead with it; let competence show lightly.</li>
  </ol>
  </div>

  <div class="keep">
  <h2>What he asked for (his words)</h2>
  <div class="quote">"…getting more data from our players that are members and those that aren't around what would make the membership valuable to them." &nbsp; "We intend to grow its value over time."</div>
  <p>→ <b>Forward-looking value-discovery. Members AND non-members.</b> Not an autopsy.</p>
  </div>

  <div class="keep why">
  <h2>The one idea: walk the journey (longitudinal)</h2>
  <p>His "grow value over time" <i>is</i> the pitch. A snapshot is stale the day they add a perk; a <b>tracking study is the instrument panel for the growth.</b></p>
  <ul>
    <li><b>Every perk change = a natural experiment</b> → next wave shows if value / join-intent moved, and for whom.</li>
    <li><b>Conversational = you get the <i>why</i> it moved</b>, in their words, wave over wave.</li>
    <li><b>Compounding</b> — each wave richer than the last; a true time-series on what grows membership value.</li>
    <li><b>Two tracks:</b> non-members (what would make you join?) · members (what would make it clearly worth renewing?).</li>
  </ul>
  </div>

  <div class="keep">
  <h2>The 5-question taste <span class="pocket">— back pocket, don't lead with it</span></h2>
  <ol>
    <li>Which modes did members actually live in — and which perks did they forget they had?</li>
    <li>Did Franchise/Dynasty players feel it was built for them, or for the UT crowd?</li>
    <li>Three weeks in — still delivering, or was early access the whole value?</li>
    <li>Non-members: what's the <i>one</i> thing that flips you from no to yes?</li>
    <li>Did people even understand what they bought?</li>
  </ol>
  </div>

  <div class="keep">
  <h2>The soft ask</h2>
  <div class="ask">"Let us <b>baseline it now</b> — a slice of members and non-members, answering exactly what you wrote. We'll show you the kind of 'why' a dashboard and a forum can't. Then we <b>walk it with you</b> as the membership grows."</div>
  </div>

  <div class="keep">
  <h2>Posture</h2>
  <ul>
    <li><b>Listen more than pitch</b> — he already wants the product; don't oversell.</li>
    <li><b>Be humble on the homework</b> — "we can only see the loud 1% online; your members and the players who said no are the 99% we'd go hear for you."</li>
    <li>One idea, one soft ask. Let him lead the next step.</li>
  </ul>
  </div>

</div></body></html>`

;(async () => {
  const chrome = brandedPdfChrome({
    brand: 'EA · Seann Graddy — Meeting Brief',
    confidentiality: 'Internal meeting prep — not for distribution',
  })
  const pdf = await htmlToPdfBuffer(html, {
    format: 'letter',
    headerTemplate: chrome.headerTemplate,
    footerTemplate: chrome.footerTemplate,
    margin: chrome.margin,
  })
  const out = join(homedir(), 'Downloads', 'EA-Graddy-Meeting-Brief.pdf')
  writeFileSync(out, pdf)
  console.log('WROTE', out, pdf.length, 'bytes')
})()
