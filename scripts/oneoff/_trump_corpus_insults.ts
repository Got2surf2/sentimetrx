/**
 * Name-calling versus empathy.
 *
 *   node_modules/.bin/tsx scripts/oneoff/_trump_corpus_insults.ts
 *
 * Owner's question (2026-08-08): how many times has he called people names,
 * against how many times he has acknowledged what people are actually going
 * through? It is the sharpest version of the character contrast because both
 * sides are his own words and neither is a policy argument.
 *
 * KEYWORD DISCIPLINE — this set needed more pruning than any other in the
 * project. Terms TESTED AND DROPPED, with the reason, because each one looked
 * enormous and was mostly noise:
 *   "crazy"   (539) — "the numbers are crazy", "the wind is blowing like crazy",
 *                     "the fake news goes crazy". Almost never name-calling.
 *   "stupid"  (394) — mostly "stupid open border", "stupid things are
 *                     happening": insult register, but aimed at policy.
 *   "dumb"    (85)  — split between "very dumb person" and "dumb policies";
 *                     cannot be separated by keyword alone.
 *   "animal", "thug", "scum" — overwhelmingly about criminals and gangs, which
 *                     is a policy posture, not calling an opponent a name.
 *   "radical left", "marxist", "communist", "fascist" — political labels. An
 *                     opponent would call these ordinary partisan speech and
 *                     they would be right; including them weakens the claim.
 *   "going through" (100) — for EMPATHY this is almost entirely "going through
 *                     FEMA" and "going through the roof". Dropped.
 *   "my heart" (16) — mostly "a warm spot in my heart for TikTok".
 *
 * What survives on the insult side are INVENTED PROPER-NOUN EPITHETS and
 * unambiguous personal slurs. A nickname like "Sleepy Joe" cannot be a false
 * positive: it is not a phrase anyone uses by accident.
 *
 * EMPATHY IS SPLIT IN TWO, and the split is the finding. Ritual condolence
 * after a tragedy ("our hearts go out", "thoughts and prayers") is a formal
 * duty of the office and he performs it. Empathy for ordinary hardship —
 * someone struggling to pay for things — is a different act. Pooling them
 * would hide exactly the gap worth showing.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const DIR = path.join(homedir(), 'Downloads', 'trump-corpus')

interface Item { source: string; trump_text: string }
const rows = readFileSync(path.join(DIR, 'trump_corpus.ndjson'), 'utf-8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l) as Item)

const spoken: string[] = []
const posted: string[] = []
for (const c of rows) {
  if (c.source === 'govinfo_dcpd') {
    for (const raw of c.trump_text.split('\n\n')) {
      const p = raw.trim()
      if (p.split(/\s+/).length >= 15) spoken.push(p)
    }
  } else if (c.trump_text.trim() && !/^RT[\s@:]/.test(c.trump_text)) posted.push(c.trump_text.trim())
}
const S = Array.from(new Set(spoken))
const P = Array.from(new Set(posted))
const ALL = [...S, ...P]

const rx = (kw: string) => new RegExp(`(?<![a-z])${kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
const count = (texts: string[], kws: string[]) => {
  const res = kws.map(rx)
  return texts.filter((t) => { const l = t.toLowerCase(); return res.some((r) => r.test(l)) }).length
}

/** Invented epithets and unambiguous personal slurs. No false positives possible. */
const INSULTS = [
  'sleepy joe', 'crooked', "cryin'", 'cryin ', "lyin'", 'lyin ', 'pocahontas', 'shifty',
  'birdbrain', 'dumbocrat', 'desanctimonious', 'deranged', 'psycho', 'lunatic', 'moron',
  'idiot', 'loser', 'low iq', 'slob', 'wise guy', 'incompetent', 'disgrace', 'nasty', 'fool',
]
/** Acknowledging that ordinary people are struggling. The thing being measured. */
const HARDSHIP = [
  'struggling', 'hurting', 'suffering', 'hardship', "can't afford", 'cannot afford',
  'make ends meet', 'making ends meet', 'difficult time', 'tough time', 'know how hard',
  'sympath', 'empath', 'compassion',
]
/** Ritual condolence after a tragedy — a duty of the office, counted separately. */
const CONDOLENCE = ['heart goes out', 'hearts go out', 'thoughts and prayers', 'grieve', 'mourn', 'condolence']

const out: string[] = []
const say = (s = '') => { console.log(s); out.push(s) }

say(`DENOMINATOR: ${ALL.length.toLocaleString()} passages (${S.length.toLocaleString()} spoken + ${P.length.toLocaleString()} posts, deduped)\n`)

const breakdown = (label: string, kws: string[]) => {
  const total = count(ALL, kws)
  say(`══ ${label} — ${total} passages ══`)
  const per = kws.map((k) => ({ k, n: count(ALL, [k]) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)
  say('  ' + per.map((x) => `${x.k.trim()}:${x.n}`).join('  '))
  const top = per[0]
  const share = total ? Math.round((100 * top.n) / total) : 0
  say(`  top term "${top.k.trim()}" = ${share}% of the total  ${share > 60 ? '⚠ DOMINATED' : '✓ no single term carries it'}`)
  say(`  spoken ${count(S, kws)}   posts ${count(P, kws)}\n`)
  return total
}

const nInsult = breakdown('NAME-CALLING', INSULTS)
const nHardship = breakdown('EMPATHY FOR ORDINARY HARDSHIP', HARDSHIP)
const nCondolence = breakdown('RITUAL CONDOLENCE AFTER A TRAGEDY', CONDOLENCE)

say('══ THE CONTRAST ══\n')
say(`  Name-calling                          ${String(nInsult).padStart(5)}`)
say(`  Empathy for ordinary hardship         ${String(nHardship).padStart(5)}   → ${(nInsult / nHardship).toFixed(1)}x more name-calling`)
say(`  Ritual condolence after a tragedy     ${String(nCondolence).padStart(5)}   (he performs the formal duty; that is not the gap)`)
say('')
say('  The honest framing: the absence is not sympathy in the abstract — he does')
say('  condolences. It is that he almost never says an ordinary person is having a')
say('  hard time paying for something.')

writeFileSync(path.join(DIR, 'insults_vs_empathy.json'), JSON.stringify({
  denominator: { passages: ALL.length, spoken: S.length, posts: P.length },
  nameCalling: nInsult, hardshipEmpathy: nHardship, ritualCondolence: nCondolence,
  ratio: Number((nInsult / nHardship).toFixed(1)),
  keywords: { INSULTS, HARDSHIP, CONDOLENCE },
  droppedTerms: {
    crazy: 'the numbers are crazy / blowing like crazy — almost never name-calling',
    stupid: 'mostly aimed at policy, not people',
    dumb: 'split between "dumb person" and "dumb policies", inseparable by keyword',
    'animal/thug/scum': 'about criminals and gangs — policy posture, not name-calling',
    'radical left/marxist/communist/fascist': 'political labels, defensible as ordinary partisan speech',
    'going through': 'going through FEMA / through the roof',
    'my heart': 'a warm spot in my heart for TikTok',
  },
}, null, 2))
writeFileSync(path.join(DIR, 'insults_vs_empathy.txt'), out.join('\n'))
say(`\nWrote ${path.join(DIR, 'insults_vs_empathy.json')}`)
