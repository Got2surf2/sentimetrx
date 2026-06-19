// lib/decks/pitchDeckV2Html.ts
//
// FULL (17-slide) warm-editorial Sentimetrx deck → PDF (16:9) via
// app/api/pitch-deck-v2. The SHORT (9-slide core + appendix) version lives in
// pitchDeckV3Html.ts (app/api/pitch-deck-v3). Both are kept so neither is lost.
//
// Labeled for the Menlo × Anthropic Anthology Fund. Excitement-forward order:
// 40-year hook → why-now (incumbents falling) → market → positioning → problem
// → insight → Claude-spine → advantage → platform → restaurants (vertical on a
// horizontal platform) → traction → adoption → model → funding → fit → ask.
//
// Design = datanautix.com tokens: Fraunces serif + DM Sans, warm paper/cream
// canvas, Ana orange + Sarina teal, editorial lists + hairline rules.

const T = {
  paper: '#FFFDF9', cream: '#FAF6F0', ink: '#1A1714', inkSoft: '#2E2A25',
  ana: '#E85A1A', anaLight: '#F57042', anaDark: '#B84010', anaPale: '#FEF0E8',
  sarina: '#2A7A6F', sarinaLight: '#3D9E91', sarinaDark: '#1D5A52', sarinaPale: '#E6F4F2',
  warmLight: '#B8ADA0', warmMid: '#8C7E6E',
}
const TOTAL = 17

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
const numList = (items: string[][], tight = false) => `
  <div class="list${tight ? ' tight' : ''}">
    ${items.map((it, i) => `
      <div class="li">
        <div class="li-num" style="color:${i % 2 ? T.sarina : T.ana}">${pad(i + 1)}</div>
        <div><div class="li-t">${it[0]}</div><div class="li-d">${it[1]}</div></div>
      </div>`).join('')}
  </div>`
const grid2 = (items: string[][]) => `
  <div class="grid2">
    ${items.map((e, i) => `
      <div class="cell">
        <div class="cell-num" style="color:${i % 2 ? T.sarina : T.ana}">${pad(i + 1)}</div>
        <div class="cell-t">${e[0]}</div><div class="cell-d">${e[1]}</div>
      </div>`).join('')}
  </div>`

export function buildPitchDeckV2Html(): string {
  const slides: string[] = []
  let c = 0

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

  // 2 — 40 YEARS (founder)
  const milestones = [
    ['1986', 'AI research', 'PhD program at OSU’s Lab for AI Research under Dr. B. Chandrasekaran — medical diagnostic AI.'],
    ['1988', 'Bell Labs', 'Software development manager — large-scale systems engineering.'],
    ['1993', 'Convergys', 'Director — built CXM + billing for mass-market mobile.'],
    ['2000', 'Founder · exit', 'Founded iBackOffice — VC-backed (Nomura / BofA), acquired in 3 years.'],
    ['Today', 'Sentimetrx', 'Rebuilding CXM AI-native — Claude is the unlock.'],
  ]
  slides.push(slide(`
    ${rail(++c, 'Why us')}
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

  // 3 — WHY NOW
  const inflection = [
    ['Medallia', 'CXM category leader — taken private at $6.4B (2021), then handed to lenders in 2026, ~$5.1B of equity wiped out. The legacy model broke.'],
    ['Luminoso', 'Pure-play text-analytics pioneer — raised ~$30M, still got absorbed (Cemantica). Point tools can’t survive the AI reset alone.'],
    ['The reset', 'Labor-heavy services + bolted-on AI can’t match an AI-native rebuild. Frontier reasoning — the Anthropic inflection — changes what’s possible.'],
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

  // 4 — MARKET
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

  // 5 — POSITIONING
  const edge = [
    ['20 years across platforms', 'Building data + insights products since long before this was a category — 12 of those years in NLP / NLU.'],
    ['Claude is the spine', 'The reasoning core of the stack, deeply integrated — not a thin wrapper on a model.'],
    ['Real, known problems', 'Surveys nobody answers, open-ends nobody can read, meetings nobody can mine — well-understood pain.'],
    ['Already validated', 'Darden · Bloomin’ Brands · Orlando Magic · Harlem Globetrotters · Marriott · Orlando International Airport.'],
  ]
  slides.push(slide(`
    ${rail(++c, '// why this is durable')}
    <div class="body">
      <h2 class="head">Anyone can build a tool now. We solve real problems.</h2>
      <p class="dek">The barrier to a demo collapsed — so experience, relationships, and real customers are the moat now.</p>
      ${grid2(edge)}
      <p class="aside">We started with the problems — 20 years ago, not with the model.</p>
    </div>
    ${foot()}
  `))

  // 6 — PROBLEM
  const problems = [
    ['Single-digit response rates', 'Guests, customers, and employees won’t fill out forms anymore — and rates keep falling.'],
    ['“It was fine.” “Good.” “OK.”', 'The majority of open-ended answers are too vague to act on at analysis time.'],
    ['3–5 vendors stitched together', 'Collection, outreach, text analytics, translation, reporting — each a separate tool.'],
    ['English-only misses the signal', 'The richest feedback comes in a respondent’s own language — and goes uncaptured.'],
  ]
  slides.push(slide(`
    ${rail(++c, '// the problem')}
    <div class="body">
      <h2 class="head">Real, well-understood pain points.</h2>
      ${numList(problems)}
      <p class="aside">Enterprise text analytics costs six figures and needs a data-science team to operate.</p>
    </div>
    ${foot()}
  `))

  // 7 — INSIGHT
  slides.push(slide(`
    ${rail(++c, '// the insight')}
    <div class="body center">
      <blockquote class="pull">The problem isn’t that people don’t want to give feedback.
        It’s that surveys are a <em>monologue</em> pretending to be a conversation.</blockquote>
      <p class="dek center-dek">When a respondent says “the wait was too long,” a survey moves to the next checkbox.
        A human interviewer asks “tell me more — how long did you wait?”</p>
      <p class="closer" style="color:${T.ana}">That follow-up is where the insight lives. Until Claude, it required a human.</p>
    </div>
    ${foot()}
  `, 'cream'))

  // 8 — CLAUDE IS THE SPINE
  const claude = [
    ['Adaptive collection', 'Real-time clarifiers + off-topic deflection that probe like a human interviewer.'],
    ['Live moderation', 'AI-moderated concurrent group sessions (PulseIQ) with real-time theme detection.'],
    ['Meeting intelligence', 'Town Hall: Opus extracts Q&A from transcripts, Sonnet curates — a two-pass pipeline.'],
    ['Analysis at scale', 'Theme extraction across thousands of open-ends — no taxonomy seeding.'],
    ['Synthesis', 'Executive summaries, topic sentiment, and reports — generated, then human-reviewed.'],
  ]
  slides.push(slide(`
    ${rail(++c, '// claude, end to end')}
    <div class="body">
      <h2 class="head">Claude is the spine of the product — not a feature.</h2>
      <div class="rows">
        ${claude.map(r => `<div class="row">
          <div class="row-k" style="color:${T.sarinaDark}">${r[0]}</div>
          <div class="row-v">${r[1]}</div></div>`).join('')}
      </div>
      <p class="aside">We standardize on the latest Opus + Sonnet. Claude moved this from “someday” to “in production.”</p>
    </div>
    ${foot()}
  `))

  // 9 — CONVERSATIONAL ADVANTAGE
  slides.push(slide(`
    ${rail(++c, '// the advantage')}
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

  // 10 — ONE PLATFORM
  const surfaces = [
    ['Conversational surveys', 'Chat-style, AI clarifiers, 16 languages.'],
    ['PulseIQ', 'AI-moderated live group sessions.'],
    ['Town Hall', 'Recorded meetings → structured Q&A.'],
    ['Text analytics', 'Reviews, social, CSV — themes + stats.'],
    ['Outreach', 'Email + SMS campaigns, built in.'],
  ]
  slides.push(slide(`
    ${rail(++c, '// the platform')}
    <div class="body">
      <h2 class="head">One platform — collect, understand, act.</h2>
      <div class="cols5">
        ${surfaces.map((p, i) => `
          <div class="col">
            <div class="col-bar" style="background:${i % 2 ? T.sarina : T.ana}"></div>
            <div class="col-t">${p[0]}</div><div class="col-d">${p[1]}</div>
          </div>`).join('')}
      </div>
      <p class="aside">Five AI-native surfaces, one login — no stitching, no data-science team.</p>
    </div>
    ${foot()}
  `))

  // 11 — RESTAURANTS (vertical on a horizontal platform)
  const restaurant = [
    ['Mine online reviews', 'Pull guest reviews across the web and mine them for what actually matters.'],
    ['Post-dining feedback loops', 'Conversational surveys that probe each guest for the why, not a star rating.'],
    ['Menu “sherpas”', 'Diners explore the menu in natural language — real review quotes per dish + smart pairing upsells.'],
    ['Always-on 360° guest view', 'One continuous listening layer across reviews, surveys, and on-site interactions.'],
    ['Stars & dogs across locations', 'Rank multi-unit locations so groups learn from the best and fix the worst.'],
  ]
  slides.push(slide(`
    ${rail(++c, '// example: restaurants')}
    <div class="body">
      <h2 class="head">A vertical solution, built on a horizontal platform.</h2>
      ${numList(restaurant, true)}
      <p class="aside">Restaurants is one configuration — the same engine reconfigures for hospitality, sports, healthcare, education, and the public sector.</p>
    </div>
    ${foot()}
  `, 'cream'))

  // 12 — TRACTION
  const cases = [
    ['UCF Rosen College', '<5%', 'of expert time — near-professor quality (independent academic validation).'],
    ['Harlem Globetrotters', '10×', 'more responses vs. post-event email; 15–20% in-venue response rate.'],
    ['Darden · Bloomin’ Brands', 'Millions', 'of guest reviews mined annually across the brands’ locations.'],
    ['Orlando resort', 'Seconds', 'to root cause vs. weeks of manual analysis — averted a costly renovation.'],
  ]
  slides.push(slide(`
    ${rail(++c, '// traction')}
    <div class="body">
      <h2 class="head">Traction is the proof. We already have customers.</h2>
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

  // 13 — ADOPTION & STICKINESS
  const adopt = [
    ['Usage is the north star', 'Responses collected, live sessions moderated, meetings processed — the metric we drive, not vanity logos.'],
    ['Land as design partners', 'Embed with clinics, retail, and venues; convert pilots to annual contracts as usage proves out.'],
    ['Stickiness via the data', 'Once a customer’s qualitative history + benchmarks live here, switching means losing the memory.'],
    ['Net expansion', 'Grow seats + surfaces inside each account; longer-term deals as adoption deepens.'],
  ]
  slides.push(slide(`
    ${rail(++c, '// adoption + stickiness')}
    <div class="body">
      <h2 class="head">Usage that compounds into stickiness.</h2>
      ${grid2(adopt)}
      <p class="aside">Design-partner names + usage baselines added as deals close — real, never placeholder.</p>
    </div>
    ${foot()}
  `))

  // 14 — BUSINESS MODEL
  const tiers = [
    ['Starter', '$99', '/mo', '3 active studies · 1K responses · basic analytics'],
    ['Professional', '$299', '/mo', 'Unlimited studies · 10K responses · AI analytics + campaigns'],
    ['Enterprise', 'Custom', '', 'White-label · SSO · dedicated support · unlimited'],
  ]
  slides.push(slide(`
    ${rail(++c, '// model')}
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

  // 15 — FUNDING
  const funds = [
    ['Scalability', 'Load + concurrency baselines, per-org cost controls, durable pipelines.'],
    ['Enterprise usability', 'SOC 2 / GDPR, admin + onboarding, performance, polish.'],
    ['Deepen the Claude layer', 'Evals, observability, and tighter guardrails on every AI surface.'],
    ['Enterprise design partners', 'Land and harden alongside a handful of reference enterprises.'],
  ]
  slides.push(slide(`
    ${rail(++c, '// use of funds')}
    <div class="body">
      <h2 class="head">Initial funding hardens a working platform.</h2>
      ${grid2(funds)}
      <p class="aside">Not raising to find product-market fit — hardening against demand that already exists.</p>
    </div>
    ${foot()}
  `))

  // 16 — WHY WE FIT ANTHOLOGY
  const fit = [
    ['Consumer AI solution', 'LLMs as the core component driving every customer interaction — conversational surveys, chat agents, live sessions.'],
    ['Harnesses Anthropic deeply', 'Claude is the spine — Opus + Sonnet across collection, moderation, extraction, synthesis.'],
    ['A category you already back', '“Customer engagement software” is in the first Anthology cohort.'],
    ['Real traction, not a demo', 'Darden · Bloomin’ Brands · Orlando Magic · Globetrotters · Marriott · MCO.'],
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

  // 17 — THE ASK
  slides.push(slide(`
    ${rail(++c, 'The ask', true)}
    <div class="body">
      <h2 class="head" style="color:${T.paper}">Why Anthology — and what we’d do with it.</h2>
      <div class="ask">
        <div class="ask-col">
          <div class="ask-h" style="color:${T.anaLight}">What we’d do</div>
          <ul class="ask-ul">
            <li>Harden scalability + enterprise usability</li>
            <li>Deepen the Claude / Anthropic layer (evals, observability)</li>
            <li>Land enterprise design partners</li>
          </ul>
        </div>
        <div class="ask-col">
          <div class="ask-h" style="color:${T.sarinaLight}">Why Menlo × Anthropic</div>
          <ul class="ask-ul">
            <li>Claude is already our spine — credits go straight to the AI layer</li>
            <li>Menlo’s enterprise network is our GTM</li>
            <li>Anthropic-native — not a model-shopper</li>
          </ul>
        </div>
      </div>
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
    .center-dek { max-width:46ch; margin-top:24px; }
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

    .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:22px 56px; margin-top:28px; }
    .cell-num { font-family:'Fraunces',serif; font-weight:600; font-size:26px; }
    .cell-t { font-size:21px; font-weight:600; margin:6px 0 6px; }
    .cell-d { font-size:15px; color:${T.warmMid}; line-height:1.5; max-width:34ch; }

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
