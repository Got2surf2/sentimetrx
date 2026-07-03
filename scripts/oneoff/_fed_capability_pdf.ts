// Run: node --conditions=react-server --import tsx scripts/_fed_capability_pdf.ts
// Throwaway: renders a general FEDERAL CAPABILITY STATEMENT (full Sentimetrx suite)
// to ~/Downloads — the leave-behind for federal primes / contracting officers.
// Outbound BD doc — not committed, not a deck route.
// Bracketed [ ... ] = owner-to-complete facts; NAICS/PSC are recommendations to confirm.
// Nothing about the company (UEI/CAGE/status/past performance) is fabricated.
import { htmlToPdfBuffer, brandedPdfChrome } from '../../lib/htmlToPdf'
import { writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
         color: #1e2a33; font-size: 10.3px; line-height: 1.4; margin: 0; }
  .wrap { max-width: 760px; margin: 0 auto; }
  .brandline { font-weight: 700; font-size: 13px; margin: 0; letter-spacing: .01em; }
  .brandline .d { color: #0F7173; } .brandline .n { color: #E85A1A; }
  h1 { font-size: 17px; color: #0D2B45; margin: 2px 0 2px; }
  .meta { color: #5b6b76; font-size: 10px; margin: 0 0 10px; }
  h2 { font-size: 10.5px; color: #0F7173; text-transform: uppercase; letter-spacing: .04em;
       margin: 12px 0 5px; border-bottom: 1.5px solid #D4DDE2; padding-bottom: 2px; }
  .keep { break-inside: avoid; }
  p { margin: 4px 0; }
  ul { margin: 3px 0; padding-left: 15px; }
  li { margin: 2.5px 0; }
  b { color: #0D2B45; }
  .cols { display: flex; gap: 22px; }
  .col { flex: 1; }
  .lead { background: #F4F7F8; border-left: 3px solid #0F7173; padding: 8px 12px; margin: 4px 0 2px; }
  .comp b { color: #0D2B45; }
  .box { border: 1px solid #D4DDE2; border-radius: 5px; padding: 8px 12px; margin: 4px 0; }
  .box table { width: 100%; border-collapse: collapse; }
  .box td { padding: 2px 6px 2px 0; vertical-align: top; font-size: 9.8px; }
  .box td.k { color: #0F7173; font-weight: 700; white-space: nowrap; width: 92px; }
  .fill { color: #b23c00; font-weight: 600; }
  .codes { font-size: 9.6px; }
  .codes .num { color: #0D2B45; font-weight: 700; }
  .kw { font-size: 9.4px; color: #40525c; background: #F4F7F8; border-radius: 5px; padding: 7px 11px; margin-top: 4px; }
  .muted { color: #5b6b76; }
</style></head><body><div class="wrap">

  <p class="brandline"><span class="d">data</span><span class="n">nautix</span></p>
  <h1>Federal Capability Statement</h1>
  <p class="meta">Applied AI, text analytics &amp; stakeholder-insight solutions ·
  Platform: <b>Sentimetrx</b></p>

  <div class="lead keep">
  Datanautix turns unstructured human input — comments, documents, conversations, survey and meeting
  responses — into decision-ready insight. Our <b>Sentimetrx</b> platform combines large-language-model
  (Anthropic Claude) classification and extraction, conversational AI agents, and self-service analytics
  so agencies can capture, understand, and report on what stakeholders and citizens are actually saying —
  at scale, with human-in-the-loop quality control.
  </div>

  <div class="cols">
    <div class="col keep comp">
      <h2>Core Competencies</h2>
      <ul>
        <li><b>AI text &amp; sentiment analytics</b> — theme, sentiment, and aspect (ABSA) analysis
            over large comment / review / document corpora; scales to hundreds of thousands of records.</li>
        <li><b>Document classification &amp; data extraction</b> — auto-typing and field-level extraction
            from unstructured material, with confidence scoring to gate automated vs. human review.</li>
        <li><b>Entity extraction &amp; resolution</b> — normalize name / identifier variants to canonical
            records.</li>
        <li><b>Conversational AI agents</b> — guarded intake, Q&amp;A, and Tier-1 helpdesk deflection with
            full transcript capture.</li>
        <li><b>Surveys &amp; voice-of-stakeholder research</b> — adaptive surveys, kiosk / unattended mode,
            and live digital pulse (PulseIQ).</li>
        <li><b>Meeting &amp; town-hall intelligence</b> — transcription of recorded sessions into structured
            Q&amp;A, themes, and neutral synthesis.</li>
        <li><b>Analytics dashboards &amp; automated reporting</b> — self-service metrics plus generated
            briefings, reports, and presentation decks.</li>
      </ul>
    </div>
    <div class="col keep">
      <h2>Differentiators</h2>
      <ul>
        <li><b>Conversational, not just forms</b> — captures the <i>why</i> behind a response, not only
            the rating.</li>
        <li><b>Built on frontier LLMs</b> — current-generation models with prompt guardrails and
            auditable outputs.</li>
        <li><b>End-to-end</b> — one platform from capture &rarr; classify / extract &rarr; analyze &rarr;
            report.</li>
        <li><b>Quality by design</b> — confidence scoring, human-in-the-loop review, and drift/anomaly
            monitoring.</li>
        <li><b>Secure multi-tenant architecture</b> — row-level tenant isolation, least-privilege access,
            audit logging.</li>
      </ul>
      <h2>Past Performance</h2>
      <p class="muted">Representative engagements — <span class="fill">[complete with real
      agency/organization, scope, and outcome; do not fabricate]</span>.</p>
    </div>
  </div>

  <div class="keep">
  <h2>Company Data</h2>
  <div class="box">
    <table>
      <tr><td class="k">Legal name</td><td class="fill">[complete]</td>
          <td class="k">UEI</td><td class="fill">[complete]</td>
          <td class="k">CAGE</td><td class="fill">[complete]</td></tr>
      <tr><td class="k">Business size</td><td class="fill">[complete for primary NAICS]</td>
          <td class="k">Set-aside(s)</td><td class="fill">[SB / 8(a) / SDVOSB / VOSB / WOSB / HUBZone — actual only]</td></tr>
      <tr><td class="k">Point of contact</td><td colspan="3">Sanjay Patel · sanjay@datanautix.com · 407.619.3411</td></tr>
      <tr><td class="k">Contract vehicles</td><td colspan="3" class="fill">[GSA MAS / GWAC / IDIQ / BPA — list, or "open to teaming"]</td></tr>
    </table>
  </div>
  </div>

  <div class="cols keep">
    <div class="col">
      <h2>NAICS Codes <span class="muted" style="font-weight:400;text-transform:none;font-size:9px">(recommended — set your registered primary)</span></h2>
      <div class="codes">
        <p><span class="num">518210</span> — Computing Infrastructure, Data Processing, Hosting &amp; Related Services <i>(primary)</i><br>
        <span class="num">541910</span> — Marketing Research &amp; Public Opinion Polling<br>
        <span class="num">541511</span> — Custom Computer Programming Services<br>
        <span class="num">541512</span> — Computer Systems Design Services<br>
        <span class="num">541613</span> — Marketing Consulting Services<br>
        <span class="num">541618</span> — Other Management Consulting Services<br>
        <span class="num">541690</span> — Other Scientific &amp; Technical Consulting Services<br>
        <span class="num">541990</span> — All Other Professional, Scientific &amp; Technical Services</p>
      </div>
    </div>
    <div class="col">
      <h2>PSC Codes <span class="muted" style="font-weight:400;text-transform:none;font-size:9px">(candidates — confirm current titles)</span></h2>
      <div class="codes">
        <p><span class="num">DA01</span> — IT &amp; Telecom: Business Application / Software<br>
        <span class="num">D399</span> — IT &amp; Telecom: Other IT &amp; Telecommunications<br>
        <span class="num">B505</span> — Special Studies / Analysis: Data Collection<br>
        <span class="num">R408</span> — Support (Professional): Program Management / Support<br>
        <span class="num">R499</span> — Support (Professional): Other<br>
        <span class="num">R707</span> — Support (Management): Contract / Program Review</p>
      </div>
    </div>
  </div>

  <div class="keep">
  <h2>Keywords <span class="muted" style="font-weight:400;text-transform:none;font-size:9px">(for SAM.gov discovery &amp; RFI/RFP alignment)</span></h2>
  <div class="kw">
  artificial intelligence (AI) · machine learning (ML) · natural language processing (NLP) ·
  generative AI · large language models (LLM) · text analytics · sentiment analysis ·
  thematic / qualitative analysis · document classification · intelligent data extraction ·
  entity resolution · unstructured data · conversational AI · virtual assistant / chatbot ·
  survey research · public opinion polling · voice of the customer / citizen ·
  stakeholder &amp; community engagement · meeting transcription · data visualization ·
  self-service dashboards · program analytics &amp; reporting · human-centered insights
  </div>
  </div>

</div></body></html>`

;(async () => {
  const chrome = brandedPdfChrome({
    brand: 'Datanautix — Federal Capability Statement',
    confidentiality: 'Capability overview · not a proposal',
  })
  const pdf = await htmlToPdfBuffer(html, {
    format: 'letter',
    headerTemplate: chrome.headerTemplate,
    footerTemplate: chrome.footerTemplate,
    margin: chrome.margin,
  })
  const out = join(homedir(), 'Downloads', 'Datanautix-Federal-Capability-Statement.pdf')
  writeFileSync(out, pdf)
  console.log('WROTE', out, pdf.length, 'bytes')
})()
