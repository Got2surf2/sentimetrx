/**
 * 30-second video spot from three of the corpus headlines.
 *
 *   node --conditions=react-server --import tsx scripts/oneoff/_trump_spot_video.ts
 *
 * Renders 1920x1080 @ 25fps frames with headless Chrome, then muxes them with
 * ffmpeg. Output: ~/Downloads/Datanautix_SilenceGap_30s.mp4
 *
 * ⚠️ THE MUSIC IS A PLACEHOLDER AND MUST BE REPLACED. It is synthesised by
 * ffmpeg (a low drone plus a slow pulse) purely so the file is not silent.
 * Nobody has licensed music here and none was downloaded. To drop in a real
 * track:
 *     ffmpeg -i Datanautix_SilenceGap_30s.mp4 -i track.mp3 -map 0:v -map 1:a \
 *            -c:v copy -c:a aac -shortest out.mp4
 * I also cannot HEAR the output — the audio is verified only by ffprobe for
 * duration and stream validity. Listen before using it anywhere.
 *
 * THE THREE HEADLINES, all script-verified (see the factoids sheet):
 *   1. "ballroom" 209 vs "preschool" 0
 *   2. name-calling on 415 of 565 days vs child care on 7
 *   3. measles +703% (CDC, external) vs 15.6% of his days on the ballroom
 * The CDC figure is captioned as CDC on screen — it is the only number in the
 * spot we did not count ourselves, and it must never appear unattributed.
 */

import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const OUT = path.join(homedir(), 'Downloads', 'Datanautix_SilenceGap_30s.mp4')
const TMP = path.join(homedir(), 'Downloads', '.spot-frames')
const FPS = 25
const SECS = 30
const TOTAL = FPS * SECS
const W = 1920, H = 1080

const TEAL = '#0F7173', ORANGE = '#E85A1A'

/** Scene boundaries in seconds. */
const SC = { open: [0, 2.4], one: [2.4, 10], two: [10, 17.6], three: [17.6, 25.2], close: [25.2, 30] } as const

const page = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${W}px;height:${H}px;background:#0b1220;overflow:hidden;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;}
  #stage{position:relative;width:100%;height:100%}
  .scene{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;
    padding:0 150px;opacity:0}
  .kicker{font-size:30px;letter-spacing:.22em;text-transform:uppercase;color:#64748b;font-weight:700;margin-bottom:38px}
  .big{font-size:250px;font-weight:800;color:#fff;line-height:.92;letter-spacing:-.045em}
  .big.o{color:${ORANGE}}
  .cap{font-size:44px;color:#cbd5e1;margin-top:22px;line-height:1.3;font-weight:500;max-width:1500px}
  .cap b{color:#fff;font-weight:800}
  .vs{font-size:34px;color:#475569;letter-spacing:.2em;text-transform:uppercase;font-weight:700;margin:40px 0 34px}
  .mid{font-size:150px;font-weight:800;color:#fff;line-height:.95;letter-spacing:-.04em}
  .sub{font-size:38px;color:#94a3b8;margin-top:14px;font-weight:500}
  .src{font-size:24px;color:#475569;margin-top:26px;letter-spacing:.06em}
  .ask{font-size:104px;font-weight:800;color:#fff;line-height:1.1;letter-spacing:-.025em}
  .ask em{color:${ORANGE};font-style:normal}
  .mark{position:absolute;left:150px;bottom:96px;font-size:38px;font-weight:800;letter-spacing:.01em}
  .mark .a{color:${TEAL}}.mark .b{color:${ORANGE}}
  .bar{position:absolute;left:0;bottom:0;height:8px;background:${ORANGE}}
</style></head><body><div id="stage">

  <div class="scene" id="s0">
    <div class="big" style="font-size:96px;line-height:1.12">Since he took office,<br>he has said <span style="color:${ORANGE}">55,418</span> things.</div>
    <div class="cap" style="margin-top:34px">Every word on the public record. Every post in his own words.</div>
  </div>

  <div class="scene" id="s1">
    <div class="kicker">He talked about his ballroom</div>
    <div class="big" id="n1">0</div>
    <div class="vs">He has never said</div>
    <div class="mid o" style="color:${ORANGE}" id="w1">&ldquo;preschool&rdquo;</div>
  </div>

  <div class="scene" id="s2">
    <div class="kicker">He called someone a name on</div>
    <div class="big"><span id="n2">0</span> <span style="font-size:110px;color:#64748b">of his 565 days</span></div>
    <div class="vs">He mentioned child care on</div>
    <div class="mid o" style="color:${ORANGE}">7 days</div>
  </div>

  <div class="scene" id="s3">
    <div class="kicker">Measles cases in this country</div>
    <div class="big o" style="color:${ORANGE}">+<span id="n3">0</span>%</div>
    <div class="src">CDC &mdash; 285 cases in 2024, 2,289 in 2025</div>
    <div class="vs">He spent his time on</div>
    <!-- One line only. At 150px this wrapped and the second line ran into the
         datanautix mark at the bottom-left. -->
    <div class="mid" style="font-size:112px;white-space:nowrap">his ballroom &mdash; <span style="color:#94a3b8">15.6% of his days</span></div>
  </div>

  <div class="scene" id="s4">
    <div class="ask">Is this what<br>you <em>voted for?</em></div>
    <div class="cap" style="margin-top:40px">And every Republican in Congress watched him do it.</div>
  </div>

  <div class="mark" id="mark"><span class="a">data</span><span class="b">nautix</span></div>
  <div class="bar" id="bar"></div>
</div>
<script>
  const SC = ${JSON.stringify(SC)};
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const ease=t=>1-Math.pow(1-clamp(t,0,1),3);
  // Each scene fades in over 0.45s, holds, fades out over 0.35s, and drifts up
  // slightly — enough motion to feel alive without pulling focus off the number.
  function scene(el,t,[a,b]){
    let o=0,y=26;
    if(t>=a-0.001&&t<=b){
      const inT=ease((t-a)/0.45), outT=1-ease((t-(b-0.35))/0.35);
      o=Math.min(inT, t>b-0.35?Math.max(outT,0):1);
      y=26*(1-inT)-10*ease((t-a)/(b-a))
    }
    el.style.opacity=o; el.style.transform='translateY('+y+'px)';
  }
  function countTo(el,t,[a,b],target,dur){
    const p=ease(clamp((t-a)/dur,0,1));
    el.textContent=Math.round(target*p).toLocaleString();
  }
  window.renderAt=function(t){
    scene(document.getElementById('s0'),t,SC.open);
    scene(document.getElementById('s1'),t,SC.one);
    scene(document.getElementById('s2'),t,SC.two);
    scene(document.getElementById('s3'),t,SC.three);
    scene(document.getElementById('s4'),t,SC.close);
    countTo(document.getElementById('n1'),t,SC.one,209,2.2);
    countTo(document.getElementById('n2'),t,SC.two,415,2.2);
    countTo(document.getElementById('n3'),t,SC.three,703,2.2);
    // The quoted word lands after the count settles, so the eye reads the
    // number first and the zero second.
    const w1=document.getElementById('w1');
    w1.style.opacity = t>SC.one[0]+3.1 ? ease((t-SC.one[0]-3.1)/0.5) : 0;
    document.getElementById('bar').style.width=(100*clamp(t/${SECS},0,1))+'%';
    document.getElementById('mark').style.opacity = t>1 ? 0.9 : 0;
  };
  window.renderAt(0);
</script></body></html>`

async function main() {
  const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'].find((p) => existsSync(p))
  if (!chrome) throw new Error('No local Chrome found')

  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
  const htmlPath = path.join(TMP, 'spot.html')
  writeFileSync(htmlPath, page)

  const puppeteer = (await import('puppeteer-core')).default
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] })
  try {
    const p = await browser.newPage()
    await p.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
    await p.goto('file://' + htmlPath, { waitUntil: 'load' })
    for (let f = 0; f < TOTAL; f++) {
      await p.evaluate((t) => (window as unknown as { renderAt: (t: number) => void }).renderAt(t), f / FPS)
      await p.screenshot({ path: path.join(TMP, `f${String(f).padStart(5, '0')}.png`) as `${string}.png` })
      if (f % 50 === 0) process.stdout.write(`\r  frames ${f}/${TOTAL}`)
    }
    process.stdout.write(`\r  frames ${TOTAL}/${TOTAL}\n`)
  } finally { await browser.close() }

  // PLACEHOLDER BED — synthesised, not licensed music. A low two-note drone with
  // a slow pulse; deliberately restrained so it reads as a bed and not a tune.
  const audio = path.join(TMP, 'bed.wav')
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `sine=frequency=55:duration=${SECS}`,
    '-f', 'lavfi', '-i', `sine=frequency=82.5:duration=${SECS}`,
    '-f', 'lavfi', '-i', `sine=frequency=110:duration=${SECS}`,
    '-filter_complex',
    '[0:a]volume=0.30[a0];[1:a]volume=0.16[a1];' +
    `[2:a]volume=0.10,tremolo=f=0.5:d=0.7[a2];` +
    '[a0][a1][a2]amix=inputs=3:normalize=0,' +
    `afade=t=in:st=0:d=1.5,afade=t=out:st=${SECS - 2.5}:d=2.5,` +
    'highpass=f=40,alimiter=limit=0.7[out]',
    '-map', '[out]', '-ac', '2', '-ar', '48000', audio], { stdio: 'inherit' })

  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
    '-framerate', String(FPS), '-i', path.join(TMP, 'f%05d.png'),
    '-i', audio,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium',
    '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', OUT], { stdio: 'inherit' })

  rmSync(TMP, { recursive: true, force: true })
  console.log(`\nWrote ${OUT}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
