// lib/decks/pitchDeckV2Html.ts
//
// Warm-editorial Sentimetrx investor deck as a single HTML string (16:9 slides),
// rendered to PDF by app/api/pitch-deck-v2. Split out from the route (mirrors
// reportHtml.ts / reportPdf.ts) so the markup is unit-renderable on its own.
//
// Design system = datanautix.com (datanautix-homepage/index.html :root): Fraunces
// serif + DM Sans, warm paper/cream canvas, Ana orange + Sarina teal accents,
// editorial layouts built from typographic lists + hairline rules — deliberately
// NOT the pptxgenjs colored-chip-grid look of /api/pitch-deck.

// ── Datanautix brand tokens ───────────────────────────────────────────────────
const T = {
  paper: '#FFFDF9', cream: '#FAF6F0', ink: '#1A1714', inkSoft: '#2E2A25',
  ana: '#E85A1A', anaLight: '#F57042', anaDark: '#B84010', anaPale: '#FEF0E8',
  sarina: '#2A7A6F', sarinaLight: '#3D9E91', sarinaDark: '#1D5A52', sarinaPale: '#E6F4F2',
  warmLight: '#B8ADA0', warmMid: '#8C7E6E',
}
const TOTAL = 15

const pad = (n: number) => String(n).padStart(2, '0')
const wordmark = `<b><span style="color:${T.sarina}">data</span><span style="color:${T.ana}">nautix</span></b>`

function rail(n: number, kicker: string, dark = false) {
  const muted = dark ? 'rgba(255,253,249,.55)' : T.warmMid
  const line = dark ? 'rgba(255,253,249,.18)' : T.warmLight
  return `<div class="rail" style="border-color:${line}">
    <span class="kicker" style="color:${T.ana}">${kicker}</span>
    <span class="pageno" style="color:${muted}">${pad(n)} <span style="opacity:.5">/ ${TOTAL}</span></span>
  </div>`
}
function foot(dark = false) {
  const muted = dark ? 'rgba(255,253,249,.5)' : T.warmMid
  return `<div class="foot" style="color:${muted}">
    <span>powered by ${wordmark}</span><span>sentimetrx.ai</span>
  </div>`
}
function slide(inner: string, variant: 'paper' | 'cream' | 'ink' = 'paper') {
  const bg = variant === 'ink' ? T.ink : variant === 'cream' ? T.cream : T.paper
  const fg = variant === 'ink' ? T.paper : T.ink
  return `<section class="slide" style="background:${bg};color:${fg}">${inner}</section>`
}

export function buildPitchDeckV2Html(): string {
  const slides: string[] = []

  // 1 — TITLE
  slides.push(slide(`
    ${rail(1, 'Investor Brief')}
    <div class="body title">
      <div class="eyebrow" style="color:${T.sarina}">AI-powered conversational feedback intelligence</div>
      <h1 class="display">Sentimetrx</h1>
      <p class="lede">The first platform that collects, understands, and acts on customer feedback —
        in one place, in any language.</p>
      <div class="rule" style="background:${T.ana}"></div>
      <p class="sub">A 40-year idea, finally made buildable by Claude.</p>
    </div>
    ${foot()}
  `, 'cream'))

  // 2 — 40 YEARS IN THE MAKING
  const milestones = [
    ['1986', 'AI research begins', 'PhD program at Ohio State’s Laboratory for AI Research (LAIR) under Dr. B. Chandrasekaran — a pioneer of medical diagnostic AI.'],
    ['Early career', 'Bell Labs', 'Carried machine-reasoning foundations from the lab into industry.'],
    ['2000', 'Consumer insights', '25 years as a practitioner and consultant mining customer & guest experience.'],
    ['2014', 'Consultancy → tech', 'Converted the firm into a software company on NLU/NLP to mine open-ended feedback at scale.'],
    ['Today', 'Claude is the unlock', 'Frontier reasoning over qualitative language, viable in real time (~$0.002 / interaction). The vision, finally buildable.'],
  ]
  slides.push(slide(`
    ${rail(2, 'Why us')}
    <div class="body">
      <h2 class="head">40 years in the making.</h2>
      <p class="dek">Not an idea du jour — a four-decade arc, and Claude is the unlock.</p>
      <div class="timeline">
        ${milestones.map((m, i) => `
          <div class="tl-item">
            <div class="tl-dot" style="background:${i % 2 ? T.sarina : T.ana}"></div>
            <div class="tl-year">${m[0]}</div>
            <div class="tl-label">${m[1]}</div>
            <div class="tl-desc">${m[2]}</div>
          </div>`).join('')}
      </div>
      <p class="closer">Patient for 40 years, waiting for the technology to catch up to the idea. With Claude, it finally has.</p>
    </div>
    ${foot()}
  `))

  // 3 — THE PROBLEM
  const problems = [
    ['Single-digit response rates', 'Guests, customers, and employees won’t fill out forms anymore — and rates keep falling.'],
    ['“It was fine.” “Good.” “OK.”', 'The majority of open-ended answers are too vague to act on at analysis time.'],
    ['3–5 vendors stitched together', 'Collection, outreach, text analytics, translation, reporting — each a separate tool.'],
    ['English-only misses the signal', 'The richest feedback comes in a respondent’s own language — and goes uncaptured.'],
  ]
  slides.push(slide(`
    ${rail(3, '// the problem')}
    <div class="body">
      <h2 class="head">Response quality is falling. Analysis is getting harder.</h2>
      <div class="list">
        ${problems.map((p, i) => `
          <div class="li">
            <div class="li-num" style="color:${T.ana}">${pad(i + 1)}</div>
            <div><div class="li-t">${p[0]}</div><div class="li-d">${p[1]}</div></div>
          </div>`).join('')}
      </div>
      <p class="aside">Enterprise text analytics costs six figures and needs a data-science team to operate.</p>
    </div>
    ${foot()}
  `))

  // 4 — THE INSIGHT
  slides.push(slide(`
    ${rail(4, '// the insight')}
    <div class="body center">
      <blockquote class="pull">The problem isn’t that people don’t want to give feedback.
        It’s that surveys are a <em>monologue</em> pretending to be a conversation.</blockquote>
      <p class="dek center-dek">When a respondent says “the wait was too long,” a survey moves to the next checkbox.
        A human interviewer asks “tell me more — how long did you wait?”</p>
      <p class="closer" style="color:${T.ana}">That follow-up is where the insight lives. Until now, it required a human.</p>
    </div>
    ${foot()}
  `, 'cream'))

  // 5 — THE SOLUTION
  const sol = [
    ['Conversational collection', 'A branded AI agent greets respondents and asks questions as a chat, not a form.'],
    ['AI clarifiers + deflection', 'Detects vague answers and probes for the why; redirects off-topic asks in brand voice.'],
    ['16 languages, one click', 'Translate the whole study; respondents answer natively, analysis returns in English.'],
    ['Built-in campaigns', 'Email + SMS outreach in the platform. No separate Mailchimp, no data scientist.'],
  ]
  slides.push(slide(`
    ${rail(5, '// the solution')}
    <div class="body">
      <h2 class="head">AI-powered conversations that adapt in real time.</h2>
      <div class="grid2">
        ${sol.map((s, i) => `
          <div class="cell">
            <div class="cell-num" style="color:${i % 2 ? T.sarina : T.ana}">${pad(i + 1)}</div>
            <div class="cell-t">${s[0]}</div><div class="cell-d">${s[1]}</div>
          </div>`).join('')}
      </div>
      <p class="aside">One platform — survey + outreach + analytics + reporting.</p>
    </div>
    ${foot()}
  `))

  // 6 — PRODUCT
  const prod = [
    ['AI Study Wizard', '7 blueprints, 19 industries — a complete study from goals.'],
    ['Conversational Collection', '14 question types, skip logic, AI clarifiers.'],
    ['Built-in Campaigns', 'Templates, merge tags, reminders, tracking.'],
    ['16 Languages', 'One-click translation in and back out.'],
    ['AI Analytics', 'Themes at scale, significance, PPTX/PDF export.'],
  ]
  slides.push(slide(`
    ${rail(6, '// product')}
    <div class="body">
      <h2 class="head">Five capabilities. One platform. No stitching.</h2>
      <div class="cols5">
        ${prod.map((p, i) => `
          <div class="col">
            <div class="col-bar" style="background:${i % 2 ? T.sarina : T.ana}"></div>
            <div class="col-t">${p[0]}</div><div class="col-d">${p[1]}</div>
          </div>`).join('')}
      </div>
    </div>
    ${foot()}
  `))

  // 7 — THE CONVERSATIONAL ADVANTAGE
  slides.push(slide(`
    ${rail(7, '// the advantage')}
    <div class="body">
      <h2 class="head">3–5× more actionable text per respondent.</h2>
      <div class="vs">
        <div class="vs-col" style="border-color:${T.warmLight}">
          <div class="vs-h" style="color:${T.warmMid}">Traditional survey</div>
          <p class="vs-line">“How was your experience?” ★★★★ (4/5)</p>
          <p class="vs-line">“Any comments?” → <em>“It was good.”</em></p>
          <p class="vs-note" style="color:${T.warmMid}">Insight captured: positive sentiment. That’s it.</p>
        </div>
        <div class="vs-col" style="border-color:${T.sarina};background:${T.sarinaPale}">
          <div class="vs-h" style="color:${T.sarinaDark}">Sentimetrx conversation</div>
          <p class="vs-line">Bot: “What made it good?”</p>
          <p class="vs-line">User: “Staff were friendly, but we waited a long time.”</p>
          <p class="vs-line">Bot: “Tell me more about the wait?”</p>
          <p class="vs-line">User: “45 min for a table — with a reservation.”</p>
          <p class="vs-note" style="color:${T.sarinaDark}">Insight: staff driver + 45-min wait + reservation issue.</p>
        </div>
      </div>
      <p class="aside">Same survey length. No interviewer required.</p>
    </div>
    ${foot()}
  `))

  // 8 — COMPETITIVE LANDSCAPE
  const rows = [
    ['Collection', 'Static forms', 'None (needs data)', 'AI conversation'],
    ['AI follow-up', 'No', 'N/A', 'Real-time, contextual'],
    ['Analytics', 'Basic charts', 'Theme extraction', 'Both + significance'],
    ['Campaigns', 'Separate tool', 'N/A', 'Built-in'],
    ['Languages', 'Manual / paid', 'Post-hoc', '16, one-click'],
    ['Annual cost', '$25K–100K', '$15K–80K', 'Fraction of combined'],
  ]
  slides.push(slide(`
    ${rail(8, '// landscape')}
    <div class="body">
      <h2 class="head">No incumbent does all of it in one place.</h2>
      <table class="ctab">
        <thead><tr>
          <th></th><th>Survey tools</th><th>Text analytics</th>
          <th style="color:${T.sarinaDark}">Sentimetrx</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td class="rh">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td>
            <td class="win" style="background:${T.sarinaPale};color:${T.sarinaDark}">${r[3]}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${foot()}
  `))

  // 9 — AI DEPTH
  const ai = [
    ['Study creation', 'Generates complete studies from industry + goals.'],
    ['Real-time clarification', 'Reads each response, generates the contextual follow-up.'],
    ['Smart deflection', 'Detects off-topic questions and redirects warmly.'],
    ['Translation', '16 languages in; responses back to English for analysis.'],
    ['Theme extraction', 'Patterns across thousands of open-ends — no taxonomy seeding.'],
    ['Statistical analysis', 'Significance testing on theme distributions.'],
  ]
  slides.push(slide(`
    ${rail(9, '// ai depth')}
    <div class="body">
      <h2 class="head">The AI is the spine, not a wrapper.</h2>
      <div class="rows">
        ${ai.map(r => `<div class="row">
          <div class="row-k" style="color:${T.sarinaDark}">${r[0]}</div>
          <div class="row-v">${r[1]}</div></div>`).join('')}
      </div>
      <p class="aside">We use Claude (Anthropic) across the stack — deeply integrated, not API calls bolted on.</p>
    </div>
    ${foot()}
  `))

  // 10 — MARKET
  slides.push(slide(`
    ${rail(10, '// market')}
    <div class="body">
      <h2 class="head">Three large, adjacent markets — one wedge.</h2>
      <div class="cols3">
        ${[['Survey software', T.ana], ['Text analytics', T.sarina], ['CX management', T.anaDark]].map(m => `
          <div class="mcol" style="border-top:3px solid ${m[1]}"><div class="mcol-t">${m[0]}</div></div>`).join('')}
      </div>
      <p class="dek">Our wedge: mid-market teams running 3–5 separate tools today — too small for
        Qualtrics / Medallia, too sophisticated for SurveyMonkey alone.</p>
      <p class="aside">Specific TAM / SAM / SOM figures sourced + cited before external use.</p>
    </div>
    ${foot()}
  `, 'cream'))

  // 11 — VALIDATED RESULTS
  const cases = [
    ['UCF Rosen College', '<5%', 'of expert time — near-professor quality (independent academic validation).'],
    ['Harlem Globetrotters', '10×', 'more responses vs. post-event email; 15–20% in-venue response rate.'],
    ['JW Marriott', '10×', 'more responses than post-stay email; actionable feedback within hours.'],
    ['Orlando resort', 'Seconds', 'to root cause vs. weeks of manual analysis — averted a costly renovation.'],
  ]
  slides.push(slide(`
    ${rail(11, '// validated')}
    <div class="body">
      <h2 class="head">Proven across industries.</h2>
      <div class="cases">
        ${cases.map(c => `<div class="case">
          <div class="case-n" style="color:${T.ana}">${c[1]}</div>
          <div><div class="case-name">${c[0]}</div><div class="case-d">${c[2]}</div></div>
        </div>`).join('')}
      </div>
      <blockquote class="quote">“Ana performed almost as well as the team of professors and outperformed the
        graduate student — in less than 5% of the time.” <cite>— Dr. Fevzi Okumus, UCF Rosen College</cite></blockquote>
    </div>
    ${foot()}
  `))

  // 12 — BUSINESS MODEL
  const tiers = [
    ['Starter', '$99', '/mo', '3 active studies · 1K responses · basic analytics'],
    ['Professional', '$299', '/mo', 'Unlimited studies · 10K responses · AI analytics + campaigns'],
    ['Enterprise', 'Custom', '', 'White-label · SSO · dedicated support · unlimited'],
  ]
  slides.push(slide(`
    ${rail(12, '// model')}
    <div class="body">
      <h2 class="head">SaaS subscription, usage-based AI tier.</h2>
      <div class="tiers">
        ${tiers.map((t, i) => `<div class="tier${i === 1 ? ' tier-hi' : ''}" style="${i === 1 ? `border-color:${T.sarina}` : ''}">
          <div class="tier-name">${t[0]}</div>
          <div class="tier-price" style="color:${i === 1 ? T.sarinaDark : T.ink}">${t[1]}<span class="tier-per">${t[2]}</span></div>
          <div class="tier-f">${t[3]}</div>
        </div>`).join('')}
      </div>
      <p class="aside">85%+ gross-margin target — AI inference ≈ $0.002 / interaction.</p>
    </div>
    ${foot()}
  `))

  // 13 — GO-TO-MARKET
  const phases = [
    ['Phase 1 — now', 'Healthcare · nonprofit · hospitality — verticals with reference customers.'],
    ['Phase 2 — 6 months', 'White-label channel partners · integration marketplace · self-serve tier.'],
    ['Phase 3 — 12 months', 'API platform access · real-time triggers · embedded widgets.'],
  ]
  slides.push(slide(`
    ${rail(13, '// go-to-market')}
    <div class="body">
      <h2 class="head">Prove the verticals, scale via partners, become a platform.</h2>
      <div class="cols3">
        ${phases.map((p, i) => `<div class="phase">
          <div class="phase-h" style="color:${i === 2 ? T.sarinaDark : T.ana}">${p[0]}</div>
          <div class="phase-d">${p[1]}</div></div>`).join('')}
      </div>
    </div>
    ${foot()}
  `))

  // 14 — WHY NOW
  const why = [
    ['AI costs crossed the threshold', 'Real-time conversational AI is viable at ~$0.002 / interaction — impossible two years ago.'],
    ['Survey fatigue is peaking', 'Response rates at all-time lows; the market wants a different approach.'],
    ['Multilingual demand', 'Every customer-facing org needs it; $10K+ translation workflows are ripe for disruption.'],
    ['Tool consolidation', 'CFOs cutting point-solutions — “one platform” is the winning pitch.'],
    ['Regulatory pressure', 'Healthcare, financial services, and government mandate structured feedback.'],
  ]
  slides.push(slide(`
    ${rail(14, '// why now')}
    <div class="body">
      <h2 class="head">Five forces, all happening now.</h2>
      <div class="list tight">
        ${why.map((w, i) => `<div class="li">
          <div class="li-num" style="color:${i % 2 ? T.sarina : T.ana}">${pad(i + 1)}</div>
          <div><div class="li-t">${w[0]}</div><div class="li-d">${w[1]}</div></div></div>`).join('')}
      </div>
    </div>
    ${foot()}
  `))

  // 15 — THE ASK (inverse, closing)
  slides.push(slide(`
    ${rail(15, 'The ask', true)}
    <div class="body">
      <h2 class="head" style="color:${T.paper}">Let’s scale a 40-year conviction.</h2>
      <div class="ask">
        <div class="ask-col">
          <div class="ask-h" style="color:${T.anaLight}">Use of funds</div>
          <ul class="ask-ul">
            <li>Scale AI infrastructure</li>
            <li>Vertical sales — healthcare, nonprofit, hospitality</li>
            <li>White-label channel program</li>
            <li>Product — SMS, embedded widgets, API</li>
          </ul>
        </div>
        <div class="ask-col">
          <div class="ask-h" style="color:${T.sarinaLight}">Targets — 18 months</div>
          <ul class="ask-ul">
            <li>$1M ARR</li>
            <li>200+ paying organizations</li>
            <li>50K monthly responses</li>
            <li>3 channel partners</li>
          </ul>
        </div>
      </div>
      <p class="closer" style="color:${T.anaLight}">sentimetrx.ai &nbsp;·&nbsp; info@datanautix.com &nbsp;·&nbsp; calendly.com/sanjay-datanautix</p>
    </div>
    ${foot(true)}
  `, 'ink'))

  return `<!doctype html><html><head><meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    @page { size: 1280px 720px; margin: 0; }
    html, body { font-family:'DM Sans',sans-serif; color:${T.ink}; }
    .slide { position:relative; width:1280px; height:720px; padding:64px 88px; overflow:hidden; page-break-after:always; }
    .slide:last-child { page-break-after:auto; }
    .rail { display:flex; justify-content:space-between; align-items:baseline; padding-bottom:14px; border-bottom:1px solid; }
    .kicker { font-size:13px; font-weight:600; letter-spacing:.18em; text-transform:uppercase; }
    .pageno { font-size:13px; font-weight:500; letter-spacing:.1em; font-variant-numeric:tabular-nums; }
    .body { padding-top:38px; height:568px; }
    .body.center { display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; }
    .foot { position:absolute; left:88px; right:88px; bottom:34px; display:flex; justify-content:space-between; font-size:11px; letter-spacing:.04em; }
    .display { font-family:'Fraunces',serif; font-weight:900; font-size:118px; line-height:.92; letter-spacing:-.01em; }
    .head { font-family:'Fraunces',serif; font-weight:900; font-size:43px; line-height:1.05; letter-spacing:-.01em; max-width:26ch; }
    .eyebrow { font-size:15px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; margin-bottom:22px; }
    .lede { font-size:24px; line-height:1.45; max-width:30ch; margin-top:26px; color:${T.inkSoft}; font-weight:300; }
    .rule { width:64px; height:4px; margin:30px 0 18px; }
    .sub { font-size:18px; color:${T.warmMid}; font-style:italic; }
    .dek { font-size:21px; line-height:1.5; color:${T.inkSoft}; font-weight:300; margin-top:16px; max-width:42ch; }
    .center-dek { max-width:46ch; margin-top:24px; }
    .closer { margin-top:26px; font-size:17px; font-weight:500; font-style:italic; }
    .aside { position:absolute; left:88px; bottom:56px; font-size:14px; color:${T.warmMid}; font-style:italic; }

    .timeline { display:flex; gap:0; margin-top:40px; }
    .tl-item { flex:1; padding-right:22px; position:relative; }
    .tl-dot { width:12px; height:12px; border-radius:50%; margin-bottom:16px; }
    .tl-year { font-family:'Fraunces',serif; font-weight:600; font-size:24px; }
    .tl-label { font-weight:600; font-size:15px; margin:6px 0 8px; }
    .tl-desc { font-size:13px; line-height:1.5; color:${T.warmMid}; }

    .list { margin-top:34px; }
    .list.tight .li { padding:13px 0; }
    .li { display:flex; gap:24px; padding:14px 0; border-top:1px solid ${T.warmLight}; align-items:baseline; }
    .li:last-child { border-bottom:1px solid ${T.warmLight}; }
    .li-num { font-family:'Fraunces',serif; font-weight:600; font-size:22px; min-width:42px; }
    .li-t { font-size:21px; font-weight:600; }
    .li-d { font-size:15px; color:${T.warmMid}; margin-top:3px; line-height:1.45; }

    .pull { font-family:'Fraunces',serif; font-weight:400; font-size:40px; line-height:1.18; max-width:24ch; }
    .pull em { color:${T.ana}; font-style:italic; }
    .quote { font-family:'Fraunces',serif; font-style:italic; font-size:17px; line-height:1.4; margin-top:22px;
      padding-left:22px; border-left:3px solid ${T.ana}; color:${T.inkSoft}; max-width:70ch; }
    .quote cite { display:block; font-style:normal; font-family:'DM Sans'; font-size:13px; color:${T.warmMid}; margin-top:10px; letter-spacing:.04em; }

    .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:30px 56px; margin-top:38px; }
    .cell-num { font-family:'Fraunces',serif; font-weight:600; font-size:26px; }
    .cell-t { font-size:21px; font-weight:600; margin:6px 0 6px; }
    .cell-d { font-size:15px; color:${T.warmMid}; line-height:1.5; max-width:34ch; }

    .cols5 { display:grid; grid-template-columns:repeat(5,1fr); gap:26px; margin-top:40px; }
    .col-bar { width:34px; height:4px; margin-bottom:16px; }
    .col-t { font-size:17px; font-weight:600; line-height:1.2; }
    .col-d { font-size:13px; color:${T.warmMid}; margin-top:8px; line-height:1.5; }
    .cols3 { display:grid; grid-template-columns:repeat(3,1fr); gap:34px; margin-top:36px; }
    .mcol { padding-top:18px; } .mcol-t { font-size:22px; font-weight:600; }
    .phase-h { font-size:15px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; }
    .phase-d { font-size:16px; color:${T.inkSoft}; margin-top:12px; line-height:1.55; }

    .vs { display:grid; grid-template-columns:1fr 1fr; gap:28px; margin-top:32px; }
    .vs-col { border:1px solid; border-radius:14px; padding:24px 26px; }
    .vs-h { font-size:13px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; margin-bottom:14px; }
    .vs-line { font-size:15px; line-height:1.7; color:${T.inkSoft}; } .vs-line em { font-style:italic; }
    .vs-note { font-size:14px; font-weight:600; margin-top:14px; }

    .ctab { width:100%; border-collapse:collapse; margin-top:30px; }
    .ctab th { font-size:13px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; text-align:left;
      padding:12px 16px; color:${T.warmMid}; border-bottom:2px solid ${T.warmLight}; }
    .ctab td { font-size:16px; padding:13px 16px; border-bottom:1px solid ${T.warmLight}; color:${T.inkSoft}; }
    .ctab .rh { font-weight:600; color:${T.ink}; } .ctab .win { font-weight:600; }

    .rows { margin-top:28px; }
    .row { display:grid; grid-template-columns:230px 1fr; gap:20px; padding:13px 0; border-top:1px solid ${T.warmLight}; align-items:baseline; }
    .row-k { font-size:17px; font-weight:600; } .row-v { font-size:16px; color:${T.inkSoft}; }

    .cases { margin-top:18px; }
    .case { display:flex; gap:28px; align-items:baseline; padding:11px 0; border-top:1px solid ${T.warmLight}; }
    .case-n { font-family:'Fraunces',serif; font-weight:900; font-size:30px; min-width:120px; }
    .case-name { font-size:18px; font-weight:600; } .case-d { font-size:14px; color:${T.warmMid}; margin-top:2px; }

    .tiers { display:grid; grid-template-columns:repeat(3,1fr); gap:24px; margin-top:36px; }
    .tier { border:1px solid ${T.warmLight}; border-radius:16px; padding:28px 26px; }
    .tier-hi { border-width:2px; }
    .tier-name { font-size:14px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:${T.warmMid}; }
    .tier-price { font-family:'Fraunces',serif; font-weight:900; font-size:46px; margin:10px 0 14px; }
    .tier-per { font-family:'DM Sans'; font-size:16px; font-weight:400; color:${T.warmMid}; }
    .tier-f { font-size:15px; line-height:1.6; color:${T.inkSoft}; }

    .ask { display:grid; grid-template-columns:1fr 1fr; gap:60px; margin-top:40px; }
    .ask-h { font-size:14px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; margin-bottom:18px; }
    .ask-ul { list-style:none; } .ask-ul li { font-size:19px; line-height:1.9; color:${T.paper}; padding-left:20px; position:relative; }
    .ask-ul li::before { content:'—'; position:absolute; left:0; color:${T.warmMid}; }
  </style></head><body>${slides.join('')}</body></html>`
}
