// lib/decks/pitchDeckV3Html.ts
//
// SHORT version (v3) of the warm-editorial Sentimetrx deck → PDF (16:9) via
// app/api/pitch-deck-v3. The full 17-slide deck lives in pitchDeckV2Html.ts.
//
// Structure (per YC-founder feedback to keep the pitch < 10 slides): a 9-slide
// CORE, then a clearly-labeled APPENDIX for depth. Claude is introduced as an
// INPUT (slide 3) and immediately followed by the data-flywheel MOAT (slide 4)
// so "reliant on Claude" reads as "the model is rented; the data is the moat."
// Labeled for the Menlo × Anthropic Anthology Fund.
//
// Design = datanautix.com tokens: Fraunces serif + DM Sans, warm paper/cream
// canvas, Ana orange + Sarina teal, editorial lists + hairline rules.

const T = {
  paper: '#FFFDF9', cream: '#FAF6F0', ink: '#1A1714', inkSoft: '#2E2A25',
  ana: '#E85A1A', anaLight: '#F57042', anaDark: '#B84010', anaPale: '#FEF0E8',
  sarina: '#2A7A6F', sarinaLight: '#3D9E91', sarinaDark: '#1D5A52', sarinaPale: '#E6F4F2',
  warmLight: '#B8ADA0', warmMid: '#8C7E6E',
}
const CORE = 12   // the pitch is the first 12 slides; the rest is appendix

const pad = (n: number) => String(n).padStart(2, '0')
const wordmark = `<b><span style="color:${T.sarina}">data</span><span style="color:${T.ana}">nautix</span></b>`

// Core rail: "NN / 9". Appendix rail: "Appendix".
function rail(n: number, kicker: string, dark = false) {
  const muted = dark ? 'rgba(255,253,249,.55)' : T.warmMid
  const line = dark ? 'rgba(255,253,249,.18)' : T.warmLight
  return `<div class="rail" style="border-color:${line}">
    <span class="kicker" style="color:${T.ana}">${kicker}</span>
    <span class="pageno" style="color:${muted}">${pad(n)} <span style="opacity:.5">/ ${CORE}</span></span>
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
const numList = (items: string[][], tight = false) => `
  <div class="list${tight ? ' tight' : ''}">
    ${items.map((it, i) => `
      <div class="li">
        <div class="li-num" style="color:${i % 2 ? T.sarina : T.ana}">${pad(i + 1)}</div>
        <div><div class="li-t">${it[0]}</div><div class="li-d">${it[1]}</div></div>
      </div>`).join('')}
  </div>`

export function buildPitchDeckV3Html(): string {
  const slides: string[] = []
  let c = 0

  // ═══ CORE (9) ═══════════════════════════════════════════════════════════════

  // 1 — TITLE
  slides.push(slide(`
    ${rail(++c, 'Menlo × Anthropic · Anthology Fund')}
    <div class="body title">
      <div class="eyebrow" style="color:${T.sarina}">AI-powered conversational feedback intelligence</div>
      <h1 class="display">Sentimetrx</h1>
      <p class="lede">The first platform that collects, understands, and acts on customer feedback —
        in one place, in any language.</p>
      <div class="rule" style="background:${T.ana}"></div>
      <p class="sub">A 40-year idea, finally buildable with Claude.</p>
    </div>
    ${foot()}
  `, 'cream'))

  // 2 — PROBLEM + INSIGHT
  slides.push(slide(`
    ${rail(++c, '// the problem')}
    <div class="body center">
      <blockquote class="pull">The problem isn’t that people don’t want to give feedback.
        It’s that surveys are a <em>monologue</em> pretending to be a conversation.</blockquote>
      <p class="dek center-dek">Response rates are in the single digits, the answers are vague (“it was fine”),
        and the tools that could mine the “why” cost six figures and need a data-science team.</p>
      <p class="closer" style="color:${T.ana}">That follow-up — “tell me more” — is where the insight lives. Until Claude, it required a human.</p>
    </div>
    ${foot()}
  `, 'cream'))

  // 3 — HOW IT WORKS (collect → unify → act)
  slides.push(slide(`
    ${rail(++c, '// how it works')}
    <div class="body">
      <h2 class="head">Collect everything. Unify it. Act.</h2>
      <div class="flow">
        <div class="flow-col">
          <div class="flow-h" style="color:${T.ana}">Collect</div>
          <div class="flow-d"><b>First-party</b>, from your own customers — <b>Sarina</b> surveys + chat agents, <b>PulseIQ</b> live sessions<br><span style="color:${T.warmMid}">+ online reviews · social · files</span></div>
        </div>
        <div class="flow-arrow">→</div>
        <div class="flow-col">
          <div class="flow-h" style="color:${T.sarina}">Unify</div>
          <div class="flow-d">An <b>always-on data lake</b> — every interaction unified into one first-party record.</div>
        </div>
        <div class="flow-arrow">→</div>
        <div class="flow-col">
          <div class="flow-h" style="color:${T.ana}">Act</div>
          <div class="flow-d"><b>Ana</b> — the analytics layer: themes, statistics, and insights that drive action.</div>
        </div>
      </div>
      <p class="aside">One platform with the functionality of SurveyMonkey + Qualtrics + Tableau + Minitab — a one-stop shop, not a stitched stack.</p>
    </div>
    ${foot()}
  `))

  // 4 — THE MOAT: better data, compounding (answers "reliant on Claude")
  const moat = [
    ['Higher-quality, first-party data', 'Conversational collection from your own customers yields 3–5× more actionable signal than forms.'],
    ['An always-on time series', 'Every source flows into the lake continuously — a first-party, longitudinal record no point tool holds.'],
    ['Value compounds super-linearly', 'Each new source and each new period multiplies what the rest is worth — data value grows faster than linearly.'],
    ['Claude is the engine, not the moat', 'Anyone can call a model; only we own the accumulating, integrated, time-series data.'],
  ]
  slides.push(slide(`
    ${rail(++c, '// the moat')}
    <div class="body">
      <h2 class="head">The model is rented. The data is the moat.</h2>
      ${numList(moat, true)}
      <p class="aside">More sources × more time = value that grows faster than linearly. The model is a commodity input; the data is the defensibility.</p>
    </div>
    ${foot()}
  `))

  // 5 — WHY NOW: incumbents falling at an AI inflection
  const inflection = [
    ['Medallia', 'CXM category leader — taken private at $6.4B (2021), then handed to lenders in 2026, ~$5.1B of equity wiped out. The legacy model broke.'],
    ['Luminoso', 'Pure-play text-analytics pioneer — raised ~$30M, still got absorbed (Cemantica). Point tools can’t survive the AI reset alone.'],
    ['Our moment', 'We built CXM at Convergys — now we’re rebuilding it AI-native: Claude-spined, shipping to real customers. Built for exactly this inflection.'],
  ]
  slides.push(slide(`
    ${rail(++c, '// why now')}
    <div class="body">
      <h2 class="head">The incumbents are falling — at an AI inflection.</h2>
      ${numList(inflection, true)}
    </div>
    ${foot()}
  `))

  // 6 — MARKET
  const market = [
    ['$15–16B', 'TAM · Global CXM', 'Customer Experience Management — ~15% CAGR toward $40B+ by the early 2030s.'],
    ['$3–5B', 'SAM · Mid-market', 'VoC, survey, community, town hall, and feedback analytics — growing double digits.'],
    ['$300–700M', 'SOM · Today', 'North-America mid-market target accounts (bottom-up).'],
  ]
  slides.push(slide(`
    ${rail(++c, '// market')}
    <div class="body">
      <h2 class="head">Not the $3B survey box — the $15B+ experience market.</h2>
      <div class="cases">
        ${market.map(m => `<div class="case">
          <div class="case-n" style="color:${T.ana}">${m[0]}</div>
          <div><div class="case-name">${m[1]}</div><div class="case-d">${m[2]}</div></div>
        </div>`).join('')}
      </div>
      <p class="aside">Own the data, layer the services — reputation, social, benchmarking, vertical — growing the SAM into the $15B+→$40B+ CXM budget. Sources: Grand View Research · Precedence Research · Mordor Intelligence.</p>
    </div>
    ${foot()}
  `, 'cream'))

  // 7 — TRACTION
  const cases = [
    ['UCF Rosen College', '<5%', 'of expert time — near-professor quality (independent academic validation).'],
    ['Harlem Globetrotters', '10×', 'more responses vs. post-event email; 15–20% in-venue response rate.'],
    ['Darden · Bloomin’ Brands', 'Millions', 'of guest reviews mined annually across the brands’ locations.'],
    ['Orlando resort', 'Seconds', 'to root cause vs. weeks of manual analysis — averted a costly renovation.'],
  ]
  slides.push(slide(`
    ${rail(++c, '// traction')}
    <div class="body">
      <h2 class="head">Traction is the proof. We are already validated.</h2>
      <div class="cases">
        ${cases.map(cs => `<div class="case">
          <div class="case-n" style="color:${T.ana}">${cs[1]}</div>
          <div><div class="case-name">${cs[0]}</div><div class="case-d">${cs[2]}</div></div>
        </div>`).join('')}
      </div>
      <blockquote class="quote">“Ana performed almost as well as the team of professors and outperformed the
        graduate student — in less than 5% of the time.” <cite>— Dr. Fevzi Okumus, UCF Rosen College</cite></blockquote>
    </div>
    ${foot()}
  `))

  // 8 — WHY US (founder)
  const milestones = [
    ['1986', 'AI research', 'PhD program at OSU’s Lab for AI Research under Dr. B. Chandrasekaran — medical diagnostic AI.'],
    ['1988', 'Bell Labs', 'Software development manager — large-scale systems engineering.'],
    ['1993', 'Convergys', 'Director — built CXM + billing for mass-market mobile.'],
    ['2000', 'Founder · exit', 'Founded iBackOffice — VC-backed (Nomura / BofA), acquired in 3 years.'],
    ['Today', 'Sentimetrx', 'Rebuilding CXM AI-native — Claude is the unlock.'],
  ]
  slides.push(slide(`
    ${rail(++c, '// why us')}
    <div class="body">
      <h2 class="head">40 years in the making.</h2>
      <div class="timeline">
        ${milestones.map((m, i) => `
          <div class="tl-item">
            <div class="tl-dot" style="background:${i % 2 ? T.sarina : T.ana}"></div>
            <div class="tl-year">${m[0]}</div>
            <div class="tl-label">${m[1]}</div>
            <div class="tl-desc">${m[2]}</div>
          </div>`).join('')}
      </div>
      <p class="closer">Yale MBA · M&amp;A + corporate strategy at a large public company — a CXM operator now rebuilding the category, AI-native.</p>
    </div>
    ${foot()}
  `))

  // 9 — CLAUDE IS THE SPINE (in the product AND in how we build it)
  const claude = [
    ['Adaptive collection', 'Real-time clarifiers + off-topic deflection that probe like a human interviewer.'],
    ['Live moderation', 'AI-moderated concurrent group sessions (PulseIQ) with real-time theme detection.'],
    ['Conversational agents', 'Branded chat agents that run intake + interviews with per-turn sentiment + intent.'],
    ['Analysis + synthesis', 'Theme extraction across thousands of open-ends, then executive summaries + topic sentiment.'],
    ['Built with Claude', 'AI-assisted engineering — one operator shipping a production platform on Claude-accelerated development.'],
  ]
  slides.push(slide(`
    ${rail(++c, '// claude, end to end')}
    <div class="body">
      <h2 class="head">Claude is the spine — in the product and in how we build it.</h2>
      <div class="rows">
        ${claude.map(r => `<div class="row">
          <div class="row-k" style="color:${T.sarinaDark}">${r[0]}</div>
          <div class="row-v">${r[1]}</div></div>`).join('')}
      </div>
      <p class="aside">We standardize on the latest Opus + Sonnet — Anthropic-native, top to bottom.</p>
    </div>
    ${foot()}
  `))

  // 10 — WHY WE FIT ANTHOLOGY (criteria checklist)
  const fit = [
    ['Consumer AI solution', 'LLMs as the core component driving every customer interaction — conversational surveys, chat agents, live sessions.'],
    ['Harnesses Anthropic deeply', 'Claude is the spine — Opus + Sonnet across collection, moderation, extraction, synthesis.'],
    ['A category you already back', '“Customer engagement software” is in the first Anthology cohort.'],
    ['Real traction, not a demo', 'Darden · Bloomin’ Brands · Orlando Magic · Globetrotters · MCO.'],
    ['Experienced, technical founder', '40 years in AI — OSU LAIR → Bell Labs → Convergys CXM → a VC-backed exit.'],
    ['Credits compound', 'Anthropic model credits go straight into deepening the AI layer.'],
  ]
  slides.push(slide(`
    ${rail(++c, '// why advance us')}
    <div class="body">
      <h2 class="head">Why we fit Anthology.</h2>
      <div class="list tight">
        ${fit.map(f => `<div class="li">
          <div class="li-num" style="color:${T.sarina}">✓</div>
          <div><div class="li-t">${f[0]}</div><div class="li-d">${f[1]}</div></div></div>`).join('')}
      </div>
    </div>
    ${foot()}
  `))

  // 11 — USE OF FUNDS ($1M)
  const funds = [
    ['$500K', 'Product & scale', 'Scalability, SOC 2 / GDPR, enterprise usability, and a deeper Claude layer.'],
    ['$350K', 'Go-to-market', 'Convert design partners to annual contracts; build vertical sales.'],
    ['$150K', 'Data moat + runway', 'Stand up the benchmarking data network; operating runway.'],
  ]
  slides.push(slide(`
    ${rail(++c, '// use of funds')}
    <div class="body">
      <h2 class="head">$1M — to harden the platform and land enterprise.</h2>
      <div class="cases">
        ${funds.map(f => `<div class="case">
          <div class="case-n" style="color:${T.ana}">${f[0]}</div>
          <div><div class="case-name">${f[1]}</div><div class="case-d">${f[2]}</div></div>
        </div>`).join('')}
      </div>
      <p class="aside">Illustrative allocation. 18-month goal: enterprise-ready, design partners on annual deals, and the data moat compounding.</p>
    </div>
    ${foot()}
  `))

  // 12 — THE CLOSE (ask + contact)
  slides.push(slide(`
    ${rail(++c, 'The ask', true)}
    <div class="body center">
      <div class="eyebrow" style="color:${T.anaLight}">The ask</div>
      <h1 class="display" style="font-size:72px;max-width:18ch">Let’s rebuild CXM — AI-native.</h1>
      <p class="lede" style="color:rgba(255,253,249,.8);max-width:34ch">$1M to harden the platform and land enterprise — with the partner whose model is already our spine.</p>
      <p class="closer" style="color:${T.anaLight}">Sanjay Patel &nbsp;·&nbsp; Datanautix &nbsp;·&nbsp; sanjay@datanautix.com</p>
    </div>
    ${foot(true)}
  `, 'ink'))

  return `<!doctype html><html><head><meta charset="utf-8">
  <title>Sentimetrx — Menlo × Anthropic Anthology Fund</title>
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
    .center-dek { max-width:52ch; margin-top:24px; }
    .closer { margin-top:26px; font-size:17px; font-weight:500; font-style:italic; }
    .aside { position:absolute; left:88px; right:88px; bottom:56px; font-size:14px; color:${T.warmMid}; font-style:italic; max-width:64ch; }

    .timeline { display:flex; gap:0; margin-top:40px; }
    .tl-item { flex:1; padding-right:22px; position:relative; }
    .tl-dot { width:12px; height:12px; border-radius:50%; margin-bottom:16px; }
    .tl-year { font-family:'Fraunces',serif; font-weight:600; font-size:24px; }
    .tl-label { font-weight:600; font-size:15px; margin:6px 0 8px; }
    .tl-desc { font-size:13px; line-height:1.5; color:${T.warmMid}; }

    .list { margin-top:34px; }
    .list.tight .li { padding:9px 0; }
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

    .flow { display:flex; align-items:stretch; gap:18px; margin-top:46px; }
    .flow-col { flex:1; background:${T.cream}; border:1px solid ${T.warmLight}; border-radius:14px; padding:24px 24px; }
    .flow-arrow { align-self:center; font-size:30px; color:${T.warmMid}; font-family:'Fraunces',serif; }
    .flow-h { font-size:14px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; margin-bottom:14px; }
    .flow-d { font-size:16px; line-height:1.65; color:${T.inkSoft}; } .flow-d b { font-weight:600; color:${T.ink}; }
    .cols5 { display:grid; grid-template-columns:repeat(5,1fr); gap:26px; margin-top:40px; }
    .col-bar { width:34px; height:4px; margin-bottom:16px; }
    .col-t { font-size:17px; font-weight:600; line-height:1.2; }
    .col-d { font-size:13px; color:${T.warmMid}; margin-top:8px; line-height:1.5; }

    .vs { display:grid; grid-template-columns:1fr 1fr; gap:28px; margin-top:32px; }
    .vs-col { border:1px solid; border-radius:14px; padding:24px 26px; }
    .vs-h { font-size:13px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; margin-bottom:14px; }
    .vs-line { font-size:15px; line-height:1.7; color:${T.inkSoft}; } .vs-line em { font-style:italic; }
    .vs-note { font-size:14px; font-weight:600; margin-top:14px; }

    .rows { margin-top:28px; }
    .row { display:grid; grid-template-columns:230px 1fr; gap:20px; padding:13px 0; border-top:1px solid ${T.warmLight}; align-items:baseline; }
    .row-k { font-size:17px; font-weight:600; } .row-v { font-size:16px; color:${T.inkSoft}; }

    .cases { margin-top:18px; }
    .case { display:flex; gap:28px; align-items:baseline; padding:11px 0; border-top:1px solid ${T.warmLight}; }
    .case-n { font-family:'Fraunces',serif; font-weight:900; font-size:30px; width:210px; flex-shrink:0; }
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
    .ask-ul { list-style:none; } .ask-ul li { font-size:18px; line-height:1.85; color:${T.paper}; padding-left:20px; position:relative; }
    .ask-ul li::before { content:'—'; position:absolute; left:0; color:${T.warmMid}; }
  </style></head><body>${slides.join('')}</body></html>`
}
