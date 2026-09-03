'use client'

// lib/storyLaunch.ts
// Shared client-side Data Story launcher (extracted from DatasetHeader
// 2026-09-04 when collections gained the story + the card menu needed the
// same flow — second occurrence rule).
//
// Contract quirks this encodes (all owner-verified 2026-09-02/03):
//   - the tab MUST open synchronously in the click (window.open after the
//     await has lost the user activation and gets popup-blocked);
//   - the tab is never left blank while the ~30-90s build runs — it paints
//     the Datanautix building screen with rotating fun facts (same pool and
//     rhythm as Ask Ana's wait-state: first fact after 3s, then every 8s,
//     shuffled no-repeat; DOCTYPE required or quirks mode breaks centering);
//   - the story request carries the verbatim selection active in TextMine
//     (textMine_<id> session state) so the story is about THAT question;
//   - format 'pdf' points the tab at the short link's /pdf sibling — the
//     signed-token fallback link has no /pdf, so it falls back to the HTML
//     viewer (which carries its own Download PDF button).

import { FUN_FACTS } from './funFacts'

// Shuffled no-repeat sample of the shared fact pool (module scope — the
// react-hooks purity pass must see Math.random never runs during render).
function sampleFunFacts(n: number): string[] {
  const out: string[] = []
  const pool = FUN_FACTS.slice()
  for (let i = 0; i < n && pool.length; i++) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
  }
  return out
}

export async function launchDataStory(opts: {
  datasetId: string
  format?: 'html' | 'pdf'
  onBusy?: (busy: boolean) => void
}): Promise<void> {
  const { datasetId, format = 'html', onBusy } = opts
  const storyTab = window.open('about:blank', '_blank')
  if (storyTab) {
    try {
      const facts = sampleFunFacts(40)
      storyTab.document.write(
        '<!DOCTYPE html><meta charset="utf-8"><title>Building your Data Story…</title>' +
        '<body style="margin:0;font-family:system-ui;background:#FCFCFB;color:#1A2421">' +
        '<div style="position:fixed;top:0;left:0;right:0;text-align:center;padding:34px 24px 0">' +
        '<div style="font-weight:800;font-style:italic;font-size:15px">' +
        '<span style="color:#0E7476">data</span><span style="color:#E85A1A">nautix</span></div>' +
        '<p style="font-size:15px;margin:12px 0 4px;font-weight:600">Building your Data Story…</p>' +
        '<p style="font-size:12.5px;color:#5C6B64;margin:0">Recounting themes and writing the narrative — usually under a minute. This page will load the story automatically.</p>' +
        '</div>' +
        '<div style="position:fixed;inset:0;display:grid;place-items:center;padding:0 24px">' +
        '<div id="fwrap" style="text-align:center;max-width:820px;transition:opacity .5s;opacity:0">' +
        '<p style="font-size:12px;letter-spacing:.14em;color:#8FA3AE;margin:0 0 18px;text-transform:uppercase">Did you know?</p>' +
        '<p id="fct" style="font-size:clamp(22px,3.2vw,30px);line-height:1.4;font-weight:600;color:#1A2421;margin:0;transition:opacity .5s;opacity:1"></p>' +
        '</div></div>' +
        '<script>(function(){var f=' + JSON.stringify(facts) + ',i=0,el=document.getElementById("fct"),w=document.getElementById("fwrap");' +
        'setTimeout(function(){el.textContent=f[0];w.style.opacity=1;' +
        'setInterval(function(){el.style.opacity=0;setTimeout(function(){i=(i+1)%f.length;el.textContent=f[i];el.style.opacity=1},500)},8000)},3000)})()<' + '/script>' +
        '</body>')
      storyTab.document.close()
    } catch { /* cross-origin guard — cosmetic only */ }
  }
  onBusy?.(true)
  try {
    // Focus the story on the verbatim currently selected in TextMine — the
    // route falls back to the stored top-level model's binding without it.
    let storyFields: string[] = []
    try {
      const tmSaved = JSON.parse(sessionStorage.getItem('textMine_' + datasetId) || 'null')
      if (Array.isArray(tmSaved?.activeFields) && tmSaved.activeFields.length) storyFields = tmSaved.activeFields.map(String)
      else if (tmSaved?.activeField) storyFields = [String(tmSaved.activeField)]
    } catch { /* no saved selection — route falls back */ }
    const storyRes = await fetch('/api/datasets/' + datasetId + '/story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(storyFields.length ? { fields: storyFields } : {}),
    })
    const storyData = await storyRes.json()
    if (!storyRes.ok || !storyData.url) throw new Error(storyData.error || 'Could not build the story')
    const path = format === 'pdf' && typeof storyData.url === 'string' && storyData.url.startsWith('/story/')
      ? storyData.url + '/pdf'
      : storyData.url
    const storyUrl = new URL(path, window.location.origin).toString()
    // The share link (never the /pdf variant) goes on the clipboard.
    try { await navigator.clipboard.writeText(new URL(storyData.url, window.location.origin).toString()) } catch { /* clipboard optional */ }
    if (storyTab) storyTab.location.href = storyUrl
    else window.open(storyUrl, '_blank', 'noopener')
  } catch (storyErr) {
    if (storyTab) storyTab.close()
    window.alert(storyErr instanceof Error ? storyErr.message : 'Could not build the story')
  } finally {
    onBusy?.(false)
  }
}
