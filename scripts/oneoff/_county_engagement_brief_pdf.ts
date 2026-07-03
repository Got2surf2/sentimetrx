// Run: node --conditions=react-server --import tsx scripts/_county_engagement_brief_pdf.ts
// Throwaway: 1-page county-facing brief — why the Sarina / always-on engagement model
// beats the traditional outreach-vendor approach. For Orange County (Hall Road first vehicle).
// Outbound BD doc — not committed. No fabricated metrics; no incumbent named.
import { htmlToPdfBuffer, brandedPdfChrome } from '../../lib/htmlToPdf'
import { writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
         color: #1e2a33; font-size: 10.6px; line-height: 1.42; margin: 0; }
  .wrap { max-width: 760px; margin: 0 auto; }
  .brandline { font-weight: 700; font-size: 13px; margin: 0; letter-spacing: .01em; }
  .brandline .d { color: #0F7173; } .brandline .n { color: #E85A1A; }
  h1 { font-size: 18px; color: #0D2B45; margin: 3px 0 2px; }
  .meta { color: #5b6b76; font-size: 10.2px; margin: 0 0 10px; }
  h2 { font-size: 10.8px; color: #0F7173; text-transform: uppercase; letter-spacing: .04em;
       margin: 12px 0 5px; border-bottom: 1.5px solid #D4DDE2; padding-bottom: 2px; }
  .keep { break-inside: avoid; }
  p { margin: 4px 0; }
  ul { margin: 3px 0; padding-left: 16px; }
  li { margin: 3px 0; }
  b { color: #0D2B45; }
  .lead { background: #F4F7F8; border-left: 3px solid #0F7173; padding: 9px 13px; margin: 4px 0 2px; }
  .hook { background: #0D2B45; color: #eaf2f4; padding: 10px 14px; border-radius: 6px; margin: 6px 0; }
  .hook b { color: #4DBFC1; }
  table.cmp { width: 100%; border-collapse: collapse; margin: 4px 0; font-size: 10px; }
  table.cmp th { text-align: left; padding: 5px 8px; font-size: 9.6px; text-transform: uppercase; letter-spacing:.03em; }
  table.cmp th.t { background: #E7ECEF; color: #5b6b76; }
  table.cmp th.o { background: #0F7173; color: #fff; }
  table.cmp td { border-bottom: 1px solid #E1E8EC; padding: 5px 8px; vertical-align: top; width: 50%; }
  table.cmp td.o { color: #0D2B45; font-weight: 600; }
  .inv td { padding: 4px 8px 4px 0; vertical-align: top; font-size: 10px; }
  .inv td.k { color: #0F7173; font-weight: 700; white-space: nowrap; width: 165px; }
  .fee { color: #0D2B45; font-weight: 700; }
  .muted { color: #5b6b76; }
  .foot { margin-top: 12px; font-size: 10px; color: #5b6b76; }
</style></head><body><div class="wrap">

  <p class="brandline"><span class="d">data</span><span class="n">nautix</span></p>
  <h1>A Better Way to Run Public Engagement</h1>
  <p class="meta">Prepared for Orange County Transportation · Starting project: <b>Hall Road</b> ·
  Powered by <b>Sarina</b>, your always-on resident-engagement agent</p>

  <div class="lead keep">
  The traditional model builds a project website, pushes a survey, and runs some promotion — and then
  every resident question lands right back on your project team and listed points of contact, to be
  answered one email and one phone call at a time. We flip that. We give the County a study microsite
  and survey <b>and</b> put <b>Sarina</b> — an always-on engagement agent — on the project page as the
  front door for resident questions. The public gets instant, accurate, on-message answers 24/7, and
  your staff gets the inbound taken off their plate.
  </div>

  <div class="hook keep">
  <b>The real value: we take the work off your team.</b> &nbsp;Instead of residents contacting your staff
  directly, everything routes through Sarina. We screen the inbound and draft every response; your project
  manager reviews the whole batch in a single pass — approve or edit — rather than firefighting messages
  all week. It is the same workflow we already run today with a transportation engineering partner, turned
  into the County's standing intake channel.
  </div>

  <div class="keep">
  <h2>Traditional approach vs. our approach</h2>
  <table class="cmp">
    <tr><th class="t">Traditional outreach vendor</th><th class="o">Datanautix + Sarina</th></tr>
    <tr><td>Static website and one-time survey</td>
        <td class="o">Study microsite, survey, <i>and</i> an always-on engagement agent</td></tr>
    <tr><td>Resident questions land on County staff</td>
        <td class="o">Inbound routed to Sarina — screened and drafted for you</td></tr>
    <tr><td>Answered one-by-one, over days or weeks</td>
        <td class="o">Drafts ready in a day; PM reviews the full batch at once</td></tr>
    <tr><td>Engagement ends when the meeting ends</td>
        <td class="o">Always-on between meetings — a standing resident channel</td></tr>
    <tr><td>A one-time deliverable</td>
        <td class="o">A live view of what residents care about, feeding the next meeting</td></tr>
  </table>
  </div>

  <div class="cols keep">
    <h2>Proven, not theoretical</h2>
    <p>This is a working model, not a concept. For <b>NOWOCATS</b> we ran the community town-hall meetings
    and deployed Sarina to capture and respond to resident input — the same capture-screen-draft-review
    loop we would stand up for Hall Road. With a tentative next meeting in <b>October 2026</b>, there is
    ample runway to have the microsite, survey, and Sarina live and gathering input well ahead of it, so
    the meeting starts from what residents have already told us.</p>
  </div>

  <div class="keep">
  <h2>Engagement structure</h2>
  <table class="inv">
    <tr><td class="k">Per-study engagement</td>
        <td><span class="fee">$9,250 fixed fee</span> — everything for one project cycle:
        <ul style="margin:4px 0 2px;padding-left:15px">
          <li>Project information website with the <b>Sarina</b> agent and public survey built in</li>
          <li>One community town-hall meeting — live capture and synthesis into themes and Q&amp;A</li>
          <li>Always-on Sarina <b>before and after</b> the meeting — resident questions answered 24/7
              through the project window</li>
          <li>QR-code access to Sarina for the outreach postcards</li>
        </ul>
        Priced below comparable engagements, delivering materially more.</td></tr>
    <tr><td class="k">Always-on Sarina (annual)</td>
        <td>Optional annual subscription (scaled to active projects) — keeps Sarina live <b>year-round,
        across projects</b>, as the County's standing resident-question channel, rather than only a single
        study window. This recurring layer is the piece the traditional model does not offer.</td></tr>
    <tr><td class="k">Postcard print &amp; mail</td>
        <td class="muted">Handled separately at cost through your existing channel, scaled to the mailing
        list — not part of our fee.</td></tr>
    <tr><td class="k">Procurement fit</td>
        <td><b>SBE-certified</b> — aligns cleanly with the County's small-business procurement goals.</td></tr>
  </table>
  </div>

  <p class="foot"><b>Next step.</b> A short working session to scope the Hall Road microsite, survey, and
  Sarina's knowledge base against the project timeline — so everything is live and gathering resident
  input ahead of the October meeting.</p>

  <p class="foot" style="margin-top:6px"><b>Sanjay Patel</b> · Datanautix · sanjay@datanautix.com · 407.619.3411</p>

</div></body></html>`

;(async () => {
  const chrome = brandedPdfChrome({
    brand: 'Orange County Public Engagement · Hall Road — A Better Approach',
    confidentiality: 'Prepared for Orange County · discussion draft',
  })
  const pdf = await htmlToPdfBuffer(html, {
    format: 'letter',
    headerTemplate: chrome.headerTemplate,
    footerTemplate: chrome.footerTemplate,
    margin: chrome.margin,
  })
  const out = join(homedir(), 'Downloads', 'Datanautix-OrangeCounty-Engagement-Brief.pdf')
  writeFileSync(out, pdf)
  console.log('WROTE', out, pdf.length, 'bytes')
})()
