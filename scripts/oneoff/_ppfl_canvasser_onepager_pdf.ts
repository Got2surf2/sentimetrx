// Run: node --conditions=react-server --import tsx scripts/oneoff/_ppfl_canvasser_onepager_pdf.ts
// Throwaway: two-page prospect one-pager for People Power for Florida (peoplepowerfl.org)
// — AI canvasser practice gym (pg 1) + AI field companion (pg 2) for under-40 voter
// outreach. Renders to ~/Downloads. Not committed as a deck route (owner chose one-off).
// Brand palette verified from their live Squarespace CSS: violet #3E1264 ground,
// lavender #B695D2/#CEB5E3 panels, off-white #F7F7FF text, neo-brutalist white
// cards w/ 2px black borders + hard black offset shadows, pink #FD7DAF minor accent.
import { htmlToPdfBuffer, brandedPdfChrome } from '../../lib/htmlToPdf'
import { writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
         margin: 0; font-size: 10.5px; line-height: 1.4; color: #F7F7FF; }
  .page { background: #3E1264; border-radius: 10px; padding: 25px 24px; position: relative; overflow: hidden; }
  .pb { page-break-after: always; }
  .keep { break-inside: avoid; }

  .eyebrow { font-size: 9px; letter-spacing: .18em; text-transform: uppercase; color: #CEB5E3; font-weight: 700; margin: 0 0 8px; }
  .eyebrow .d { color: #7BD9DB; } .eyebrow .n { color: #FFA36B; }
  h1 { font-size: 30px; line-height: 1.02; margin: 0 0 6px; color: #fff; font-weight: 900;
       text-transform: uppercase; letter-spacing: .01em; text-shadow: 3px 3px 0 #000; }
  .sub { font-size: 12.5px; color: #F7F7FF; margin: 0 0 12px; font-weight: 500; max-width: 660px; }
  .sub b { color: #fff; }

  .ticker { background: #FD7DAF; color: #000; border-top: 2px solid #000; border-bottom: 2px solid #000;
            font-weight: 900; text-transform: uppercase; letter-spacing: .14em; font-size: 10px;
            text-align: center; padding: 5px 0; margin: 0 -24px 16px; }

  h2 { font-size: 12px; color: #fff; text-transform: uppercase; letter-spacing: .12em;
       margin: 16px 0 9px; font-weight: 900; text-shadow: 2px 2px 0 #000; }

  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .card { background: #fff; color: #1a1a1a; border: 2px solid #000; border-radius: 6px;
          box-shadow: 5px 5px 0 #000; padding: 10px 12px; }
  .card .step { display: inline-block; background: #3E1264; color: #fff; font-weight: 900; font-size: 9px;
                border-radius: 999px; padding: 2px 8px; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 5px; }
  .card h3 { margin: 0 0 4px; font-size: 12px; font-weight: 900; text-transform: uppercase; color: #3E1264; }
  .card p { margin: 0; font-size: 10px; line-height: 1.42; color: #2a2a2a; }

  .panel { background: #CEB5E3; color: #2a0a4a; border: 2px solid #000; border-radius: 6px;
           box-shadow: 5px 5px 0 #000; padding: 10px 12px; }
  .panel h3 { margin: 0 0 5px; font-size: 11px; font-weight: 900; text-transform: uppercase; color: #3E1264; }
  .panel p { margin: 0; font-size: 10px; color: #2a0a4a; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
  .chip { background: #fff; border: 1.5px solid #000; border-radius: 999px; padding: 2.5px 9px;
          font-size: 9px; font-weight: 700; color: #3E1264; box-shadow: 2px 2px 0 #000; }

  .stars { color: #FD7DAF; font-size: 15px; letter-spacing: 2px; text-shadow: 1px 1px 0 #000; }
  .stars .off { color: #d8d8d8; text-shadow: none; }
  .quote { font-style: italic; color: #2a2a2a; font-size: 9.5px; line-height: 1.45; margin: 5px 0 0; }
  .taglabel { font-size: 8px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; color: #8a6aa8; }

  .band { background: #B695D2; color: #2a0a4a; border: 2px solid #000; border-radius: 6px;
          box-shadow: 5px 5px 0 #000; padding: 10px 14px; margin-top: 14px; }
  .band b { color: #3E1264; }
  .band p { margin: 0; font-size: 10.3px; }

  .loop { display: flex; align-items: stretch; gap: 6px; margin: 4px 0 0; }
  .loop .node { flex: 1; background: #fff; border: 2px solid #000; border-radius: 6px; box-shadow: 3px 3px 0 #000;
                padding: 7px 8px; text-align: center; }
  .loop .node .t { font-weight: 900; font-size: 9px; text-transform: uppercase; color: #3E1264; display: block; }
  .loop .node .s { font-size: 8.5px; color: #444; }
  .loop .arrow { align-self: center; font-weight: 900; font-size: 14px; color: #FD7DAF; text-shadow: 1px 1px 0 #000; }

  table { width: 100%; border-collapse: collapse; font-size: 9.3px; background: #fff; color: #222;
          border: 2px solid #000; box-shadow: 5px 5px 0 #000; border-radius: 6px; overflow: hidden; }
  th { text-align: left; background: #000; color: #fff; padding: 4px 9px; font-weight: 800; font-size: 9px;
       text-transform: uppercase; letter-spacing: .06em; }
  td { border-bottom: 1px solid #e2d7ee; padding: 4px 9px; vertical-align: top; }
  td.who { font-weight: 800; color: #3E1264; white-space: nowrap; width: 150px; }
  tr.us td { background: #FDE8F1; border-bottom: none; }

  .cta { display: flex; gap: 12px; align-items: center; margin-top: 14px; }

  .whoband { background: #000; color: #F7F7FF; border-radius: 6px; box-shadow: 5px 5px 0 #FD7DAF;
             padding: 9px 14px; margin-top: 15px; }
  .whoband .wt { color: #FD7DAF; font-weight: 900; text-transform: uppercase; letter-spacing: .12em;
                 font-size: 9.5px; margin-right: 8px; }
  .whoband p { margin: 0; font-size: 10px; line-height: 1.45; }
  .whoband b { color: #fff; }
  .whoband .d { color: #7BD9DB; font-weight: 800; } .whoband .n { color: #FFA36B; font-weight: 800; }
  .ctabtn { background: #fff; color: #000; border: 2px solid #000; border-radius: 6px; box-shadow: 6px 6px 0 #000;
            font-weight: 900; text-transform: uppercase; font-size: 11px; padding: 9px 16px; white-space: nowrap; }
  .cta p { margin: 0; font-size: 10px; color: #E7DBF2; }
</style></head><body>

<!-- ============================ PAGE 1 ============================ -->
<div class="page pb">
  <p class="eyebrow">Prepared for People Power for Florida &nbsp;·&nbsp; by <span class="d">data</span><span class="n">nautix</span></p>
  <h1>Ready for<br>every door.</h1>
  <p class="sub">An <b>AI practice gym</b> that prepares your canvassers to earn the trust of
  under-40 voters — <b>before they knock a single real door.</b></p>

  <div class="ticker">Practice&nbsp;&nbsp;〰&nbsp;&nbsp;Knock&nbsp;&nbsp;〰&nbsp;&nbsp;Listen&nbsp;&nbsp;〰&nbsp;&nbsp;Build Power</div>

  <p class="sub" style="margin-bottom:10px">You're building youth power one voter at a time. Every knock and every
  campus intercept is a personal invitation into civic life — often the first one a young voter has ever received —
  and it lands or dies on trust. Today, new canvassers learn on real voters. <b>Let's train them before they start
  their turf.</b></p>

  <h2>How it works</h2>
  <div class="grid2 keep">
    <div class="card"><span class="step">Step 1</span>
      <h3>Draw a persona</h3>
      <p>The system randomly deals an AI voter persona built from the under-40 voter types your teams actually
      meet — first-timers, skeptics, the checked-out — each carrying the real reasons young people hold back:
      no time, no trust, real worry about what being visible could cost them.</p>
    </div>
    <div class="card"><span class="step">Step 2</span>
      <h3>Have the conversation</h3>
      <p>The canvasser engages in a live back-and-forth chat — door-knock or intercept mode. The persona deflects,
      challenges, warms up, or shuts down, the way real people do.</p>
    </div>
    <div class="card"><span class="step">Step 3</span>
      <h3>Get the debrief</h3>
      <p>When the chat ends, the system reviews the whole conversation: turn-by-turn guidance on what could have
      been said differently, language to change at each moment, and overall coaching.</p>
    </div>
    <div class="card"><span class="step">Step 4</span>
      <h3>Earn the score</h3>
      <p>Every session ends with a 1–5 star score built on what actually moves young voters — listen before you
      pitch, keep it local and concrete, lower the risk, leave a small real next step. Organizers see who's
      door-ready and who needs another rep.</p>
    </div>
  </div>

  <div class="grid2 keep" style="margin-top:12px">
    <div class="panel">
      <h3>Personas, built with your organizers</h3>
      <p>Your regional leads know these voters. We turn that knowledge into a rotating cast — for example:</p>
      <div class="chips">
        <span class="chip">"My vote changes nothing" first-timer</span>
        <span class="chip">Too-busy service worker</span>
        <span class="chip">Skeptical campus senior</span>
        <span class="chip">NPA who trusts no one</span>
        <span class="chip">"I'm not political"</span>
      </div>
    </div>
    <div class="card">
      <span class="taglabel">Illustrative debrief</span><br>
      <span class="stars">★★★★<span class="off">★</span></span> <b style="color:#3E1264;font-size:10px">4 of 5 — door-ready</b>
      <p class="quote">"Strong open and real listening. At turn 3, when she said 'politicians are all the same,'
      you jumped back to the script — next time validate first: 'Honestly? A lot of people our age feel exactly
      that way. Can I tell you why I still do this?'"</p>
    </div>
  </div>

  <div class="band keep">
    <p><b>Why now — and why you'd be first.</b> Florida's tightened third-party voter-registration rules make
    every field interaction higher-stakes, and preparation is protection. Meanwhile, sales teams have had AI
    role-play gyms for years — yet our market scan found <b>no U.S. platform offering AI practice conversations
    for canvassers.</b> This builds on conversational AI we already run in production, purpose-built for organizing.</p>
  </div>

  <div class="whoband keep">
    <p><span class="wt">Who we are</span>
    <span class="d">data</span><span class="n">nautix</span> has spent <b>more than a decade in AI-enabled text
    analytics</b> — turning what people actually say, in their own words, into what organizations do. From customer
    reviews and open-ended surveys to town halls and live conversations, understanding unscripted human language at
    scale is our craft. This tool doesn't start from zero; it starts from that heritage.</p>
  </div>
</div>

<!-- ============================ PAGE 2 ============================ -->
<div class="page">
  <p class="eyebrow">Prepared for People Power for Florida &nbsp;·&nbsp; by <span class="d">data</span><span class="n">nautix</span></p>
  <h1 style="font-size:26px">Then take it to the door.</h1>
  <p class="sub" style="margin-bottom:10px">A <b>field companion</b> on the canvasser's phone or tablet — the same voter intelligence from
  the practice gym, now live at every door and every intercept.</p>

  <h2 style="margin-top:14px">What the canvasser sees at each door</h2>
  <div class="grid2 keep">
    <div class="card"><span class="step">Context</span>
      <h3>Who's at this door</h3>
      <p>Quick, glanceable context on the person they're hoping to reach — so the conversation starts warm,
      not cold.</p>
    </div>
    <div class="card"><span class="step">Guidance</span>
      <h3>What to lead with</h3>
      <p>Suggested talking points matched to that voter's profile — generated by the same persona intelligence
      the canvasser trained against in the gym.</p>
    </div>
    <div class="card"><span class="step">Research</span>
      <h3>The questions that matter</h3>
      <p>One or two research questions drawn from your central question bank — and only the ones that haven't yet
      hit their completion target.</p>
    </div>
    <div class="card"><span class="step">Capture</span>
      <h3>Log the interaction</h3>
      <p>Outcome, reaction, and notes logged in seconds before the next door — so your team can circle back and
      show people what came of it. <b>Every conversation gets a receipt.</b></p>
    </div>
  </div>

  <div class="panel keep" style="margin-top:12px">
    <h3>The central research engine</h3>
    <p>HQ writes the research questions once and sets a <b>target completion rate</b> for each. The system rotates
    them across every door and intercept statewide — automatically retiring questions that hit their target and
    surfacing the ones that haven't. Your canvass quietly becomes a <b>continuous, statewide study of Florida's
    under-40 electorate</b> — while it registers and mobilizes.</p>
  </div>

  <h2 style="margin-top:14px">One intelligence layer, one loop</h2>
  <div class="loop keep">
    <div class="node"><span class="t">Practice gym</span><span class="s">personas train canvassers</span></div>
    <div class="arrow">→</div>
    <div class="node"><span class="t">Field companion</span><span class="s">talking points at real doors</span></div>
    <div class="arrow">→</div>
    <div class="node"><span class="t">Captured data</span><span class="s">answers, reactions, outcomes</span></div>
    <div class="arrow">→</div>
    <div class="node"><span class="t">Sharper personas</span><span class="s">training gets more real</span></div>
  </div>

  <h2 style="margin-top:14px">Who else does this? Nobody — all of it.</h2>
  <table class="keep">
    <tr><th>The landscape</th><th>What they offer</th></tr>
    <tr><td class="who">Walk-list apps<br><span style="font-weight:400;color:#666">MiniVAN, Ecanvasser, Reach</span></td>
        <td>Lists, static scripts, and data capture. No AI guidance, no training, no question rotation.</td></tr>
    <tr><td class="who">i360 Walk</td>
        <td>Per-voter dynamic scripts — but rules-based, and it lives in the other side's data ecosystem.</td></tr>
    <tr><td class="who">New AI entrants<br><span style="font-weight:400;color:#666">CanvaCORE, Qomon</span></td>
        <td>Early AI cues from demographics or CRM history. No practice gym, no research engine.</td></tr>
    <tr class="us"><td class="who">This proposal</td>
        <td><b>The only system that trains canvassers and coaches them in the field from one persona
        intelligence layer</b> — with research questions that rotate toward completion targets.</td></tr>
  </table>

  <div class="whoband keep" style="margin-top:14px">
    <p><span class="wt">Why us</span>
    We're a <b>consumer insights company with a deep experience base in research</b> — not a software vendor bolting
    AI onto politics. Our conversational agents run real customer- and constituent-facing conversations in production
    today: for one national seafood restaurant brand, our approach drew <b>3.5× the response rate</b> of their
    traditional survey. That research DNA makes the personas feel real, keeps the questions rigorous, and makes the
    data captured at the door worth trusting.</p>
  </div>

  <div class="cta keep">
    <span class="ctabtn">Start with one region</span>
    <p>Pilot with a single fellows cohort: your organizers help shape the personas, your canvassers train in the
    gym, and your first research questions go to the field. <b style="color:#fff">datanautix.com</b></p>
  </div>
</div>

</body></html>`

async function main() {
  const chrome = brandedPdfChrome({ brand: 'People Power for Florida · Datanautix' })
  const pdf = await htmlToPdfBuffer(html, { format: 'letter', ...chrome })
  const out = join(homedir(), 'Downloads', 'People_Power_FL_Younger_Voter_Canvassing_AI.pdf')
  writeFileSync(out, pdf)
  console.log('Wrote', out, pdf.length, 'bytes')
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
