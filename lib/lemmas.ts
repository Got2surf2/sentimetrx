// lib/lemmas.ts
// Lightweight irregular-form lemma lookup for theme keyword matching.
// Maps inflected forms → base lemma so "ran" matches keyword "run", etc.
// Only covers irregulars — regular suffixes (waiting→wait) are handled by the stem-prefix regex.

const RAW: Record<string, string[]> = {
  // ── be ──
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'],
  // ── have ──
  have: ['has', 'had', 'having'],
  // ── do ──
  do: ['does', 'did', 'done', 'doing'],
  // ── go ──
  go: ['goes', 'went', 'gone', 'going'],
  // ── say ──
  say: ['says', 'said'],
  // ── get ──
  get: ['gets', 'got', 'gotten', 'getting'],
  // ── make ──
  make: ['makes', 'made', 'making'],
  // ── know ──
  know: ['knows', 'knew', 'known'],
  // ── think ──
  think: ['thinks', 'thought'],
  // ── take ──
  take: ['takes', 'took', 'taken', 'taking'],
  // ── see ──
  see: ['sees', 'saw', 'seen', 'seeing'],
  // ── come ──
  come: ['comes', 'came', 'coming'],
  // ── give ──
  give: ['gives', 'gave', 'given', 'giving'],
  // ── find ──
  find: ['finds', 'found'],
  // ── tell ──
  tell: ['tells', 'told'],
  // ── feel ──
  feel: ['feels', 'felt'],
  // ── leave ──
  leave: ['leaves', 'left', 'leaving'],
  // ── bring ──
  bring: ['brings', 'brought'],
  // ── keep ──
  keep: ['keeps', 'kept'],
  // ── begin ──
  begin: ['begins', 'began', 'begun', 'beginning'],
  // ── run ──
  run: ['runs', 'ran', 'running', 'runner', 'runners'],
  // ── write ──
  write: ['writes', 'wrote', 'written', 'writing'],
  // ── speak ──
  speak: ['speaks', 'spoke', 'spoken', 'speaking'],
  // ── eat ──
  eat: ['eats', 'ate', 'eaten', 'eating'],
  // ── drink ──
  drink: ['drinks', 'drank', 'drunk', 'drinking'],
  // ── drive ──
  drive: ['drives', 'drove', 'driven', 'driving'],
  // ── break ──
  break: ['breaks', 'broke', 'broken', 'breaking'],
  // ── fall ──
  fall: ['falls', 'fell', 'fallen', 'falling'],
  // ── grow ──
  grow: ['grows', 'grew', 'grown', 'growing'],
  // ── hold ──
  hold: ['holds', 'held', 'holding'],
  // ── stand ──
  stand: ['stands', 'stood', 'standing'],
  // ── understand ──
  understand: ['understands', 'understood'],
  // ── lose ──
  lose: ['loses', 'lost', 'losing'],
  // ── pay ──
  pay: ['pays', 'paid', 'paying'],
  // ── meet ──
  meet: ['meets', 'met', 'meeting'],
  // ── buy ──
  buy: ['buys', 'bought', 'buying'],
  // ── send ──
  send: ['sends', 'sent', 'sending'],
  // ── build ──
  build: ['builds', 'built', 'building'],
  // ── spend ──
  spend: ['spends', 'spent', 'spending'],
  // ── hear ──
  hear: ['hears', 'heard', 'hearing'],
  // ── choose ──
  choose: ['chooses', 'chose', 'chosen', 'choosing'],
  // ── lead ──
  lead: ['leads', 'led', 'leading'],
  // ── catch ──
  catch: ['catches', 'caught', 'catching'],
  // ── teach ──
  teach: ['teaches', 'taught', 'teaching'],
  // ── sell ──
  sell: ['sells', 'sold', 'selling'],
  // ── sit ──
  sit: ['sits', 'sat', 'sitting'],
  // ── put ──
  put: ['puts', 'putting'],
  // ── read ──
  read: ['reads', 'reading'],
  // ── show ──
  show: ['shows', 'showed', 'shown', 'showing'],
  // ── try ──
  try: ['tries', 'tried', 'trying'],
  // ── sleep ──
  sleep: ['sleeps', 'slept', 'sleeping'],
  // ── hide ──
  hide: ['hides', 'hid', 'hidden', 'hiding'],
  // ── win ──
  win: ['wins', 'won', 'winning'],
  // ── draw ──
  draw: ['draws', 'drew', 'drawn', 'drawing'],
  // ── fly ──
  fly: ['flies', 'flew', 'flown', 'flying'],
  // ── rise ──
  rise: ['rises', 'rose', 'risen', 'rising'],
  // ── swim ──
  swim: ['swims', 'swam', 'swum', 'swimming'],
  // ── throw ──
  throw: ['throws', 'threw', 'thrown', 'throwing'],
  // ── wear ──
  wear: ['wears', 'wore', 'worn', 'wearing'],
  // ── sing ──
  sing: ['sings', 'sang', 'sung', 'singing'],
  // ── set ──
  set: ['sets', 'setting'],
  // ── cut ──
  cut: ['cuts', 'cutting'],
  // ── shut ──
  shut: ['shuts', 'shutting'],
  // ── fight ──
  fight: ['fights', 'fought', 'fighting'],
  // ── forget ──
  forget: ['forgets', 'forgot', 'forgotten', 'forgetting'],
  // ── lie (recline) ──
  lie: ['lies', 'lay', 'lain', 'lying'],
  // ── hurt ──
  hurt: ['hurts', 'hurting'],

  // ── Irregular adjectives / adverbs ──
  good: ['better', 'best'],
  bad: ['worse', 'worst'],
  far: ['farther', 'farthest', 'further', 'furthest'],
  much: ['more', 'most'],
  little: ['less', 'least'],
  old: ['older', 'oldest', 'elder', 'eldest'],

  // ── Irregular nouns (plural) ──
  person: ['people', 'persons'],
  child: ['children'],
  man: ['men'],
  woman: ['women'],
  foot: ['feet'],
  tooth: ['teeth'],
  mouse: ['mice'],
  goose: ['geese'],
  ox: ['oxen'],
  knife: ['knives'],
  wife: ['wives'],
  life: ['lives'],
  leaf: ['leaves'],
  shelf: ['shelves'],
  half: ['halves'],
  self: ['selves'],

  // ── CX / survey domain irregulars ──
  staff: ['staffed', 'staffing'],
  price: ['priced', 'pricing', 'prices'],
  service: ['serviced', 'servicing', 'services'],
  clean: ['cleaned', 'cleaning', 'cleaner', 'cleanest', 'cleanliness'],
  friendly: ['friendlier', 'friendliest', 'friendliness'],
  fast: ['faster', 'fastest'],
  slow: ['slower', 'slowest'],
  rude: ['ruder', 'rudest', 'rudeness'],
  quick: ['quicker', 'quickest'],
  long: ['longer', 'longest'],
}

// Build the reverse map: inflected → base lemma
// Uses Object.keys + index loops to avoid downlevelIteration issues in client bundles
const LEMMA_MAP: Record<string, string> = {}
const _bases = Object.keys(RAW)
for (let _bi = 0; _bi < _bases.length; _bi++) {
  const base = _bases[_bi]
  const forms = RAW[base]
  LEMMA_MAP[base] = base
  for (let _fi = 0; _fi < forms.length; _fi++) {
    LEMMA_MAP[forms[_fi]] = base
  }
}

/**
 * Returns the base lemma for a word, or the word itself if not irregular.
 * Always lowercase.
 *   lemmatize("ran") → "run"
 *   lemmatize("better") → "good"
 *   lemmatize("waiting") → "waiting" (not irregular — handled by stem regex)
 */
export function lemmatize(word: string): string {
  const w = word.toLowerCase().trim()
  return LEMMA_MAP[w] || w
}

/**
 * Given a keyword, returns all inflected forms that share the same lemma.
 * Used to expand a single keyword into a set of forms for matching.
 *   expandLemma("run") → ["run", "runs", "ran", "running", "runner", "runners"]
 *   expandLemma("good") → ["good", "better", "best"]
 *   expandLemma("wait") → ["wait"] (regular — stem regex handles suffixes)
 */
export function expandLemma(keyword: string): string[] {
  const kw = keyword.toLowerCase().trim()
  // First find the base lemma
  const base = LEMMA_MAP[kw] || kw
  // Then collect all forms that map to the same base
  const forms: string[] = [base]
  // Look up from the original RAW table (avoids Map iteration issues)
  const rawForms = RAW[base]
  if (rawForms) {
    for (let i = 0; i < rawForms.length; i++) {
      if (rawForms[i] !== base) forms.push(rawForms[i])
    }
  }
  return forms
}

export default LEMMA_MAP

