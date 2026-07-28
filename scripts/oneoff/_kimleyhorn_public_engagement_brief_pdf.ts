// Run: node --conditions=react-server --import tsx scripts/oneoff/_kimleyhorn_public_engagement_brief_pdf.ts
// Throwaway: two-page partner brief for Eliza @ Kimley-Horn, following her pointer to
// four public-engagement platforms (Social Pinpoint/Open Point, PublicInput, ArcGIS
// StoryMaps, PublicCoordinate). PublicCoordinate is Kimley-Horn's OWN internal tool, so
// the brief is deliberately AUGMENT-framed, never competitive.
//
// IP DISCIPLINE (owner instruction 2026-07-27): describe OUTCOMES and the QUESTIONS WE
// ANSWER — never the method. No taxonomy axes, no statistical technique names, no
// dedup/stance-coding/diarization pipeline description. They should understand the value
// and not be able to rebuild it.
//
// NO MAP/GEOGRAPHY CONTENT (owner instruction 2026-07-28): the map thread is stripped
// throughout — no "we don't build maps", no geotagged/coordinates/geography framing, no
// per-district reporting claim. Do not reintroduce it. ArcGIS StoryMaps stays named only
// because it's one of the four platforms she sent.
//
// Renders to ~/Downloads. Not committed as a deck route (owner chose one-off).
import { htmlToPdfBuffer, brandedPdfChrome } from '../../lib/htmlToPdf'
import { writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const TEAL = '#0F7173'
const ORANGE = '#E85A1A'

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
         margin: 0; font-size: 10.6px; line-height: 1.52; color: #1f2937; }
  .pb { page-break-after: always; }
  .keep { break-inside: avoid; }

  .eyebrow { font-size: 8.5px; letter-spacing: .17em; text-transform: uppercase; color: #94a3b8;
             font-weight: 700; margin: 0 0 9px; }
  h1 { font-size: 25px; line-height: 1.1; margin: 0 0 8px; color: #0f172a; font-weight: 800; letter-spacing: -.01em; }
  .rule { height: 3px; width: 54px; background: ${ORANGE}; border-radius: 2px; margin: 0 0 13px; }
  .sub { font-size: 12px; color: #475569; margin: 0 0 20px; max-width: 640px; line-height: 1.5; }
  .sub b { color: #0f172a; font-weight: 600; }

  h2 { font-size: 10px; color: ${TEAL}; text-transform: uppercase; letter-spacing: .13em;
       margin: 20px 0 8px; font-weight: 800; }
  h2:first-of-type { margin-top: 0; }
  p { margin: 0 0 9px; }
  p:last-child { margin-bottom: 0; }

  .note { background: #f8fafc; border-left: 3px solid ${TEAL}; border-radius: 0 5px 5px 0;
          padding: 11px 14px; margin: 13px 0; }
  .note .lbl { font-size: 8px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase;
               color: ${TEAL}; display: block; margin-bottom: 4px; }
  .note p { font-size: 10.2px; color: #334155; }

  .qbox { background: #fff; border: 1px solid #e2e8f0; border-radius: 7px; padding: 13px 16px; margin: 11px 0 0; }
  .qbox ul { margin: 0; padding: 0; list-style: none; }
  .qbox li { position: relative; padding-left: 17px; margin-bottom: 7px; font-size: 10.3px; color: #334155; line-height: 1.45; }
  .qbox li:last-child { margin-bottom: 0; }
  .qbox li:before { content: ''; position: absolute; left: 0; top: 6px; width: 6px; height: 6px;
                    border-radius: 50%; background: ${ORANGE}; }

  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 11px; margin-top: 11px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-top: 3px solid ${TEAL};
          border-radius: 6px; padding: 12px 13px; }
  .card .num { font-size: 8px; font-weight: 800; letter-spacing: .13em; color: ${ORANGE};
               text-transform: uppercase; display: block; margin-bottom: 5px; }
  .card h3 { margin: 0 0 5px; font-size: 11.5px; font-weight: 700; color: #0f172a; line-height: 1.25; }
  .card p { margin: 0; font-size: 9.7px; color: #475569; line-height: 1.45; }

  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; margin-top: 11px; }
  .split h4 { margin: 0 0 6px; font-size: 9.5px; font-weight: 800; text-transform: uppercase;
              letter-spacing: .09em; color: #64748b; }
  .split p { font-size: 10.2px; color: #334155; }
  .split .you h4 { color: ${TEAL}; }
  .split .us h4 { color: ${ORANGE}; }

  .deliv { background: #f8fafc; border-radius: 7px; padding: 13px 16px; margin-top: 11px; }
  .deliv ul { margin: 0; padding: 0; list-style: none; }
  .deliv li { position: relative; padding-left: 19px; margin-bottom: 6px; font-size: 10.2px; color: #334155; }
  .deliv li:last-child { margin-bottom: 0; }
  .deliv li:before { content: '\\2192'; position: absolute; left: 0; top: 0; color: ${TEAL}; font-weight: 700; }

  .cta { background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 15px 18px; margin-top: 20px; }
  .cta h3 { margin: 0 0 6px; font-size: 13px; color: #fff; font-weight: 700; }
  .cta p { font-size: 10.2px; color: #cbd5e1; margin: 0 0 8px; }
  .cta .ask { font-size: 10.2px; color: #fff; margin: 0; }
  .cta .ask b { color: ${ORANGE}; }

  .sig { margin-top: 18px; font-size: 9.6px; color: #64748b; }
  .sig b { color: #0f172a; }
</style></head><body>

<!-- ============================ PAGE 1 ============================ -->
<p class="eyebrow">Public engagement technology &nbsp;·&nbsp; Prepared for Kimley-Horn &nbsp;·&nbsp; July 2026</p>
<h1>Where We Add Value</h1>
<div class="rule"></div>
<p class="sub">Notes from a review of the four platforms you shared — and where we think we
<b>complement PublicCoordinate rather than duplicate it</b>.</p>

<h2>Why we looked</h2>
<p>Thank you for pointing us at Social Pinpoint, PublicInput, ArcGIS StoryMaps, and PublicCoordinate —
and for the Mentimeter mention, which turned out to be the most interesting thread of the four. We spent
real time in all of them to understand where the category is strong, where it's thin, and — most usefully
— where we could <b>add</b> something rather than rebuild something you already have. This is what we found.</p>

<h2>What we found across the category</h2>
<p>The category has converged on a common shape: a branded project portal, structured feedback
collection, notification and subscriber management, and a defensible record proving the process was
run properly. The platforms differentiate on breadth of collection tools and on record-keeping rigor,
and they do that job well. We're not looking to compete there.</p>

<div class="note keep">
  <span class="lbl">One piece of intel worth passing along</span>
  <p>Social Pinpoint no longer operates under that name. As of March 2026 it merged with Consultation
  Manager to become <b>Open Point</b> — a single platform combining community engagement with stakeholder
  relationship management, now private-equity backed and pushing actively into the North American market.
  Useful to know if it surfaces in a procurement conversation.</p>
</div>

<h2>The one consistent gap</h2>
<p>Across all four, the analysis layer stops in the same place: <b>automated sentiment, plus
auto-generated topic tags</b>.</p>
<p>That's genuinely useful for triage — roughly how many comments were negative, and roughly what they
were about. But it doesn't answer the questions that actually shape a project decision or survive a
public challenge:</p>

<div class="qbox keep">
  <ul>
    <li>Which specific concerns are <b>driving</b> opposition — as opposed to simply being mentioned most often?</li>
    <li>Is the difference between two neighborhoods, or two alternatives, <b>real</b> — or is it noise in a small sample?</li>
    <li>Which named intersections, facilities, corridors, or programs are people actually talking about?</li>
    <li>What did the public raise that <b>nobody thought to ask about</b>?</li>
    <li>Which comments carry language that signals escalation rather than ordinary disagreement?</li>
    <li>Did we hear from the community we said we'd hear from — and can we show it?</li>
  </ul>
</div>

<p style="margin-top:11px">Today that work is done by a person reading comments and writing a memo.
It's slow, it doesn't scale to a comment flood, and two analysts will reach two different conclusions
from the same set of comments. <b>That gap — not collection — is where we're useful.</b></p>

<h2>Where we fit with PublicCoordinate</h2>
<p>The fit is clean because we don't overlap with you. PublicCoordinate owns the front door: the
public-facing experience, the collection tools, the client relationship, and the engineering judgment
behind all of it. We'd sit behind it, quietly — nothing we do changes or competes with any of that.</p>

<div class="split keep">
  <div class="you">
    <h4>PublicCoordinate does</h4>
    <p>Collects. Owns the public-facing experience and the record that the process was run properly.</p>
  </div>
  <div class="us">
    <h4>We do</h4>
    <p>Interprets. Takes what you collected and returns a defensible read on what it means — plus the
    client-ready report that normally costs a staffer two weeks.</p>
  </div>
</div>

<p style="margin-top:12px">Nothing about this asks you to change how you collect, or to move anything
off a platform that's already working. It starts from an export of what you already have.</p>

<div class="pb"></div>

<!-- ============================ PAGE 2 ============================ -->
<p class="eyebrow">Where we add value &nbsp;·&nbsp; Prepared for Kimley-Horn &nbsp;·&nbsp; Page 2</p>
<h1 style="font-size:19px">Three places the category doesn't go</h1>
<div class="rule"></div>
<p class="sub" style="margin-bottom:14px">These aren't features on a longer list — they're whole
categories of input that today's platforms structurally can't touch, because they were built to
collect through a form.</p>

<div class="grid3 keep">
  <div class="card">
    <span class="num">01</span>
    <h3>What was said in the room</h3>
    <p>None of these platforms do anything with an in-person meeting beyond scheduling it and logging that
    it happened. We turn the recording into a complete, attributed account: every question asked, the answer
    actually given, the commitments made, and who owns them — as a finished report. On most projects that's
    a staffed line item today. And we can do it <b>while the meeting is still running</b> — below.</p>
  </div>
  <div class="card">
    <span class="num">02</span>
    <h3>Feedback that asks back</h3>
    <p>Our intake tools ask follow-up questions. When a response is thin, vague, or points somewhere
    interesting, the conversation probes — in any of 16 languages. Static forms capture the answer people
    give first; this captures the one they'd give on the second question. In a national restaurant
    deployment, the conversational approach drew <b>3.5× the response rate</b> of the client's traditional survey.</p>
  </div>
  <div class="card">
    <span class="num">03</span>
    <h3>Comment floods</h3>
    <p>Regulatory- and NEPA-scale volume, including organized form-letter campaigns. We've built and run
    this against a live U.S. Forest Service comment docket end to end — separating genuine individual input
    from campaign volume, and surfacing the substantive issues without a team of readers.</p>
  </div>
</div>

<h2 style="margin-top:22px">While the meeting is still happening</h2>
<p>You mentioned Mentimeter, and it's the thread worth dwelling on — because it points at something none
of the platforms in this category do.</p>

<h2>What Mentimeter gets right, and where it stops</h2>
<p>Mentimeter is genuinely good at what it does: put a question on screen, get an instant read from the
room, show people their own answer in real time. It's the closest thing in the set to a live in-room tool,
and the participation it produces is real.</p>
<p>Where it stops is the same place everything else stops. It shows you the <b>tally</b>. It doesn't tell
you what the open-ended answers mean, it can't tell a passing remark from a theme forming across the room,
and when the meeting ends the insight ends with it.</p>

<h2>A second set of eyes on the room</h2>
<p>We run a live facilitator view during the session — on a laptop at the staff table, not on the screen at
the front. It tracks which topics have actually been covered versus which are still untouched, how sentiment
is moving as the conversation goes, and — the part people find most useful — <b>which phrases are gaining
traction in the last few minutes</b> compared with the rest of the meeting. A theme surfacing in the room
becomes visible while there's still time to do something about it.</p>

<div class="qbox keep">
  <ul>
    <li>The one avid cyclist in a room of two hundred raises something nobody planned an agenda item for —
    and you see it registering across other people <b>while you're still at the podium</b>, instead of
    finding it in a transcript three weeks later.</li>
    <li>You can see what the quiet part of the room is actually responding to — the hundred and eighty
    people who will never walk to a microphone, but who are answering.</li>
    <li>Housekeeping that matters: elected officials present who should be recognized before they leave.</li>
  </ul>
</div>

<p style="margin-top:12px">A good facilitator already reads a room, and the best of them are very hard to
improve on. This isn't a replacement for that instinct — it's a second set of eyes on the people who
aren't talking, and a record that survives the meeting. When the room empties, the session doesn't
evaporate: it's already the beginning of the report.</p>

<div class="pb"></div>

<!-- ============================ PAGE 3 ============================ -->
<p class="eyebrow">Where we add value &nbsp;·&nbsp; Prepared for Kimley-Horn &nbsp;·&nbsp; Page 3</p>
<h1 style="font-size:19px">What you'd actually get</h1>
<div class="rule"></div>
<p class="sub" style="margin-bottom:14px">For a given project, from an export of what you already collected
— or from a meeting we sat in on.</p>

<div class="deliv keep">
  <ul>
    <li>A ranked read on <b>what the public is actually concerned about</b> — with the drivers separated from the background noise</li>
    <li>Where those concerns differ between groups, and <b>whether that difference is real</b> or a small-sample artifact</li>
    <li>The specific places, facilities, and programs people named — counted, not anecdotal</li>
    <li>Themes nobody thought to ask about, surfaced from the comments themselves</li>
    <li>A defensible participation record: <b>who you heard from, and who you didn't</b></li>
    <li>The whole thing as a client-ready report — presentation, PDF, or interactive — that a project team can put straight in front of a client or into the record</li>
  </ul>
</div>

<h2>Why us</h2>
<p>We're a <b>consumer insights company with a deep research base</b> — not a software vendor bolting AI
onto public engagement. The analysis engine was built for commercial clients who challenge every number
in the room, then brought to civic work. That research DNA is why the output holds up when someone
disagrees with it: every finding traces back to the comments underneath it, and the method is consistent
enough that two projects can be compared to each other.</p>

<div class="cta keep">
  <h3>Two ways to start — pick whichever suits you</h3>
  <p><b style="color:#fff">The quiet one.</b> Send us a closed project's comment corpus — ideally one where
  you already know how it turned out — and we'll analyze it and show you the output next to what the platform
  produced. Nothing to coordinate, nobody else needs to be involved, and you can judge it against an answer
  you already know.</p>
  <p><b style="color:#fff">The interesting one.</b> Put us in the back of the room at an upcoming public
  meeting. You'd see the live view during the session and have the finished report shortly after it ends —
  which is the part that's genuinely hard to picture from a document like this.</p>
  <p class="ask">Either way the lift on your side is small: <b>a comment export</b>, or <b>a meeting date</b>,
  and a sentence on what the project team is trying to decide.</p>
</div>

<p class="sig"><b>Datanautix</b> &nbsp;·&nbsp; datanautix.com &nbsp;·&nbsp; Prepared for Eliza, Kimley-Horn — July 2026</p>

</body></html>`

async function main() {
  const chrome = brandedPdfChrome({
    brand: 'Kimley-Horn · Datanautix',
    confidentiality: 'Confidential — prepared for Kimley-Horn',
  })
  const pdf = await htmlToPdfBuffer(html, { format: 'letter', ...chrome })
  const out = join(homedir(), 'Downloads', 'Datanautix_PublicEngagement_KimleyHorn.pdf')
  writeFileSync(out, pdf)
  console.log('Wrote', out, pdf.length, 'bytes')
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
