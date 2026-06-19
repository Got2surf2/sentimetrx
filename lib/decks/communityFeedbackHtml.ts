// lib/decks/communityFeedbackHtml.ts
//
// "Gathering Community Feedback — A New Approach" — a NOWOCATS capability deck
// → PDF (16:9) via app/api/community-feedback-deck. Same warm-editorial design
// system as the pitch decks (Fraunces + DM Sans, paper/cream, Ana + Sarina).
//
// Story: one project knowledge base → three front doors (the Sarina web
// assistant, the PulseIQ pre-meeting pulse, and the live Town Hall capture)
// → any-format intake → an accuracy/error-
// correction layer → near-real-time meeting notes + Q&A → a closed-loop
// engagement process where Sarina answers first, escalations are captured back
// into the KB, and low-confidence answers are flagged for continuous improvement.

const T = {
  paper: '#FFFDF9', cream: '#FAF6F0', ink: '#1A1714', inkSoft: '#2E2A25',
  ana: '#E85A1A', anaLight: '#F57042', anaDark: '#B84010', anaPale: '#FEF0E8',
  sarina: '#2A7A6F', sarinaLight: '#3D9E91', sarinaDark: '#1D5A52', sarinaPale: '#E6F4F2',
  warmLight: '#B8ADA0', warmMid: '#8C7E6E',
}
const TOTAL = 14

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
      <p class="lede">One project knowledge base — powering a web assistant, a pre-meeting pulse,
        and live town-hall capture. Every voice heard; answers in minutes.</p>
      <div class="rule" style="background:${T.ana}"></div>
      <p class="sub">Powered by Sarina + Ana — datanautix.</p>
    </div>
    ${foot()}
  `, 'cream'))

  // 2 — THE CHALLENGE
  slides.push(slide(`
    ${rail(++c, '// the challenge')}
    <div class="body">
      <h2 class="head">Public engagement is slow, fragmented, and lossy.</h2>
      ${numList([
        ['Meetings vanish', 'Hours of in-person audio are never mined; notes take weeks to write up.'],
        ['Questions pile up', 'Community questions land in staff inboxes and wait for a human to reply.'],
        ['Answers are inconsistent', 'Responses vary by who replies, when, and what they remember.'],
        ['Nothing compounds', 'A question answered once isn’t reusable the next time it’s asked.'],
      ])}
      <p class="aside">The information exists — it just isn’t captured, unified, or reused.</p>
    </div>
    ${foot()}
  `))

  // 3 — ONE KB, EVERY TOUCHPOINT
  slides.push(slide(`
    ${rail(++c, '// the approach')}
    <div class="body">
      <h2 class="head">One knowledge base. Every touchpoint.</h2>
      <div class="flow">
        <div class="flow-col">
          <div class="flow-h" style="color:${T.ana}">Sarina · web</div>
          <div class="flow-d">An always-on assistant answering community questions, 24×7.</div>
        </div>
        <div class="flow-col" style="background:${T.sarinaPale};border-color:${T.sarina}">
          <div class="flow-h" style="color:${T.sarinaDark}">PulseIQ · pre-meeting</div>
          <div class="flow-d">An interactive pulse so moderators see the top concerns <b>before</b> the meeting starts.</div>
        </div>
        <div class="flow-col">
          <div class="flow-h" style="color:${T.ana}">Town Hall · live</div>
          <div class="flow-d">Live meeting audio captured, transcribed, and structured.</div>
        </div>
      </div>
      <p class="aside">One curated project knowledge base sits behind all three — consistent everywhere.</p>
    </div>
    ${foot()}
  `, 'cream'))

  // 4 — SARINA
  slides.push(slide(`
    ${rail(++c, '// the assistant')}
    <div class="body">
      <h2 class="head">Sarina: the project’s front-line assistant.</h2>
      ${numList([
        ['On the project website, 24/7', 'Answers community questions in plain language, grounded in the project KB.'],
        ['The first line of defense', 'Resolves the common questions instantly — before they ever reach a staff inbox.'],
        ['Always on-message', 'Every answer is sourced from approved project material — no improvisation.'],
      ], true)}
      <p class="aside">Most routine questions never need a human at all.</p>
    </div>
    ${foot()}
  `))

  // 5 — PULSEIQ (pre-meeting pulse)
  slides.push(slide(`
    ${rail(++c, '// the pulse')}
    <div class="body">
      <h2 class="head">PulseIQ: the room’s concerns, before the meeting.</h2>
      ${numList([
        ['An interactive pre-meeting pulse', 'Community members weigh in digitally in the days before a town hall — questions, concerns, priorities.'],
        ['Moderators walk in prepared', 'The top themes are summarized and ranked, so the agenda meets the room where it actually is.'],
        ['Feeds the same knowledge base', 'What surfaces in the pulse joins the project KB — informing Sarina and the meeting alike.'],
      ], true)}
      <p class="aside">No more guessing what the community will raise — you already know going in.</p>
    </div>
    ${foot()}
  `, 'cream'))

  // 6 — TOWN HALL LIVE
  slides.push(slide(`
    ${rail(++c, '// the meeting')}
    <div class="body">
      <h2 class="head">The town hall — captured live.</h2>
      ${numList([
        ['Recorded in the room', 'We capture the live community-meeting audio as it happens.'],
        ['Near-real-time transcription', 'Speech becomes clean, structured text within minutes.'],
        ['The same knowledge base', 'The transcript is read against the same project KB that powers Sarina.'],
      ], true)}
      <p class="aside">Nothing from the meeting is lost — and it’s usable almost immediately.</p>
    </div>
    ${foot()}
  `, 'paper'))

  // 7 — ANY FORMAT IN
  const formats = [
    ['Live meeting audio', 'Captured in the room.'],
    ['Uploaded recordings', 'Audio / video files.'],
    ['Documents & PDFs', 'Plans, notices, reports.'],
    ['Web questions', 'Asked through Sarina.'],
    ['Spreadsheets / CSV', 'Comment exports, lists.'],
  ]
  slides.push(slide(`
    ${rail(++c, '// intake')}
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
  `, 'cream'))

  // 8 — ACCURACY / ERROR CORRECTION
  slides.push(slide(`
    ${rail(++c, '// accuracy')}
    <div class="body">
      <h2 class="head">Accuracy you can trust.</h2>
      ${numList([
        ['Entity + name spelling', 'Road names, places, people, and project terms corrected to the canonical spelling.'],
        ['Speaker attribution', 'Who said what, cleaned up and consolidated across the meeting.'],
        ['Transcript repair', 'Faint or garbled speech re-checked; quiet stretches re-transcribed.'],
        ['Human gate review', 'A reviewer can verify and correct before anything is published.'],
      ])}
      <p class="aside">The model does the heavy lifting; the corrections make it publishable.</p>
    </div>
    ${foot()}
  `))

  // 9 — NEAR-REAL-TIME OUTPUTS
  slides.push(slide(`
    ${rail(++c, '// outputs')}
    <div class="body">
      <h2 class="head">Meeting notes + Q&A, in minutes.</h2>
      ${numList([
        ['Structured meeting notes', 'A clean summary of what was presented and decided.'],
        ['Q&A capture', 'Every question and its answer, extracted and organized.'],
        ['Action items', 'Follow-ups with owners and dates, ready to circulate.'],
      ], true)}
      <p class="aside">Available minutes after the meeting — not weeks later.</p>
    </div>
    ${foot()}
  `, 'cream'))

  // 10 — THE NEW PROCESS (closed loop)
  slides.push(slide(`
    ${rail(++c, '// the process')}
    <div class="body">
      <h2 class="head">A new way to engage the community.</h2>
      ${numList([
        ['Sarina answers first', 'Most questions are resolved instantly on the web, from the knowledge base.'],
        ['Escalate the rest', 'Questions Sarina can’t answer route to the right person — not a shared inbox.'],
        ['Capture the answer', 'The human’s response is folded back into the knowledge base.'],
        ['Answered from then on', 'The next time it’s asked, Sarina answers it — automatically.'],
      ], true)}
      <p class="aside">Highest-quality responses in the shortest time — and the inbox load keeps shrinking.</p>
    </div>
    ${foot()}
  `))

  // 11 — CONFIDENCE + CONTINUOUS IMPROVEMENT
  slides.push(slide(`
    ${rail(++c, '// trust + improvement')}
    <div class="body">
      <h2 class="head">Confidence-flagged, always improving.</h2>
      ${numList([
        ['Low-confidence flags', 'When Sarina isn’t sure, it flags the response for review instead of guessing.'],
        ['Every human answer teaches it', 'Escalated answers and reviewer corrections feed straight back into the KB.'],
        ['A knowledge base that compounds', 'Coverage and accuracy climb with every meeting and every question.'],
      ], true)}
      <p class="aside">The system gets more capable — and more trustworthy — the more it’s used.</p>
    </div>
    ${foot()}
  `, 'cream'))

  // 12 — THE BENEFIT
  const benefits = [
    ['Minutes', 'to notes & Q&A', 'Meeting output in minutes, not weeks of manual write-up.'],
    ['First-line', 'web answers', 'Common questions resolved before they reach a human.'],
    ['One KB', 'consistent everywhere', 'Web, meetings, and follow-ups all on the same message.'],
    ['Compounding', 'coverage', 'Every answer and correction makes the next one better.'],
  ]
  slides.push(slide(`
    ${rail(++c, '// the benefit')}
    <div class="body">
      <h2 class="head">Faster, consistent — and nothing lost.</h2>
      <div class="cases">
        ${benefits.map(b => `<div class="case">
          <div class="case-n" style="color:${T.ana}">${b[0]}</div>
          <div><div class="case-name">${b[1]}</div><div class="case-d">${b[2]}</div></div>
        </div>`).join('')}
      </div>
    </div>
    ${foot()}
  `))

  // 13 — IN PRACTICE (NOWOCATS proof point)
  slides.push(slide(`
    ${rail(++c, '// in practice')}
    <div class="body">
      <h2 class="head">In practice: NOWOCATS.</h2>
      ${numList([
        ['Trained on their project docs', 'We trained Sarina on the NOWOCATS project materials — the curated knowledge base.'],
        ['A QR code to 37,000+ households', 'The team mailed a scannable QR code that opened Sarina — available 24×7.'],
        ['~94% answered confidently', 'Across ~265 real community questions, Sarina flagged only 16 for a human — ~94% handled with confidence.'],
        ['Live Q&A, transcribed', 'At the town hall we transcribed the live Q&A and corrected names like “Vick Road” — transcription, not auto-answering.'],
      ], true)}
      <p class="aside">The same approach generalizes to any public-engagement or community program.</p>
    </div>
    ${foot()}
  `, 'cream'))

  // 14 — CLOSE
  slides.push(slide(`
    ${rail(++c, 'A new approach', true)}
    <div class="body center">
      <div class="eyebrow" style="color:${T.anaLight}">Community engagement</div>
      <h1 class="display" style="font-size:70px;max-width:20ch">A living knowledge base for community engagement.</h1>
      <p class="lede" style="color:rgba(255,253,249,.8);max-width:38ch">Capture every voice, answer in minutes, and get smarter with every interaction.</p>
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

    .cases { margin-top:24px; }
    .case { display:flex; gap:28px; align-items:baseline; padding:13px 0; border-top:1px solid ${T.warmLight}; }
    .case-n { font-family:'Fraunces',serif; font-weight:900; font-size:30px; width:230px; flex-shrink:0; }
    .case-name { font-size:18px; font-weight:600; } .case-d { font-size:14px; color:${T.warmMid}; margin-top:2px; }
  </style></head><body>${slides.join('')}</body></html>`
}
