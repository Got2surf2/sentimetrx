// lib/taxonomyKeywords.ts
//
// Deterministic keyword dictionary — the "Tier 1" classifier. Replicates
// the basket-of-words approach the prospect's current CX-tagging vendor
// uses, but scoped to our 7-axis taxonomy instead of their flat-label
// scheme. Zero cost, instant, fully auditable, no LLM in the loop.
//
// What this CAN'T do (by design — these are Tier 2 / LLM strengths):
//   - mixed polarity in one sentence ("food was great but service slow")
//   - severity judgment ("hair in food" → crisis vs "hair on the floor" → normal)
//   - novel phrasings ("burnt gravy with lobster added" → flavor:neg)
//   - sarcasm, hyperbole ("I'd rather eat at Burger King" — not a real BK ref)
//   - evidence quoting (it can return the matched span, but won't paraphrase)
//
// What this DOES catch:
//   - explicit category words ("ribeye" → product:steak, "sommelier" → touchpoint)
//   - explicit sentiment words ("delicious", "rude", "filthy")
//   - basic negation flip ("not great" → flip pos→neg if 'not' within 3 tokens)
//
// Per-phrase polarity is the default — sentiment of that exact phrase.
// Category nouns ("steak", "wine") default to neu; the LLM tier picks
// up polarity from context.

import type { Axis, Polarity, Severity } from './taxonomyVocabulary'

export interface KeywordPhrase {
  /** Exact (case-insensitive) phrase to match in review text. */
  phrase: string
  /** Default polarity when this phrase is seen alone. */
  polarity: Polarity
  /** Default severity. Almost always 'normal' — alert/crisis is a Tier 2 call. */
  severity?: Severity
}

export interface KeywordEntry {
  axis: Axis
  sub: string
  /** Optional product item (specific dish, e.g. 'ribeye'). */
  item?: string
  phrases: KeywordPhrase[]
}

// ── TOUCHPOINT — who served the customer ────────────────────────────────────
// Pure category words: polarity neutral, context fills in pos/neg.

const TOUCHPOINT: KeywordEntry[] = [
  { axis: 'touchpoint', sub: 'server',     phrases: [
    { phrase: 'server',    polarity: 'neu' },
    { phrase: 'waiter',    polarity: 'neu' },
    { phrase: 'waitress',  polarity: 'neu' },
    { phrase: 'our server',polarity: 'neu' },
  ]},
  { axis: 'touchpoint', sub: 'manager',    phrases: [
    { phrase: 'manager',         polarity: 'neu' },
    { phrase: 'general manager', polarity: 'neu' },
    { phrase: 'gm',              polarity: 'neu' },
  ]},
  { axis: 'touchpoint', sub: 'host',       phrases: [
    { phrase: 'host',     polarity: 'neu' },
    { phrase: 'hostess',  polarity: 'neu' },
    { phrase: 'greeted',  polarity: 'neu' },
    { phrase: 'seated us',polarity: 'neu' },
  ]},
  { axis: 'touchpoint', sub: 'bartender',  phrases: [
    { phrase: 'bartender', polarity: 'neu' },
    { phrase: 'at the bar',polarity: 'neu' },
  ]},
  { axis: 'touchpoint', sub: 'busser',     phrases: [
    { phrase: 'busser',     polarity: 'neu' },
    { phrase: 'bus boy',    polarity: 'neu' },
    { phrase: 'bussed',     polarity: 'neu' },
  ]},
  { axis: 'touchpoint', sub: 'chef',       phrases: [
    { phrase: 'chef',          polarity: 'neu' },
    { phrase: 'kitchen',       polarity: 'neu' },
    { phrase: 'executive chef',polarity: 'neu' },
  ]},
  { axis: 'touchpoint', sub: 'sommelier',  phrases: [
    { phrase: 'sommelier',    polarity: 'neu' },
    { phrase: 'wine steward', polarity: 'neu' },
  ]},
  { axis: 'touchpoint', sub: 'cashier',    phrases: [
    { phrase: 'cashier', polarity: 'neu' },
  ]},
]

// ── ATTRIBUTE — how they / it did ───────────────────────────────────────────
// Mostly explicit sentiment phrases.

const ATTRIBUTE: KeywordEntry[] = [
  { axis: 'attribute', sub: 'flavor',     phrases: [
    { phrase: 'delicious',     polarity: 'pos' },
    { phrase: 'tasty',         polarity: 'pos' },
    { phrase: 'flavorful',     polarity: 'pos' },
    { phrase: 'great food',    polarity: 'pos' },
    { phrase: 'good food',     polarity: 'pos' },
    { phrase: 'tasted great',  polarity: 'pos' },
    { phrase: 'amazing food',  polarity: 'pos' },
    { phrase: 'bland',         polarity: 'neg' },
    { phrase: 'flavorless',    polarity: 'neg' },
    { phrase: 'tasted bad',    polarity: 'neg' },
    { phrase: 'horrible',      polarity: 'neg' },
    { phrase: 'inedible',      polarity: 'neg' },
    { phrase: 'too salty',     polarity: 'neg' },
    { phrase: 'overcooked',    polarity: 'neg' },
    { phrase: 'undercooked',   polarity: 'neg' },
    { phrase: 'burnt',         polarity: 'neg' },
    { phrase: 'frozen food',   polarity: 'neg' },
  ]},
  { axis: 'attribute', sub: 'speed',      phrases: [
    { phrase: 'slow service',  polarity: 'neg' },
    { phrase: 'took forever',  polarity: 'neg' },
    { phrase: 'long wait',     polarity: 'neg' },
    { phrase: 'waited forever',polarity: 'neg' },
    { phrase: 'seated late',   polarity: 'neg' },
    { phrase: 'quick service', polarity: 'pos' },
    { phrase: 'fast service',  polarity: 'pos' },
    { phrase: 'prompt',        polarity: 'pos' },
    { phrase: 'minutes later', polarity: 'neg' },  // typical complaint phrasing
  ]},
  { axis: 'attribute', sub: 'attentive',  phrases: [
    { phrase: 'attentive',           polarity: 'pos' },
    { phrase: 'checked on us',       polarity: 'pos' },
    { phrase: 'never came back',     polarity: 'neg' },
    { phrase: 'had to flag',         polarity: 'neg' },
    { phrase: 'ignored',             polarity: 'neg' },
    { phrase: 'inattentive',         polarity: 'neg' },
    { phrase: 'worst service',       polarity: 'neg' },
  ]},
  { axis: 'attribute', sub: 'clean',      phrases: [
    { phrase: 'spotless',        polarity: 'pos' },
    { phrase: 'immaculate',      polarity: 'pos' },
    { phrase: 'dirty',           polarity: 'neg' },
    { phrase: 'filthy',          polarity: 'neg' },
    { phrase: 'sticky',          polarity: 'neg' },
    { phrase: 'unclean',         polarity: 'neg' },
  ]},
  { axis: 'attribute', sub: 'knowledge',  phrases: [
    { phrase: 'knowledgeable',  polarity: 'pos' },
    { phrase: 'knew the menu',  polarity: 'pos' },
    { phrase: 'clueless',       polarity: 'neg' },
    { phrase: "didn't know",    polarity: 'neg' },
  ]},
  { axis: 'attribute', sub: 'accuracy',   phrases: [
    { phrase: 'wrong order',    polarity: 'neg' },
    { phrase: 'mixed up',       polarity: 'neg' },
    { phrase: 'forgot',         polarity: 'neg' },
    { phrase: 'order was right',polarity: 'pos' },
  ]},
  { axis: 'attribute', sub: 'pace',       phrases: [
    { phrase: 'rushed',          polarity: 'neg' },
    { phrase: 'felt rushed',     polarity: 'neg' },
    { phrase: 'great pace',      polarity: 'pos' },
    { phrase: 'unhurried',       polarity: 'pos' },
  ]},
  { axis: 'attribute', sub: 'temp',       phrases: [
    { phrase: 'cold food',      polarity: 'neg' },
    { phrase: 'lukewarm',       polarity: 'neg' },
    { phrase: 'piping hot',     polarity: 'pos' },
    { phrase: 'served cold',    polarity: 'neg' },
  ]},
  { axis: 'attribute', sub: 'portion',    phrases: [
    { phrase: 'small portion',   polarity: 'neg' },
    { phrase: 'tiny portion',    polarity: 'neg' },
    { phrase: 'huge portion',    polarity: 'pos' },
    { phrase: 'generous portion',polarity: 'pos' },
  ]},
  { axis: 'attribute', sub: 'presentation', phrases: [
    { phrase: 'beautifully plated',polarity: 'pos' },
    { phrase: 'sloppy',            polarity: 'neg' },
    { phrase: 'presentation',      polarity: 'neu' },
  ]},
  { axis: 'attribute', sub: 'professional', phrases: [
    { phrase: 'professional',        polarity: 'pos' },
    { phrase: 'unprofessional',      polarity: 'neg' },
    { phrase: 'excellent service',   polarity: 'pos' },
  ]},
  { axis: 'attribute', sub: 'friendly',   phrases: [
    { phrase: 'friendly',         polarity: 'pos' },
    { phrase: 'kind',             polarity: 'pos' },
    { phrase: 'welcoming',        polarity: 'pos' },
    { phrase: 'warm',             polarity: 'pos' },
    { phrase: 'unfriendly',       polarity: 'neg' },
    { phrase: 'cold',             polarity: 'neg' },
  ]},
  { axis: 'attribute', sub: 'food safety',phrases: [
    { phrase: 'food poisoning',   polarity: 'neg', severity: 'crisis' },
    { phrase: 'got sick',         polarity: 'neg', severity: 'crisis' },
    { phrase: 'allergic reaction',polarity: 'neg', severity: 'crisis' },
    { phrase: 'undercooked meat', polarity: 'neg', severity: 'alert' },
    { phrase: 'raw chicken',      polarity: 'neg', severity: 'crisis' },
    { phrase: 'foreign object',   polarity: 'neg', severity: 'crisis' },
  ]},
  { axis: 'attribute', sub: 'pests',      phrases: [
    { phrase: 'gnats',         polarity: 'neg', severity: 'alert' },
    { phrase: 'flies',         polarity: 'neg', severity: 'alert' },
    { phrase: 'roach',         polarity: 'neg', severity: 'alert' },
    { phrase: 'cockroach',     polarity: 'neg', severity: 'alert' },
    { phrase: 'bugs',          polarity: 'neg', severity: 'alert' },
    { phrase: 'mouse',         polarity: 'neg', severity: 'alert' },
    { phrase: 'rodent',        polarity: 'neg', severity: 'alert' },
  ]},
  { axis: 'attribute', sub: 'rude',       phrases: [
    { phrase: 'rude',          polarity: 'neg' },
    { phrase: 'disrespectful', polarity: 'neg' },
    { phrase: 'condescending', polarity: 'neg' },
  ]},
]

// ── PRODUCT — what was ordered (food) ───────────────────────────────────────
// Category words + named items. Specific items set `item:` field.

const PRODUCT: KeywordEntry[] = [
  { axis: 'product', sub: 'steak', phrases: [
    { phrase: 'steak',     polarity: 'neu' },
    { phrase: 'steaks',    polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'steak', item: 'ribeye', phrases: [
    { phrase: 'ribeye',  polarity: 'neu' },
    { phrase: 'rib-eye', polarity: 'neu' },
    { phrase: 'rib eye', polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'steak', item: 'filet', phrases: [
    { phrase: 'filet',         polarity: 'neu' },
    { phrase: 'filet mignon',  polarity: 'neu' },
    { phrase: 'fillet',        polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'steak', item: 'ny strip', phrases: [
    { phrase: 'ny strip',      polarity: 'neu' },
    { phrase: 'new york strip',polarity: 'neu' },
    { phrase: 'strip steak',   polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'steak', item: 'porterhouse', phrases: [
    { phrase: 'porterhouse', polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'steak', item: 't-bone', phrases: [
    { phrase: 't-bone', polarity: 'neu' },
    { phrase: 't bone', polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'steak', item: 'sirloin', phrases: [
    { phrase: 'sirloin', polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'steak', item: 'prime rib', phrases: [
    { phrase: 'prime rib', polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'steak', item: 'tomahawk', phrases: [
    { phrase: 'tomahawk', polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'sides', phrases: [
    { phrase: 'mashed potato',   polarity: 'neu' },
    { phrase: 'mashed potatoes', polarity: 'neu' },
    { phrase: 'baked potato',    polarity: 'neu' },
    { phrase: 'asparagus',       polarity: 'neu' },
    { phrase: 'brussel sprouts', polarity: 'neu' },
    { phrase: 'creamed spinach', polarity: 'neu' },
    { phrase: 'side dish',       polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'sides', item: 'mac and cheese', phrases: [
    { phrase: 'mac and cheese', polarity: 'neu' },
    { phrase: 'mac & cheese',   polarity: 'neu' },
    { phrase: 'lobster mac',    polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'apps', phrases: [
    { phrase: 'appetizer',     polarity: 'neu' },
    { phrase: 'appetizers',    polarity: 'neu' },
    { phrase: 'starter',       polarity: 'neu' },
    { phrase: 'calamari',      polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'apps', item: 'shrimp cocktail', phrases: [
    { phrase: 'shrimp cocktail', polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'apps', item: 'crab cake', phrases: [
    { phrase: 'crab cake',  polarity: 'neu' },
    { phrase: 'crab cakes', polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'desserts', phrases: [
    { phrase: 'dessert',  polarity: 'neu' },
    { phrase: 'desserts', polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'desserts', item: 'cheesecake', phrases: [
    { phrase: 'cheesecake', polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'desserts', item: 'bread pudding', phrases: [
    { phrase: 'bread pudding', polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'salads', phrases: [
    { phrase: 'salad',  polarity: 'neu' },
    { phrase: 'salads', polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'salads', item: 'caesar salad', phrases: [
    { phrase: 'caesar salad', polarity: 'neu' },
    { phrase: 'caesar',       polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'salads', item: 'wedge salad', phrases: [
    { phrase: 'wedge salad', polarity: 'neu' },
    { phrase: 'wedge',       polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'soup', phrases: [
    { phrase: 'soup',          polarity: 'neu' },
    { phrase: 'lobster bisque',polarity: 'neu' },
    { phrase: 'french onion',  polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'seafood', phrases: [
    { phrase: 'seafood',      polarity: 'neu' },
    { phrase: 'salmon',       polarity: 'neu' },
    { phrase: 'tuna',         polarity: 'neu' },
    { phrase: 'shrimp',       polarity: 'neu' },
    { phrase: 'scallops',     polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'seafood', item: 'lobster tail', phrases: [
    { phrase: 'lobster tail', polarity: 'neu' },
    { phrase: 'lobster',      polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'pasta', phrases: [
    { phrase: 'pasta',     polarity: 'neu' },
    { phrase: 'spaghetti', polarity: 'neu' },
    { phrase: 'ravioli',   polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'beef', phrases: [
    { phrase: 'beef',          polarity: 'neu' },
    { phrase: 'short rib',     polarity: 'neu' },
    { phrase: 'beef tartare',  polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'pork', phrases: [
    { phrase: 'pork',     polarity: 'neu' },
    { phrase: 'pork chop',polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'chicken', phrases: [
    { phrase: 'chicken',polarity: 'neu' },
  ]},
  { axis: 'product', sub: 'bread', phrases: [
    { phrase: 'bread basket',polarity: 'neu' },
    { phrase: 'rolls',       polarity: 'neu' },
  ]},
]

// ── BEVERAGE ───────────────────────────────────────────────────────────────

const BEVERAGE: KeywordEntry[] = [
  { axis: 'beverage', sub: 'wine',      phrases: [
    { phrase: 'wine',          polarity: 'neu' },
    { phrase: 'glass of wine', polarity: 'neu' },
    { phrase: 'bottle of wine',polarity: 'neu' },
    { phrase: 'red wine',      polarity: 'neu' },
    { phrase: 'white wine',    polarity: 'neu' },
    { phrase: 'wine list',     polarity: 'neu' },
  ]},
  { axis: 'beverage', sub: 'cocktail',  phrases: [
    { phrase: 'cocktail',  polarity: 'neu' },
    { phrase: 'cocktails', polarity: 'neu' },
    { phrase: 'old fashioned', polarity: 'neu' },
  ]},
  { axis: 'beverage', sub: 'beer',      phrases: [
    { phrase: 'beer', polarity: 'neu' },
    { phrase: 'ipa',  polarity: 'neu' },
    { phrase: 'lager',polarity: 'neu' },
  ]},
  { axis: 'beverage', sub: 'martini',   phrases: [
    { phrase: 'martini', polarity: 'neu' },
  ]},
  { axis: 'beverage', sub: 'margarita', phrases: [
    { phrase: 'margarita', polarity: 'neu' },
  ]},
  { axis: 'beverage', sub: 'champagne', phrases: [
    { phrase: 'champagne', polarity: 'neu' },
    { phrase: 'sparkling', polarity: 'neu' },
  ]},
  { axis: 'beverage', sub: 'coffee',    phrases: [
    { phrase: 'coffee',    polarity: 'neu' },
    { phrase: 'espresso',  polarity: 'neu' },
  ]},
  { axis: 'beverage', sub: 'tea',       phrases: [
    { phrase: 'tea',polarity: 'neu' },
  ]},
  { axis: 'beverage', sub: 'nab',       phrases: [
    { phrase: 'mocktail',    polarity: 'neu' },
    { phrase: 'soft drink',  polarity: 'neu' },
    { phrase: 'soda',        polarity: 'neu' },
    { phrase: 'iced tea',    polarity: 'neu' },
    { phrase: 'lemonade',    polarity: 'neu' },
  ]},
]

// ── AMBIANCE ───────────────────────────────────────────────────────────────

const AMBIANCE: KeywordEntry[] = [
  { axis: 'ambiance', sub: 'noise',      phrases: [
    { phrase: 'too loud',          polarity: 'neg' },
    { phrase: 'extremely loud',    polarity: 'neg' },
    { phrase: 'noisy',             polarity: 'neg' },
    { phrase: "couldn't hear",     polarity: 'neg' },
    { phrase: 'quiet atmosphere',  polarity: 'pos' },
  ]},
  { axis: 'ambiance', sub: 'light',      phrases: [
    { phrase: 'too dark',     polarity: 'neg' },
    { phrase: 'dim lighting', polarity: 'pos' },
    { phrase: 'too bright',   polarity: 'neg' },
  ]},
  { axis: 'ambiance', sub: 'music',      phrases: [
    { phrase: 'music was loud',polarity: 'neg' },
    { phrase: 'live music',    polarity: 'neu' },
  ]},
  { axis: 'ambiance', sub: 'decor',      phrases: [
    { phrase: 'beautiful decor',  polarity: 'pos' },
    { phrase: 'elegant',          polarity: 'pos' },
    { phrase: 'dated',            polarity: 'neg' },
    { phrase: 'tired',            polarity: 'neg' },
  ]},
  { axis: 'ambiance', sub: 'clean',      phrases: [
    { phrase: 'spotless',     polarity: 'pos' },
    { phrase: 'dirty restaurant',polarity: 'neg' },
    { phrase: 'water stains', polarity: 'neg' },
    { phrase: 'filthy',       polarity: 'neg' },
    { phrase: 'sticky table', polarity: 'neg' },
  ]},
  { axis: 'ambiance', sub: 'location',   phrases: [
    { phrase: 'great location',  polarity: 'pos' },
    { phrase: 'hard to find',    polarity: 'neg' },
    { phrase: 'no parking',      polarity: 'neg' },
  ]},
  { axis: 'ambiance', sub: 'odor',       phrases: [
    { phrase: 'smelled bad', polarity: 'neg' },
    { phrase: 'bad smell',   polarity: 'neg' },
  ]},
  { axis: 'ambiance', sub: 'appearance', phrases: [
    { phrase: 'exposed ceiling',polarity: 'neg' },
    { phrase: 'beautiful room', polarity: 'pos' },
    { phrase: "doesn't look",   polarity: 'neg' },
  ]},
  { axis: 'ambiance', sub: 'tv',         phrases: [
    { phrase: 'tv on', polarity: 'neu' },
  ]},
]

// ── CONTEXT ────────────────────────────────────────────────────────────────

const CONTEXT: KeywordEntry[] = [
  // Daypart
  { axis: 'context', sub: 'breakfast',  phrases: [{ phrase: 'breakfast', polarity: 'neu' }, { phrase: 'brunch', polarity: 'neu' }]},
  { axis: 'context', sub: 'lunch',      phrases: [{ phrase: 'lunch', polarity: 'neu' }]},
  { axis: 'context', sub: 'dinner',     phrases: [{ phrase: 'dinner', polarity: 'neu' }]},
  { axis: 'context', sub: 'happy-hour', phrases: [{ phrase: 'happy hour', polarity: 'neu' }]},
  { axis: 'context', sub: 'late-night', phrases: [{ phrase: 'late night', polarity: 'neu' }]},
  // Holiday / occasion
  { axis: 'context', sub: 'birthday',     phrases: [{ phrase: 'birthday', polarity: 'neu' }]},
  { axis: 'context', sub: 'anniversary',  phrases: [{ phrase: 'anniversary', polarity: 'neu' }]},
  { axis: 'context', sub: 'valentines',   phrases: [{ phrase: 'valentine', polarity: 'neu' }, { phrase: "valentine's day", polarity: 'neu' }]},
  { axis: 'context', sub: 'mothers-day',  phrases: [{ phrase: "mother's day", polarity: 'neu' }]},
  { axis: 'context', sub: 'fathers-day',  phrases: [{ phrase: "father's day", polarity: 'neu' }]},
  { axis: 'context', sub: 'thanksgiving', phrases: [{ phrase: 'thanksgiving', polarity: 'neu' }]},
  { axis: 'context', sub: 'christmas',    phrases: [{ phrase: 'christmas', polarity: 'neu' }, { phrase: 'xmas', polarity: 'neu' }]},
  { axis: 'context', sub: 'new-years',    phrases: [{ phrase: "new year's", polarity: 'neu' }, { phrase: 'nye', polarity: 'neu' }]},
  { axis: 'context', sub: 'easter',       phrases: [{ phrase: 'easter', polarity: 'neu' }]},
  // Channel
  { axis: 'context', sub: 'to-go',     phrases: [{ phrase: 'to-go', polarity: 'neu' }, { phrase: 'to go order', polarity: 'neu' }, { phrase: 'takeout', polarity: 'neu' }]},
  { axis: 'context', sub: 'delivery',  phrases: [{ phrase: 'delivery', polarity: 'neu' }, { phrase: 'delivered', polarity: 'neu' }]},
  { axis: 'context', sub: 'catering',  phrases: [{ phrase: 'catering', polarity: 'neu' }, { phrase: 'catered', polarity: 'neu' }]},
  { axis: 'context', sub: 'doordash',  phrases: [{ phrase: 'doordash', polarity: 'neu' }]},
  { axis: 'context', sub: 'uber-eats', phrases: [{ phrase: 'uber eats', polarity: 'neu' }, { phrase: 'ubereats', polarity: 'neu' }]},
  { axis: 'context', sub: 'curbside',  phrases: [{ phrase: 'curbside', polarity: 'neu' }]},
]

// ── OUTCOME ────────────────────────────────────────────────────────────────

const OUTCOME: KeywordEntry[] = [
  { axis: 'outcome', sub: 'return',         phrases: [
    { phrase: 'will be back',   polarity: 'pos' },
    { phrase: 'will return',    polarity: 'pos' },
    { phrase: 'be back soon',   polarity: 'pos' },
    { phrase: 'coming back',    polarity: 'pos' },
    { phrase: "won't be back",  polarity: 'neg' },
    { phrase: 'never coming back',polarity: 'neg' },
    { phrase: 'never again',    polarity: 'neg' },
  ]},
  { axis: 'outcome', sub: 'recommend',      phrases: [
    { phrase: 'highly recommend',     polarity: 'pos' },
    { phrase: 'would recommend',      polarity: 'pos' },
    { phrase: 'must try',             polarity: 'pos' },
    { phrase: 'i recommend',          polarity: 'pos' },
  ]},
  { axis: 'outcome', sub: 'not-recommend',  phrases: [
    { phrase: 'do not recommend',   polarity: 'neg' },
    { phrase: 'would not recommend',polarity: 'neg' },
    { phrase: "wouldn't recommend", polarity: 'neg' },
    { phrase: 'go anywhere else',   polarity: 'neg' },
    { phrase: 'avoid this place',   polarity: 'neg' },
  ]},
  { axis: 'outcome', sub: 'brand-love',     phrases: [
    { phrase: 'love this place', polarity: 'pos' },
    { phrase: 'best in town',    polarity: 'pos' },
    { phrase: 'favorite',        polarity: 'pos' },
  ]},
  { axis: 'outcome', sub: 'frequency',      phrases: [
    { phrase: 'come here often', polarity: 'pos' },
    { phrase: 'regulars',        polarity: 'pos' },
    { phrase: 'every week',      polarity: 'pos' },
  ]},
  { axis: 'outcome', sub: 'expensive',      phrases: [
    { phrase: 'overpriced',   polarity: 'neg' },
    { phrase: 'not worth',    polarity: 'neg' },
    { phrase: 'too expensive',polarity: 'neg' },
    { phrase: 'pricey',       polarity: 'neg' },
    { phrase: 'hike in pricing',polarity: 'neg' },
  ]},
  { axis: 'outcome', sub: 'affordable',     phrases: [
    { phrase: 'reasonable price', polarity: 'pos' },
    { phrase: 'good value',       polarity: 'pos' },
    { phrase: 'worth every penny',polarity: 'pos' },
  ]},
  { axis: 'outcome', sub: 'discount',       phrases: [
    { phrase: 'discount',  polarity: 'neu' },
    { phrase: 'coupon',    polarity: 'neu' },
    { phrase: 'gift card', polarity: 'neu' },
  ]},
  { axis: 'outcome', sub: 'price-increase', phrases: [
    { phrase: 'prices went up', polarity: 'neg' },
    { phrase: 'price increase', polarity: 'neg' },
  ]},
  { axis: 'outcome', sub: 'improvement',    phrases: [
    { phrase: 'needs improvement', polarity: 'neg' },
    { phrase: 'suggestion',        polarity: 'neu' },
    { phrase: 'could be better',   polarity: 'neg' },
  ]},
]

export const KEYWORD_DICTIONARY: KeywordEntry[] = [
  ...TOUCHPOINT,
  ...ATTRIBUTE,
  ...PRODUCT,
  ...BEVERAGE,
  ...AMBIANCE,
  ...CONTEXT,
  ...OUTCOME,
]

// Negation words (within NEGATION_WINDOW tokens before a sentiment keyword
// flip that keyword's polarity).
export const NEGATION_TOKENS = new Set([
  'not', 'no', 'never', 'nothing',
  "wasn't", 'wasnt', "weren't", 'werent',
  "didn't", 'didnt', "doesn't", 'doesnt', "don't", 'dont',
  "isn't", 'isnt', "aren't", 'arent',
  "won't", 'wont',
  "haven't", 'havent', "hasn't", 'hasnt',
])
export const NEGATION_WINDOW = 3
