// Run: node --conditions=react-server --import tsx scripts/_va_mail_capability_pdf.ts
// Throwaway: renders a teaming/subcontractor capability blurb (AI/NLP + analytics
// slice) for VA VBA Mail Management Services RFI 36C10D26Q0139 to ~/Downloads.
// Outbound business doc for a prime — not committed, not a deck route.
// Bracketed [ ... ] = owner-to-complete facts; nothing fabricated.
import { htmlToPdfBuffer, brandedPdfChrome } from '../../lib/htmlToPdf'
import { writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
         color: #1e2a33; font-size: 11.5px; line-height: 1.45; margin: 0; }
  .wrap { max-width: 760px; margin: 0 auto; }
  .brandline { font-weight: 700; font-size: 12px; margin: 0 0 10px; letter-spacing: .01em; }
  .brandline .d { color: #0F7173; } .brandline .n { color: #E85A1A; }
  h1 { font-size: 20px; color: #0D2B45; margin: 0 0 3px; }
  .meta { color: #5b6b76; font-size: 11px; margin: 0 0 14px; }
  h2 { font-size: 12px; color: #0F7173; text-transform: uppercase; letter-spacing: .04em;
       margin: 15px 0 6px; border-bottom: 1.5px solid #D4DDE2; padding-bottom: 3px; }
  .keep { break-inside: avoid; }
  p { margin: 5px 0; }
  ul { margin: 4px 0; padding-left: 18px; }
  li { margin: 3px 0; }
  b { color: #0D2B45; }
  .lead { background: #F4F7F8; border-left: 3px solid #0F7173; padding: 9px 13px; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 10.8px; }
  th { text-align: left; background: #0D2B45; color: #fff; padding: 6px 8px; font-weight: 600; }
  td { border-bottom: 1px solid #E1E8EC; padding: 6px 8px; vertical-align: top; }
  td.pws { white-space: nowrap; color: #0F7173; font-weight: 600; width: 160px; }
  .honest { background: #FFF7F2; border-left: 3px solid #E85A1A; padding: 9px 13px; margin: 6px 0; }
  .fill { color: #b23c00; font-weight: 600; }
  .muted { color: #5b6b76; }
  .foot { margin-top: 16px; font-size: 10.5px; color: #5b6b76; }
</style></head><body><div class="wrap">

  <p class="brandline"><span class="d">data</span><span class="n">nautix</span></p>
  <h1>Capability Overview — AI / NLP &amp; Analytics Support</h1>
  <p class="meta">VA / VBA Mail Management Services · RFI <b>36C10D26Q0139</b> · NAICS 518210 ·
  Submitted as a statement of <b>teaming / subcontractor interest</b> in the AI, NLP, and reporting scope.</p>

  <div class="lead keep">
  Datanautix is a data-insight and applied-AI practice. Our <b>Sentimetrx</b> platform performs
  large-scale natural-language classification, structured extraction from unstructured documents,
  entity resolution, and self-service analytics. We are responding to signal availability as a
  <b>specialized subcontractor to a prime</b> delivering the end-to-end mail-conversion operation —
  contributing the machine-learning / NLP automation and reporting layers (directly responsive to
  RFI Question 5), not the physical mail, scanning, storage, or hosting backbone.
  </div>

  <div class="keep">
  <h2>Where we fit the draft PWS</h2>
  <table>
    <tr><th>PWS area</th><th>What we contribute</th></tr>
    <tr><td class="pws">RFI Q5 — ML / NLP /<br>bots / AI automation</td>
        <td>Our core. LLM-based (Anthropic Claude) document understanding with human-in-the-loop
        review — the automation lever the Government is explicitly asking industry to describe.</td></tr>
    <tr><td class="pws">§5.6 Indexing<br>§5.7 Data Extraction</td>
        <td>Automated <b>document-type classification and routing</b>, plus <b>field-level extraction</b>
        from unstructured mail, each returned with a <b>confidence score</b> so low-confidence items
        route to human validation rather than flowing through unchecked.</td></tr>
    <tr><td class="pws">§5.25 Self-Service<br>Report Generation<br>§5.31 Program Health<br>Dashboard</td>
        <td>Self-service dashboards and automated report/briefing generation over throughput,
        quality, and SLA metrics — the reporting surfaces these sections describe.</td></tr>
    <tr><td class="pws">§6.4 / §6.5 QA &amp;<br>Monitoring</td>
        <td>AI-assisted QA sampling and <b>anomaly / drift detection</b> on extraction confidence to
        support QASP performance objectives and traceability.</td></tr>
    <tr><td class="pws">§5.29 Helpdesk /<br>outreach support</td>
        <td>Conversational AI agents for guided intake and Tier-1 deflection, with full transcript
        capture for review.</td></tr>
  </table>
  </div>

  <div class="keep">
  <h2>Relevant platform capabilities (in production today)</h2>
  <ul>
    <li><b>Document / text classification &amp; taxonomy</b> — assign document types and structured
        categories across large corpora; supports multi-level classification rules.</li>
    <li><b>Structured extraction from unstructured text</b> — pull defined fields and forms; every
        value carries a confidence score to gate automated vs. human-reviewed handling.</li>
    <li><b>Entity extraction &amp; normalization</b> — resolve name / identifier variants to a canonical
        record (relevant to matching source material to the right claimant / file).</li>
    <li><b>Conversational AI agents</b> — guided, guardrailed intake and support conversations.</li>
    <li><b>Analytics dashboards &amp; automated reporting</b> — self-service metric exploration plus
        scheduled report and briefing generation.</li>
    <li><b>Modern secure cloud stack</b> — Postgres with row-level tenant isolation, least-privilege
        access, and audit logging as standard engineering practice.</li>
  </ul>
  </div>

  <div class="honest keep">
  <b>What we are not proposing to be.</b> We are not offering to run physical mail receipt, PO boxes,
  scanning hardware, NARA-compliant storage, or the ATO'd hosting boundary at billion-image scale —
  that is the prime's domain. Our components would operate <b>inside the prime's authorized boundary</b>,
  integrating over API / SFTP. We are not currently FedRAMP-authorized and would deploy under the
  prime's ATO rather than assert an independent one. This scoping is deliberate: we add a differentiated
  automation and reporting layer without overstating operational reach.
  </div>

  <div class="keep">
  <h2>PII / PHI handling posture (re: RFI Q6)</h2>
  <p>Veteran source material is sensitive PII/PHI. Our engineering baseline uses tenant-isolated data
  access, least-privilege service credentials, and audit logging. Under a prime, all data handling would
  conform to the prime's ATO, NIST SP 800-53 controls, and VA Handbook 6500-series requirements, with
  our components confined to the authorized environment.</p>
  </div>

  <div class="keep">
  <h2>Company information</h2>
  <p class="muted">To be completed by Datanautix before submission — no values are asserted here that
  have not been verified:</p>
  <ul>
    <li>Legal name / DBA · <span class="fill">[complete]</span></li>
    <li>UEI · <span class="fill">[complete]</span> &nbsp;&nbsp; CAGE · <span class="fill">[complete]</span></li>
    <li>Business size &amp; socio-economic status for NAICS 518210 · <span class="fill">[SB / 8(a) / SDVOSB / VOSB / WOSB / HUBZone / Large — select actual]</span></li>
    <li>Contract vehicles held (GSA / GWAC / IDC / BPA), if any · <span class="fill">[list or "none"]</span></li>
    <li>Point of contact · Sanjay Patel · sanjay@datanautix.com · 407.619.3411</li>
    <li>Relevant past performance (agency/company, contract #, PoP, value) · <span class="fill">[complete — do not fabricate]</span></li>
  </ul>
  </div>

  <p class="foot"><b>Next step.</b> We welcome a teaming conversation with primes pursuing this requirement.
  We can provide a live demonstration of the classification, extraction, and reporting capabilities above
  against representative (non-VA) document samples on request.</p>

</div></body></html>`

;(async () => {
  const chrome = brandedPdfChrome({
    brand: 'VA Mail Management · RFI 36C10D26Q0139 — Capability Overview',
    confidentiality: 'Prepared for teaming discussions · not a proposal',
  })
  const pdf = await htmlToPdfBuffer(html, {
    format: 'letter',
    headerTemplate: chrome.headerTemplate,
    footerTemplate: chrome.footerTemplate,
    margin: chrome.margin,
  })
  const out = join(homedir(), 'Downloads', 'Datanautix-VA-Mail-AI-NLP-Capability.pdf')
  writeFileSync(out, pdf)
  console.log('WROTE', out, pdf.length, 'bytes')
})()
