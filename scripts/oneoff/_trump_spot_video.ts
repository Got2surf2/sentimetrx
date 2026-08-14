/**
 * 30-second video spots from the corpus findings.
 *
 *   node --conditions=react-server --import tsx scripts/oneoff/_trump_spot_video.ts --spot silence
 *   node --conditions=react-server --import tsx scripts/oneoff/_trump_spot_video.ts --spot measles
 *   ... --spot all
 *
 * Renders 1920x1080 @ 25fps through headless Chrome, synthesises the score, and
 * muxes with ffmpeg. Outputs to ~/Downloads.
 *
 * ── PORTRAIT (owner asked for a faded Trump in the background) ───────────────
 * I did NOT source a photograph. There is no image generation here, and picking
 * a press photo for a distributed political ad is a licensing decision that is
 * not mine to guess at. Instead the spots NAME HIM IN TEXT so "he" is never
 * ambiguous, and this slot is ready for a file you have cleared:
 *
 *     drop a file at  ~/Downloads/trump-portrait.jpg  (or .png)  and re-run
 *
 * It renders as a desaturated, heavily-faded right-hand layer. Official White
 * House photographs are works of the US government and are public domain, which
 * is the usual clean source — but confirm the specific image before using it.
 *
 * ── SCORE ────────────────────────────────────────────────────────────────────
 * The first version was INAUDIBLE and this is why: it was built on 55Hz and
 * 82.5Hz tones. Laptop and phone speakers reproduce almost nothing below about
 * 150-200Hz, so on the devices anyone would actually watch this on, it was
 * silence. The score is now synthesised in an audible register (110-880Hz) as a
 * slow minor-key progression — Am, F, Dm, E — with detuned pairs that beat
 * against each other for unease, and a sparse descending bell figure. Sad and
 * disconcerting rather than dramatic.
 *
 * I still cannot HEAR it. What I can do, and do below, is MEASURE it: the build
 * prints ffmpeg volumedetect output, so an inaudible or clipping mix is caught
 * as a number even though the aesthetics are not. Listen before using it.
 *
 * Every figure spoken on screen is script-verified; CDC and market numbers are
 * captioned as external on screen because they are not ours.
 *
 * BRANDING: these two spots close on BRAND POSITIONING DOCTORS, not Datanautix
 * (owner, 2026-08-14). The scoping is deliberate — the PDFs and the PolitiFact
 * outreach still carry Datanautix. Do not "harmonise" them.
 */

import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const DL = path.join(homedir(), 'Downloads')
const FPS = 25, SECS = 30, TOTAL = FPS * SECS, W = 1920, H = 1080
const ORANGE = '#E85A1A'

const args = process.argv.slice(2)
const which = (args[args.indexOf('--spot') + 1] ?? 'all').toLowerCase()

// ── Portrait, only if the owner has supplied one ────────────────────────────
function portraitDataUri(): string | null {
  for (const ext of ['jpg', 'jpeg', 'png']) {
    const p = path.join(DL, `trump-portrait.${ext}`)
    if (existsSync(p)) {
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
      return `data:${mime};base64,${readFileSync(p).toString('base64')}`
    }
  }
  return null
}

// ── Score ───────────────────────────────────────────────────────────────────
/**
 * 16-bit stereo PCM, written by hand. Kept in 110-880Hz deliberately: the
 * previous sub-100Hz bed was inaudible on the speakers this will be watched on.
 */
function writeScore(file: string) {
  const SR = 44100, N = SR * SECS
  const L = new Float64Array(N), R = new Float64Array(N)

  // i - VI - iv - V in A minor. Sad, and the V at the end leaves it unresolved.
  const CHORDS: [number, number[]][] = [
    [0.0, [220.0, 261.63, 329.63]],  // Am
    [7.5, [174.61, 220.0, 261.63]],  // F
    [15.0, [146.83, 174.61, 220.0]], // Dm
    [22.5, [164.81, 207.65, 246.94]],// E
  ]
  const env = (t: number, a: number, b: number) => {
    if (t < a || t > b) return 0
    const inn = Math.min(1, (t - a) / 1.6), out = Math.min(1, (b - t) / 2.2)
    return Math.min(inn, out)
  }
  for (let i = 0; i < N; i++) {
    const t = i / SR
    let l = 0, r = 0
    for (const [start, notes] of CHORDS) {
      const e = env(t, start, start + 8.6)
      if (!e) continue
      notes.forEach((f, k) => {
        // Detuned pair per note — the slow beat between them is the unease.
        const a = Math.sin(2 * Math.PI * f * t)
        const b = Math.sin(2 * Math.PI * (f * 1.0022) * t)
        const v = e * (0.15 - k * 0.028)
        l += v * (a * 0.6 + b * 0.4)
        r += v * (a * 0.4 + b * 0.6)
      })
      // Octave-down body, still above 140Hz so it survives small speakers.
      const sub = Math.sin(2 * Math.PI * (notes[0] / 2) * t) * e * 0.10
      l += sub; r += sub
    }
    // Sparse descending bell figure: A4 G4 F4 E4, one every ~6s, decaying.
    const BELLS: [number, number][] = [[5.5, 440], [11.5, 392], [17.5, 349.23], [23.5, 329.63]]
    for (const [bt, bf] of BELLS) {
      const d = t - bt
      if (d < 0 || d > 4) continue
      const decay = Math.exp(-d * 1.15)
      const tone = Math.sin(2 * Math.PI * bf * t) * 0.5 + Math.sin(2 * Math.PI * bf * 2 * t) * 0.14
      l += tone * decay * 0.17; r += tone * decay * 0.17
    }
    // Slow tremolo across the whole bed — breathing, slightly unsettling.
    const trem = 0.9 + 0.1 * Math.sin(2 * Math.PI * 0.28 * t)
    l *= trem; r *= trem
    const fade = Math.min(1, t / 2.0) * Math.min(1, (SECS - t) / 3.0)
    L[i] = l * fade; R[i] = r * fade
  }
  // Normalise to -3 dBFS so it is unambiguously audible without clipping.
  let peak = 0
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
  const g = peak > 0 ? (0.708 / peak) : 1

  const data = Buffer.alloc(N * 4)
  for (let i = 0; i < N; i++) {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * g * 32767))), i * 4)
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * g * 32767))), i * 4 + 2)
  }
  const hdr = Buffer.alloc(44)
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8)
  hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22)
  hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34)
  hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40)
  writeFileSync(file, Buffer.concat([hdr, data]))
}

// ── Shared page chrome ──────────────────────────────────────────────────────
const BASE_CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${W}px;height:${H}px;background:#0b1220;overflow:hidden;
    font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  #stage{position:relative;width:100%;height:100%}
  #portrait{position:absolute;right:0;top:0;width:52%;height:100%;
    background-size:cover;background-position:center 18%;
    filter:grayscale(1) contrast(.85) brightness(.62);opacity:.20;
    -webkit-mask-image:linear-gradient(to right,transparent 0%,rgba(0,0,0,.75) 45%,rgba(0,0,0,.9) 100%)}
  .scene{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 112px;opacity:0}
  .kicker{font-size:36px;letter-spacing:.2em;text-transform:uppercase;color:#64748b;font-weight:700;margin-bottom:46px}
  .big{font-size:268px;font-weight:800;color:#fff;line-height:.9;letter-spacing:-.045em}
  .big.o{color:${ORANGE}}
  /* Any inline run inside .big MUST reset tracking. em-based negative
     letter-spacing is recomputed at the span's own font-size and eats the word
     spaces - that is what turned "of those 565 days" into "ofthose565days". */
  .big .run{letter-spacing:normal;word-spacing:.12em}
  .cap{font-size:48px;color:#cbd5e1;margin-top:38px;line-height:1.28;font-weight:500;max-width:1580px}
  .vs{font-size:36px;color:#475569;letter-spacing:.2em;text-transform:uppercase;font-weight:700;margin:52px 0 40px}
  .mid{font-size:158px;font-weight:800;color:#fff;line-height:.94;letter-spacing:-.035em}
  .src{font-size:26px;color:#475569;margin-top:30px;letter-spacing:.05em}
  .final{font-size:94px;font-weight:800;color:#fff;line-height:1.14;letter-spacing:-.022em;max-width:1680px}
  .final em{color:${ORANGE};font-style:normal}
  .cta{font-size:78px;font-weight:800;color:#fff;line-height:1.18;letter-spacing:-.022em}
  .cta span{color:${ORANGE}}
  .quote{font-size:80px;font-weight:700;color:#fff;line-height:1.2;letter-spacing:-.02em;max-width:1680px}
  .attrib{font-size:34px;color:#94a3b8;margin-top:52px;font-weight:600}
  .false{font-size:44px;color:${ORANGE};margin-top:44px;font-weight:800;letter-spacing:.02em}
  /* Closing card - the brand wordmark is one word, no separator. */
  .endcard{align-items:flex-start}
  .endcard .by{font-size:40px;color:#94a3b8;font-weight:600;margin-bottom:34px}
  .endcard .wm{font-size:104px;font-weight:800;letter-spacing:-.03em;line-height:1.02}
  .endcard .wm .a{color:#0F7173}.endcard .wm .b{color:${ORANGE}}
  .endcard .tag{font-size:52px;color:#fff;font-weight:700;margin-top:40px}
  .bar{position:absolute;left:0;bottom:0;height:8px;background:${ORANGE}}
`

const SCENE_JS = `
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const ease=t=>1-Math.pow(1-clamp(t,0,1),3);
  function scene(el,t,a,b){
    let o=0,y=24;
    if(t>=a-0.001&&t<=b){
      const inT=ease((t-a)/0.45), outT=1-ease((t-(b-0.35))/0.35);
      o=Math.min(inT, t>b-0.35?Math.max(outT,0):1);
      y=24*(1-inT)-9*ease((t-a)/(b-a));
    }
    el.style.opacity=o; el.style.transform='translateY('+y+'px)';
  }
  function countTo(el,t,a,target,dur){
    el.textContent=Math.round(target*ease(clamp((t-a)/dur,0,1))).toLocaleString();
  }
`

const FINAL_HTML = `
  <div class="scene" id="sf">
    <div class="final">Your Republican elected officials have continued to <em>enable this</em>.<br><br>
      Are they really who you want <em>controlling your future?</em></div>
  </div>
  <div class="scene" id="sc">
    <div class="cta">Go out and <span>vote</span>.<br>Take charge of your own future.</div>
  </div>
  <div class="scene endcard" id="se">
    <div class="by">Brought to you by</div>
    <div class="wm"><span class="a">Brand Positioning</span><br><span class="b">Doctors</span></div>
    <div class="tag">We make facts matter.</div>
  </div>`

// ── Spot 1: the silence gap ─────────────────────────────────────────────────
const spotSilence = (portrait: string | null) => `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body><div id="stage">
  ${portrait ? `<div id="portrait" style="background-image:url('${portrait}')"></div>` : ''}
  <div class="scene" id="s0">
    <div class="big" style="font-size:88px;line-height:1.14">Donald Trump has been<br>President for <span style="color:${ORANGE}">565 days</span>.</div>
    <div class="cap" style="margin-top:30px">Here is what he chose to talk about.</div>
  </div>
  <div class="scene" id="s1">
    <div class="kicker">Donald Trump talked about his ballroom</div>
    <div class="big" id="n1">0</div><div class="mid" style="font-size:96px;color:#94a3b8;margin-top:8px">times</div>
    <div class="vs">He has never said</div>
    <div class="mid" style="color:${ORANGE}" id="w1">&ldquo;preschool&rdquo;</div>
  </div>
  <div class="scene" id="s2">
    <div class="kicker">He called someone a name on</div>
    <div class="big"><span id="n2">0</span> <span class="run" style="font-size:118px;color:#64748b">of those 565 days</span></div>
    <div class="vs">He mentioned child care on</div>
    <div class="mid" style="color:${ORANGE}">7 days</div>
  </div>
  <div class="scene" id="s3">
    <div class="kicker">Measles cases in this country</div>
    <div class="big o" style="color:${ORANGE}">+<span id="n3">0</span>%</div>
    <div class="src">CDC &mdash; 285 cases in 2024, 2,289 in 2025</div>
    <div class="vs">Trump spent his time on</div>
    <div class="mid" style="font-size:104px;white-space:nowrap">his ballroom &mdash; <span style="color:#94a3b8">15.6% of his days</span></div>
  </div>
  ${FINAL_HTML}
  <div class="bar" id="bar"></div>
</div><script>${SCENE_JS}
window.renderAt=function(t){
  scene(document.getElementById('s0'),t,0,2.4);
  scene(document.getElementById('s1'),t,2.4,8.0);
  scene(document.getElementById('s2'),t,8.0,13.2);
  scene(document.getElementById('s3'),t,13.2,18.8);
  scene(document.getElementById('sf'),t,18.8,24.3);
  scene(document.getElementById('sc'),t,24.3,28.3);
  scene(document.getElementById('se'),t,28.3,30);
  countTo(document.getElementById('n1'),t,2.4,209,0.8);
  countTo(document.getElementById('n2'),t,8.0,312,0.8);
  countTo(document.getElementById('n3'),t,13.2,703,0.8);
  const w1=document.getElementById('w1');
  w1.style.opacity = t>5.2 ? ease((t-5.2)/0.5) : 0;
  document.getElementById('bar').style.width=(100*clamp(t/${SECS},0,1))+'%';
};window.renderAt(0);</script></body></html>`

// ── Spot 2: measles against the market, with the chart ──────────────────────
/**
 * THE CHART PLOTS THREE REAL POINTS AND NOTHING ELSE. 2024 is the baseline
 * (indexed 100), then 2025, then 2026-to-date. Both series are published annual
 * figures — inventing monthly values to make a smoother curve would be
 * fabricating data, so the line is drawn straight between the real points and
 * the axis is labelled by year.
 *   measles  285 -> 2,289 -> 2,465   =  100 -> 803 -> 865
 *   S&P 500  +17.9% then +12.7%      =  100 -> 118 -> 133
 */
const spotMeasles = (portrait: string | null) => `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
  .chartwrap{position:absolute;inset:0;padding:78px 112px 74px;display:flex;flex-direction:column;opacity:0}
  .chead{font-size:70px;font-weight:800;color:#fff;line-height:1.1;letter-spacing:-.025em;margin-bottom:10px}
  .chead em{color:${ORANGE};font-style:normal}
  .csub{font-size:28px;color:#64748b;margin-bottom:14px}
  svg{flex:1;width:100%}
  .yrs{display:flex;justify-content:space-between;font-size:30px;color:#64748b;font-weight:600;margin-top:6px}
  .legend{display:flex;gap:76px;align-items:flex-end;margin-top:24px}
  .lg .v{font-size:82px;font-weight:800;line-height:1;letter-spacing:-.03em}
  .lg .k{font-size:28px;color:#94a3b8;font-weight:600;margin-top:8px}
</style></head><body><div id="stage">
  ${portrait ? `<div id="portrait" style="background-image:url('${portrait}')"></div>` : ''}
  <div class="scene" id="m0">
    <div class="big" style="font-size:84px;line-height:1.14">Two things went up<br>under <span style="color:${ORANGE}">Donald Trump</span>.</div>
    <div class="cap" style="margin-top:30px">He only ever mentions one of them.</div>
  </div>

  <div class="chartwrap" id="chart">
    <div class="chead">Measles didn't go up like the market.<br>It went up <em>twenty-three times faster.</em></div>
    <div class="csub">Growth since 2024, indexed to 100 &middot; CDC measles cases &middot; S&amp;P 500 total return &middot; external sources</div>
    <svg viewBox="0 0 1696 560">
      <defs>
        <linearGradient id="fillMea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${ORANGE}" stop-opacity=".55"/>
          <stop offset="100%" stop-color="${ORANGE}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <line x1="118" y1="510" x2="1696" y2="510" stroke="#243147" stroke-width="3"/>
      <line x1="118" y1="356" x2="1696" y2="356" stroke="#151f33" stroke-width="2"/>
      <line x1="118" y1="202" x2="1696" y2="202" stroke="#151f33" stroke-width="2"/>
      <line x1="118" y1="48"  x2="1696" y2="48"  stroke="#151f33" stroke-width="2"/>
      <text x="100" y="519" text-anchor="end" fill="#64748b" font-size="27" font-weight="600">0%</text>
      <text x="100" y="365" text-anchor="end" fill="#64748b" font-size="27" font-weight="600">+300%</text>
      <text x="100" y="211" text-anchor="end" fill="#64748b" font-size="27" font-weight="600">+600%</text>
      <text x="100" y="57"  text-anchor="end" fill="#64748b" font-size="27" font-weight="600">+900%</text>
      <path id="aMea" fill="url(#fillMea)" stroke="none"/>
      <path id="pMkt" fill="none" stroke="#64748b" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
      <path id="pMea" fill="none" stroke="${ORANGE}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
      <circle id="dMkt" r="13" fill="#64748b" opacity="0"/>
      <circle id="dMea" r="18" fill="${ORANGE}" opacity="0"/>
    </svg>
    <div class="yrs"><span style="margin-left:96px">2024</span><span>2025</span><span>2026 to date</span></div>
    <div class="legend">
      <div class="lg"><div class="v" style="color:${ORANGE}" id="mv">+0%</div><div class="k">Measles cases</div></div>
      <div class="lg"><div class="v" style="color:#94a3b8" id="sv">+0%</div><div class="k">Stock market</div></div>
    </div>
  </div>

  <div class="scene" id="m2">
    <div class="kicker">The man they confirmed to run public health</div>
    <div class="quote">&ldquo;There are adverse events from the vaccine.<br><em style="color:${ORANGE};font-style:normal">It does cause deaths every year.</em>&rdquo;</div>
    <div class="attrib">Robert F. Kennedy Jr., Fox News, 11 March 2025</div>
    <div class="false">This is false.</div>
  </div>
  <div class="scene" id="m3">
    <div class="kicker">Americans who died of measles in 2025</div>
    <div class="big o" style="color:${ORANGE}">3</div>
    <div class="mid" style="font-size:88px;margin-top:38px">The first measles deaths<br>in this country in a decade.</div>
    <div class="cap" style="margin-top:24px">All three were unvaccinated.</div>
  </div>
  ${FINAL_HTML}
  <div class="bar" id="bar"></div>
</div><script>${SCENE_JS}
  // Three real points only. X positions are evenly spaced years.
  // Three real points only; x evenly spaced by year. y maps growth-over-2024 to
  // the labelled 0/+300/+600/+900% gridlines, so the axis and the line agree.
  const XS=[150,900,1650], MEA=[100,803,865], MKT=[100,118,133];
  const yOf=v=>510-(Math.min(v-100,900)/900)*462;
  function pathTo(pts,p){
    // p in 0..1 walks the polyline; partial segments interpolate linearly.
    const seg=(pts.length-1)*p, i=Math.min(Math.floor(seg),pts.length-2), f=seg-i;
    let d='M '+XS[0]+' '+yOf(pts[0]);
    for(let k=1;k<=i;k++) d+=' L '+XS[k]+' '+yOf(pts[k]);
    const x=XS[i]+(XS[i+1]-XS[i])*f, y=yOf(pts[i])+(yOf(pts[i+1])-yOf(pts[i]))*f;
    d+=' L '+x+' '+y;
    return {d,x,y};
  }
window.renderAt=function(t){
  scene(document.getElementById('m0'),t,0,2.9);
  const cw=document.getElementById('chart');
  let co=0;
  if(t>=2.9&&t<=12.6){ co=Math.min(ease((t-2.9)/0.5), t>12.2?Math.max(1-ease((t-12.2)/0.4),0):1); }
  cw.style.opacity=co;
  const p=ease(clamp((t-3.6)/4.4,0,1));
  const a=pathTo(MEA,p), b=pathTo(MKT,p);
  document.getElementById('pMea').setAttribute('d',a.d);
  document.getElementById('pMkt').setAttribute('d',b.d);
  // Area under the measles line - the wall of orange is what makes it land.
  document.getElementById('aMea').setAttribute('d', p>0.01 ? a.d+' L '+a.x+' 510 L '+XS[0]+' 510 Z' : '');
  const dm=document.getElementById('dMea'), dk=document.getElementById('dMkt');
  dm.setAttribute('cx',a.x); dm.setAttribute('cy',a.y); dm.setAttribute('opacity',p>0.02?1:0);
  dk.setAttribute('cx',b.x); dk.setAttribute('cy',b.y); dk.setAttribute('opacity',p>0.02?1:0);
  document.getElementById('mv').textContent='+'+Math.round(765*p).toLocaleString()+'%';
  document.getElementById('sv').textContent='+'+Math.round(33*p)+'%';
  scene(document.getElementById('m2'),t,12.6,18.2);
  scene(document.getElementById('m3'),t,18.2,22.4);
  scene(document.getElementById('sf'),t,22.4,26.4);
  scene(document.getElementById('sc'),t,26.4,28.3);
  scene(document.getElementById('se'),t,28.3,30);
  document.getElementById('bar').style.width=(100*clamp(t/${SECS},0,1))+'%';
};window.renderAt(0);</script></body></html>`

async function render(name: string, html: string) {
  const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'].find((p) => existsSync(p))
  if (!chrome) throw new Error('No local Chrome found')
  const TMP = path.join(DL, `.spot-${name}`)
  rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true })
  const htmlPath = path.join(TMP, 'spot.html')
  writeFileSync(htmlPath, html)

  const puppeteer = (await import('puppeteer-core')).default
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] })
  try {
    const p = await browser.newPage()
    await p.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
    await p.goto('file://' + htmlPath, { waitUntil: 'load' })
    for (let f = 0; f < TOTAL; f++) {
      await p.evaluate((t) => (window as unknown as { renderAt: (t: number) => void }).renderAt(t), f / FPS)
      await p.screenshot({ path: path.join(TMP, `f${String(f).padStart(5, '0')}.png`) as `${string}.png` })
      if (f % 100 === 0) process.stdout.write(`\r  ${name}: ${f}/${TOTAL}`)
    }
    process.stdout.write(`\r  ${name}: ${TOTAL}/${TOTAL}\n`)
  } finally { await browser.close() }

  const wav = path.join(TMP, 'score.wav')
  writeScore(wav)
  // MEASURED, not heard. An inaudible or clipping mix shows up here as a number.
  const vd = execFileSync('ffmpeg', ['-hide_banner', '-i', wav, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
  const levels = (vd.match(/(mean_volume|max_volume):.*/g) ?? []).join('  ')
  console.log(`  score levels → ${levels}`)

  const out = path.join(DL, `BrandPositioningDoctors_${name}_30s.mp4`)
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
    '-framerate', String(FPS), '-i', path.join(TMP, 'f%05d.png'), '-i', wav,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], { stdio: 'inherit' })
  rmSync(TMP, { recursive: true, force: true })
  console.log(`  wrote ${out}`)
}

async function main() {
  const portrait = portraitDataUri()
  console.log(portrait ? '  portrait: using ~/Downloads/trump-portrait.*' : '  portrait: none supplied — spots name him in text instead')
  if (which === 'silence' || which === 'all') await render('SilenceGap', spotSilence(portrait))
  if (which === 'measles' || which === 'all') await render('MeaslesVsMarket', spotMeasles(portrait))
}
main().catch((e) => { console.error(e); process.exit(1) })
