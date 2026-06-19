// lib/decks/communityFeedbackHtml.ts
//
// "Gathering Community Feedback — A New Approach" — a NOWOCATS capability deck
// → PDF (16:9) via app/api/community-feedback-deck. Same warm-editorial design
// system as the pitch decks (Fraunces + DM Sans, paper/cream, Ana + Sarina).
//
// Structured around the FIVE questions every public-engagement lead has to
// answer — named up front as the spine, then a solution to each:
//   1. Did we hear from everyone (representativeness / reach)?
//   2. Could everyone take part (language access + ADA / Title VI)?
//   3. Did we hear enough to act (aggregate themes, sentiment, hotspots, coverage)?
//   4. Can we keep up with the questions (cut the email flood + reply in time)?
//   5. Can we show the community we listened (report-back + the closed loop)?
// "Will the AI stay neutral/accurate?" is deliberately NOT one of the five —
// they don't use AI today, so it's not a current pain; it lives as a separate
// "Built to be trusted" reassurance slide. The foundation (one KB behind three
// channels — Sarina web, PulseIQ pre-meeting, Town Hall live) and any-format
// intake support the answers; NOWOCATS is the field proof; the value slide
// recaps the five.

const T = {
  paper: '#FFFDF9', cream: '#FAF6F0', ink: '#1A1714', inkSoft: '#2E2A25',
  ana: '#E85A1A', anaLight: '#F57042', anaDark: '#B84010', anaPale: '#FEF0E8',
  sarina: '#2A7A6F', sarinaLight: '#3D9E91', sarinaDark: '#1D5A52', sarinaPale: '#E6F4F2',
  warmLight: '#B8ADA0', warmMid: '#8C7E6E',
}
const TOTAL = 13

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
    <span>powered by ${wordmark}</span><span>community engagement</span>
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

export function buildCommunityFeedbackHtml(): string {
  const slides: string[] = []
  let c = 0

  // 1 — TITLE
  slides.push(slide(`
    ${rail(++c, 'Public & Community Engagement')}
    <div class="body title">
      <div class="eyebrow" style="color:${T.sarina}">A new approach</div>
      <h1 class="display" style="font-size:96px">Gathering community feedback.</h1>
      <p class="lede">The five questions every engagement lead has to answer —
        and a way to answer all five, on one knowledge base.</p>
      <div class="rule" style="background:${T.ana}"></div>
      <p class="sub">Powered by Sarina + Ana — datanautix.</p>
    </div>
    ${foot()}
  `, 'cream'))

  // 2 — THE FIVE QUESTIONS (the pains, named up front — the spine)
  slides.push(slide(`
    ${rail(++c, '// what keeps you up at night')}
    <div class="body">
      <h2 class="head">Five questions every engagement lead has to answer.</h2>
      ${numList([
        ['Did we hear from everyone?', 'Or just the loudest voices and the usual faces who show up at a 7pm meeting?'],
        ['Could everyone take part?', 'In their own language, with accessibility — a Title VI and ADA obligation, not a nicety.'],
        ['Did we hear enough to act?', 'Enough input, across enough topics and groups, to defend a decision.'],
        ['Can we keep up with the questions?', 'The same questions flood staff inboxes by email — and every resident expects a timely reply.'],
        ['Can we show the community we listened?', 'A “you said, we did” residents can see — what actually makes people feel heard.'],
      ], true)}
      <p class="aside">Every public-engagement program lives or dies on these five. Here’s how we answer each.</p>
    </div>
    ${foot()}
  `))

  // 3 — THE FOUNDATION (one KB, three channels)
  slides.push(slide(`
    ${rail(++c, '// the foundation')}
    <div class="body">
      <h2 class="head">One knowledge base. Three ways to engage.</h2>
      <div class="flow">
        <div class="flow-col">
          <div class="flow-h" style="color:${T.ana}">Sarina · web</div>
          <div class="flow-d">An always-on web assistant answering residents 24×7 — so routine questions are handled on the site, <b>not in a staff inbox</b>.</div>
        </div>
        <div class="flow-col" style="background:${T.sarinaPale};border-color:${T.sarina}">
          <div class="flow-h" style="color:${T.sarinaDark}">PulseIQ · pre-meeting</div>
          <div class="flow-d">An interactive pulse that surfaces the room’s top concerns <b>before</b> the meeting starts.</div>
        </div>
        <div class="flow-col">
          <div class="flow-h" style="color:${T.ana}">Town Hall · live</div>
          <div class="flow-d">Live meeting audio captured, transcribed, and structured — within minutes.</div>
        </div>
      </div>
      <p class="aside">One curated project knowledge base sits behind all three — so every answer that follows is consistent, everywhere.</p>
    </div>
    ${foot()}
  `, 'cream'))

  // 4 — Q1: DID WE HEAR FROM EVERYONE? (representativeness / reach)
  slides.push(slide(`
    ${rail(++c, '// 1 · representativeness')}
    <div class="body">
      <h2 class="head">Did we hear from everyone — or just the loud few?</h2>
      ${numList([
        ['Participate anytime, from anywhere', 'A 24×7 web assistant and a scannable QR code reach residents who can’t make a 7pm meeting — on their own schedule, from their phone.'],
        ['Lower the barrier to speak up', 'No sign-up, no meeting room, no waiting for office hours — the people who never attend can finally be heard.'],
        ['Widen the net', 'Mailed QR codes, the web, and the live room work together to reach well beyond the usual attendees.'],
      ], true)}
      <p class="aside">A more representative picture — because being heard no longer depends on showing up in person.</p>
    </div>
    ${foot()}
  `))

  // 5 — Q2: COULD EVERYONE TAKE PART? (language access + ADA / Title VI)
  slides.push(slide(`
    ${rail(++c, '// 2 · access for all')}
    <div class="body">
      <h2 class="head">Can everyone take part — in their language, on their terms?</h2>
      ${numList([
        ['Every resident, their own language', 'Sarina converses end-to-end in the resident’s language — real bilingual (and beyond) outreach, with no separate translated site or extra staffing.'],
        ['Plain language, no jargon', 'Technical terms are translated into everyday language, so answers are clear to everyone — not just experts.'],
        ['Built for Title VI & ADA', 'Language access and clear routing to ADA contacts are first-class — meeting the obligations public agencies are held to.'],
      ], true)}
      <p class="aside">Inclusion isn’t a nicety here — it’s a legal obligation, and it’s built in.</p>
    </div>
    ${foot()}
  `, 'cream'))

  // 6 — Q3: DID WE HEAR ENOUGH TO ACT? (aggregate synthesis)
  slides.push(slide(`
    ${rail(++c, '// 3 · did we hear enough?')}
    <div class="body">
      <h2 class="head">Did we hear enough to act?</h2>
      ${numList([
        ['The themes residents actually raised', 'Responses across every channel are pooled and clustered into real themes — including the ones nobody thought to ask about.'],
        ['Where the community leans', 'Sentiment and priorities per topic, with representative quotes drawn from many voices — not a single anecdote.'],
        ['Where concern concentrates', 'The places and issues mentioned most, mapped — so the hotspots are obvious at a glance.'],
        ['Coverage you can defend', 'Responses tracked by topic and group — e.g. “50 across 6 priority categories” — so you know what’s settled and what still needs outreach.'],
      ])}
      <p class="aside">The evidence an engagement lead needs to say: we gathered sufficient, representative input.</p>
    </div>
    ${foot()}
  `))

  // 7 — Q4: CAN WE KEEP UP WITH THE QUESTIONS? (deflect email + timeliness)
  slides.push(slide(`
    ${rail(++c, '// 4 · keeping up')}
    <div class="body">
      <h2 class="head">Can we keep up — without drowning in email?</h2>
      ${numList([
        ['Sarina is the first line', 'Residents get an instant, sourced answer on the project site, 24×7 — instead of emailing the team and waiting for a reply.'],
        ['The repetitive questions never arrive', 'The FAQs that flood inboxes are answered automatically — staff never field the fiftieth version of the same question.'],
        ['Timely by default', 'No reply queue, no after-hours backlog — every resident gets an answer the moment they ask.'],
        ['Staff handle only the genuinely new', 'Only novel questions escalate to a person, so the team’s time goes where judgment is actually needed.'],
      ], true)}
      <p class="aside">Far fewer emails coming in, answered the instant they’re asked — and the load keeps shrinking as the knowledge base learns.</p>
    </div>
    ${foot()}
  `, 'cream'))

  // 8 — Q5: CAN WE SHOW THE COMMUNITY WE LISTENED? (report-back + closed loop)
  slides.push(slide(`
    ${rail(++c, '// 5 · closing the loop')}
    <div class="body">
      <h2 class="head">Can we show the community we listened?</h2>
      ${numList([
        ['Every answer is captured', 'When a question needs a human, that response is recorded into the knowledge base — not lost in a sent folder.'],
        ['Answered for everyone, next time', 'The captured answer folds back in; the next resident who asks gets it automatically.'],
        ['“You said, we did”', 'The synthesis — themes, concerns, and how each was addressed — goes back to residents and decision-makers.'],
        ['Proof their voice mattered', 'Residents can see their input shaped the outcome — the thing that actually builds trust in the process.'],
      ], true)}
      <p class="aside">Closing the loop turns “we collected feedback” into “the community knows it was heard.”</p>
    </div>
    ${foot()}
  `))

  // 9 — CONSISTENT & TRUSTED (reassurance — not one of the five)
  slides.push(slide(`
    ${rail(++c, '// consistency + trust')}
    <div class="body">
      <h2 class="head">One source of truth — consistent, and trusted.</h2>
      ${numList([
        ['The same answer, every time', 'Every resident gets the identical, approved response — no matter who would have replied, on what shift, or what they remembered.'],
        ['Sourced, or it doesn’t answer', 'Every reply comes only from approved project material — no improvisation, with the source on the record.'],
        ['No advocacy, no promises', 'Explicit guardrails: no political positions, no promised outcomes or timelines beyond the published materials.'],
        ['Corrected for accuracy', 'Names, places, and terms fixed to canonical spelling; transcripts repaired; a human can review before publishing.'],
        ['Flagged when unsure', 'When confidence is low, Sarina flags for a human instead of guessing.'],
      ], true)}
    </div>
    ${foot()}
  `, 'cream'))

  // 10 — ANY FORMAT IN (supporting capability)
  const formats = [
    ['Live meeting audio', 'Captured in the room.'],
    ['Uploaded recordings', 'Audio / video files.'],
    ['Documents & PDFs', 'Plans, notices, reports.'],
    ['Web & pulse questions', 'Sarina + PulseIQ.'],
    ['Spreadsheets / CSV', 'Comment exports, lists.'],
  ]
  slides.push(slide(`
    ${rail(++c, '// under the hood · intake')}
    <div class="body">
      <h2 class="head">Any format in — one pipeline.</h2>
      <div class="cols5">
        ${formats.map((p, i) => `
          <div class="col">
            <div class="col-bar" style="background:${i % 2 ? T.sarina : T.ana}"></div>
            <div class="col-t">${p[0]}</div><div class="col-d">${p[1]}</div>
          </div>`).join('')}
      </div>
      <p class="aside">Multilingual and multi-source — every input lands in one place, ready to analyze.</p>
    </div>
    ${foot()}
  `))

  // 11 — IN PRACTICE (NOWOCATS proof point)
  slides.push(slide(`
    ${rail(++c, '// in practice')}
    <div class="body">
      <h2 class="head">In practice: NOWOCATS.</h2>
      ${numList([
        ['Trained on their project docs', 'We trained Sarina on the NOWOCATS project materials — the curated knowledge base.'],
        ['A QR code to 37,000+ households', 'The team mailed a scannable QR code that opened Sarina — available 24×7.'],
        ['~94% answered confidently', 'Across ~265 real community questions, Sarina flagged only 16 for a human — ~94% handled with confidence.'],
        ['Live Q&A, transcribed', 'At the town hall we transcribed the live Q&A and corrected names like “Vick Road” — transcription, not auto-answering.'],
        ['Summaries public the next day', 'The structured meeting notes and full Q&A were cleaned up and posted for the community to read the very next day — not several days later.'],
      ], true)}
    </div>
    ${foot()}
  `, 'cream'))

  // 12 — THE VALUE (recap mapped to the five questions)
  const benefits = [
    ['Everyone heard', 'representative input', 'Beyond the usual attendees — 24×7, by QR, on any device.'],
    ['Access for all', 'language + ADA', 'Every resident in their own language; built for Title VI and ADA.'],
    ['Heard enough', 'evidence to act', 'Themes, sentiment, hotspots, and coverage you can defend.'],
    ['Fewer emails in', 'answered in time', 'Routine questions handled on the site — staff field only the new.'],
    ['They saw we listened', 'the loop closed', 'A “you said, we did” that compounds with every interaction.'],
  ]
  slides.push(slide(`
    ${rail(++c, '// the value')}
    <div class="body">
      <h2 class="head">Five questions. Five answers.</h2>
      <div class="cases">
        ${benefits.map(b => `<div class="case">
          <div class="case-n" style="color:${T.ana}">${b[0]}</div>
          <div><div class="case-name">${b[1]}</div><div class="case-d">${b[2]}</div></div>
        </div>`).join('')}
      </div>
    </div>
    ${foot()}
  `, 'paper'))

  // 13 — CLOSE
  slides.push(slide(`
    ${rail(++c, 'A new approach', true)}
    <div class="body center">
      <div class="eyebrow" style="color:${T.anaLight}">Community engagement</div>
      <h1 class="display" style="font-size:70px;max-width:20ch">Answer all five — on one living knowledge base.</h1>
      <p class="lede" style="color:rgba(255,253,249,.8);max-width:40ch">Hear from everyone, in any language; know you heard enough; handle the questions without the inbox flood; and show the community you listened.</p>
      <p class="closer" style="color:${T.anaLight}">datanautix &nbsp;·&nbsp; sanjay@datanautix.com</p>
    </div>
    ${foot(true)}
  `, 'ink'))

  return `<!doctype html><html><head><meta charset="utf-8">
  <title>Gathering Community Feedback — NOWOCATS</title>
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
    .display { font-family:'Fraunces',serif; font-weight:900; font-size:96px; line-height:.96; letter-spacing:-.01em; max-width:20ch; }
    .head { font-family:'Fraunces',serif; font-weight:900; font-size:43px; line-height:1.05; letter-spacing:-.01em; max-width:26ch; }
    .eyebrow { font-size:15px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; margin-bottom:22px; }
    .lede { font-size:24px; line-height:1.45; max-width:32ch; margin-top:26px; color:${T.inkSoft}; font-weight:300; }
    .rule { width:64px; height:4px; margin:30px 0 18px; }
    .sub { font-size:18px; color:${T.warmMid}; font-style:italic; }
    .closer { margin-top:26px; font-size:17px; font-weight:500; font-style:italic; }
    .aside { position:absolute; left:88px; right:88px; bottom:56px; font-size:14px; color:${T.warmMid}; font-style:italic; max-width:70ch; } .aside b { font-weight:600; color:${T.inkSoft}; }

    .list { margin-top:34px; }
    .list.tight .li { padding:11px 0; }
    .li { display:flex; gap:24px; padding:14px 0; border-top:1px solid ${T.warmLight}; align-items:baseline; }
    .li:last-child { border-bottom:1px solid ${T.warmLight}; }
    .li-num { font-family:'Fraunces',serif; font-weight:600; font-size:22px; min-width:42px; }
    .li-t { font-size:21px; font-weight:600; }
    .li-d { font-size:15px; color:${T.warmMid}; margin-top:3px; line-height:1.45; }

    .flow { display:flex; align-items:stretch; gap:18px; margin-top:48px; }
    .flow-col { flex:1; background:${T.cream}; border:1px solid ${T.warmLight}; border-radius:14px; padding:26px 24px; }
    .flow-arrow { align-self:center; font-size:32px; color:${T.warmMid}; font-family:'Fraunces',serif; }
    .flow-h { font-size:14px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; margin-bottom:14px; }
    .flow-d { font-size:16px; line-height:1.6; color:${T.inkSoft}; } .flow-d b { font-weight:600; color:${T.ink}; }

    .cols5 { display:grid; grid-template-columns:repeat(5,1fr); gap:26px; margin-top:44px; }
    .col-bar { width:34px; height:4px; margin-bottom:16px; }
    .col-t { font-size:17px; font-weight:600; line-height:1.2; }
    .col-d { font-size:13px; color:${T.warmMid}; margin-top:8px; line-height:1.5; }

    .cases { margin-top:16px; }
    .case { display:flex; gap:28px; align-items:baseline; padding:8px 0; border-top:1px solid ${T.warmLight}; }
    .case-n { font-family:'Fraunces',serif; font-weight:900; font-size:25px; width:230px; flex-shrink:0; line-height:1.05; }
    .case-name { font-size:18px; font-weight:600; } .case-d { font-size:14px; color:${T.warmMid}; margin-top:2px; }
  </style></head><body>${slides.join('')}</body></html>`
}
