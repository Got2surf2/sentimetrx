// lib/taxonomyKeywordsLearned.ts
//
// MACHINE-GENERATED keyword dictionary — do not hand-edit; regenerate via
// scripts/pilot-rc-keyword-build.ts. Mined from real Ruth's Chris Google
// reviews (Path B), then frequency-floored. Same KeywordEntry[] shape as the
// hand-written lib/taxonomyKeywords.ts, consumed by lib/taxonomyKeywordMatcher.ts.
//
// Provenance: 1217 reviews mined, 5948 raw mentions, min-count=3.
// Result: 45 entries, 204 phrases.
// Per-axis phrase counts: touchpoint=16, attribute=104, product=39, beverage=2, ambiance=6, context=8, outcome=29
// The trailing count comment on each phrase is its sample frequency (audit trail).

import type { KeywordEntry } from './taxonomyKeywords'

export const LEARNED_KEYWORD_DICTIONARY: KeywordEntry[] = [
  // ── TOUCHPOINT ────────────────────────────────────────────────
  { axis: 'touchpoint', sub: 'bartender', phrases: [
    { phrase: 'bartender', polarity: 'neu' }, // 4
  ]},
  { axis: 'touchpoint', sub: 'host', phrases: [
    { phrase: 'hostess', polarity: 'neu' }, // 6
  ]},
  { axis: 'touchpoint', sub: 'manager', phrases: [
    { phrase: 'manager', polarity: 'neu' }, // 6
    { phrase: 'management', polarity: 'neu' }, // 2
  ]},
  { axis: 'touchpoint', sub: 'server', phrases: [
    { phrase: 'server', polarity: 'neu' }, // 9
    { phrase: 'waitress', polarity: 'neu' }, // 8
    { phrase: 'server was great', polarity: 'pos' }, // 6
    { phrase: 'friendly staff', polarity: 'pos' }, // 5
    { phrase: 'great staff', polarity: 'pos' }, // 5
    { phrase: 'waitress was great', polarity: 'pos' }, // 4
    { phrase: 'waiter was great', polarity: 'pos' }, // 4
    { phrase: 'great server', polarity: 'pos' }, // 3
    { phrase: 'friendly service', polarity: 'pos' }, // 3
    { phrase: 'kayla is the best server', polarity: 'pos' }, // 3
    { phrase: 'best server', polarity: 'pos' }, // 3
    { phrase: 'server was friendly', polarity: 'pos' }, // 3
  ]},
  // ── ATTRIBUTE ─────────────────────────────────────────────────
  { axis: 'attribute', sub: 'accuracy', phrases: [
    { phrase: 'order was wrong', polarity: 'neg' }, // 3
  ]},
  { axis: 'attribute', sub: 'attentive', phrases: [
    { phrase: 'attentive', polarity: 'pos' }, // 31
    { phrase: 'very attentive', polarity: 'pos' }, // 14
    { phrase: 'helpful', polarity: 'pos' }, // 6
    { phrase: 'accommodating', polarity: 'pos' }, // 6
    { phrase: 'went above and beyond', polarity: 'pos' }, // 3
    { phrase: 'taken care of', polarity: 'pos' }, // 3
  ]},
  { axis: 'attribute', sub: 'experience', phrases: [
    { phrase: 'great experience', polarity: 'pos' }, // 6
    { phrase: 'amazing experience', polarity: 'pos' }, // 5
    { phrase: 'amazing', polarity: 'pos' }, // 4
    { phrase: 'wonderful experience', polarity: 'pos' }, // 4
    { phrase: 'good experience', polarity: 'pos' }, // 3
  ]},
  { axis: 'attribute', sub: 'flavor', phrases: [
    { phrase: 'food was delicious', polarity: 'pos' }, // 25
    { phrase: 'delicious', polarity: 'pos' }, // 23
    { phrase: 'delicious food', polarity: 'pos' }, // 11
    { phrase: 'flavorful', polarity: 'pos' }, // 7
    { phrase: 'food is delicious', polarity: 'pos' }, // 5
    { phrase: 'very flavorful', polarity: 'pos' }, // 5
    { phrase: 'so good', polarity: 'pos' }, // 4
    { phrase: 'flavorless', polarity: 'neg' }, // 4
    { phrase: 'tasty', polarity: 'pos' }, // 4
    { phrase: 'absolutely delicious', polarity: 'pos' }, // 3
    { phrase: 'very good', polarity: 'pos' }, // 3
    { phrase: 'yummy', polarity: 'pos' }, // 3
  ]},
  { axis: 'attribute', sub: 'friendly', phrases: [
    { phrase: 'friendly', polarity: 'pos' }, // 22
    { phrase: 'great service', polarity: 'pos' }, // 10
    { phrase: 'super friendly', polarity: 'pos' }, // 7
    { phrase: 'great customer service', polarity: 'pos' }, // 7
    { phrase: 'service was great', polarity: 'pos' }, // 6
    { phrase: 'very friendly', polarity: 'pos' }, // 6
    { phrase: 'good service', polarity: 'pos' }, // 6
    { phrase: 'friendly staff', polarity: 'pos' }, // 4
    { phrase: 'staff was friendly', polarity: 'pos' }, // 4
    { phrase: 'smile on her face', polarity: 'pos' }, // 3
    { phrase: 'made us feel welcome', polarity: 'pos' }, // 3
    { phrase: 'very sweet', polarity: 'pos' }, // 3
    { phrase: 'very nice', polarity: 'pos' }, // 3
    { phrase: 'funny', polarity: 'pos' }, // 3
    { phrase: 'friendliness', polarity: 'pos' }, // 3
    { phrase: 'so nice', polarity: 'pos' }, // 3
    { phrase: 'positive attitude', polarity: 'pos' }, // 3
  ]},
  { axis: 'attribute', sub: 'portion', phrases: [
    { phrase: 'huge portions', polarity: 'pos' }, // 4
  ]},
  { axis: 'attribute', sub: 'professional', phrases: [
    { phrase: 'great service', polarity: 'pos' }, // 28
    { phrase: 'excellent service', polarity: 'pos' }, // 14
    { phrase: 'professional', polarity: 'pos' }, // 7
    { phrase: 'service was excellent', polarity: 'pos' }, // 6
    { phrase: 'went above and beyond', polarity: 'pos' }, // 5
    { phrase: 'service was great', polarity: 'pos' }, // 5
    { phrase: 'service was good', polarity: 'pos' }, // 4
    { phrase: 'good service', polarity: 'pos' }, // 4
    { phrase: 'terrible service', polarity: 'neg' }, // 4
    { phrase: 'service is excellent', polarity: 'pos' }, // 4
    { phrase: 'amazing job', polarity: 'pos' }, // 3
    { phrase: 'wonderful service', polarity: 'pos' }, // 3
    { phrase: 'amazing service', polarity: 'pos' }, // 3
    { phrase: 'service', polarity: 'pos' }, // 3
    { phrase: 'horrible service', polarity: 'neg' }, // 3
    { phrase: 'outstanding service', polarity: 'pos' }, // 3
    { phrase: 'best service', polarity: 'pos' }, // 3
  ]},
  { axis: 'attribute', sub: 'quality', phrases: [
    { phrase: 'great food', polarity: 'pos' }, // 63
    { phrase: 'food was great', polarity: 'pos' }, // 35
    { phrase: 'good food', polarity: 'pos' }, // 24
    { phrase: 'food was good', polarity: 'pos' }, // 23
    { phrase: 'food was amazing', polarity: 'pos' }, // 16
    { phrase: 'very good', polarity: 'pos' }, // 10
    { phrase: 'excellent food', polarity: 'pos' }, // 8
    { phrase: 'amazing food', polarity: 'pos' }, // 7
    { phrase: 'food was excellent', polarity: 'pos' }, // 7
    { phrase: 'amazing', polarity: 'pos' }, // 6
    { phrase: 'food was very good', polarity: 'pos' }, // 6
    { phrase: 'really good', polarity: 'pos' }, // 5
    { phrase: 'food is always great', polarity: 'pos' }, // 5
    { phrase: 'food is great', polarity: 'pos' }, // 5
    { phrase: 'food is good', polarity: 'pos' }, // 5
    { phrase: 'food is amazing', polarity: 'pos' }, // 4
    { phrase: 'food was ok', polarity: 'neu' }, // 4
    { phrase: 'not great', polarity: 'neg' }, // 4
    { phrase: 'everything was great', polarity: 'pos' }, // 4
    { phrase: 'very good food', polarity: 'pos' }, // 4
    { phrase: 'great', polarity: 'pos' }, // 4
    { phrase: 'food was really good', polarity: 'pos' }, // 4
    { phrase: 'excellent', polarity: 'pos' }, // 4
    { phrase: 'good', polarity: 'pos' }, // 3
    { phrase: 'authentic mexican food', polarity: 'pos' }, // 3
    { phrase: 'great drinks', polarity: 'pos' }, // 3
    { phrase: 'food is always good', polarity: 'pos' }, // 3
    { phrase: 'great meal', polarity: 'pos' }, // 3
    { phrase: 'so good', polarity: 'pos' }, // 3
    { phrase: 'nothing special', polarity: 'neg' }, // 3
    { phrase: 'on point', polarity: 'pos' }, // 3
    { phrase: 'really good food', polarity: 'pos' }, // 3
    { phrase: 'food was fresh', polarity: 'pos' }, // 3
    { phrase: 'love the food', polarity: 'pos' }, // 3
    { phrase: 'fresh', polarity: 'pos' }, // 3
    { phrase: 'food is excellent', polarity: 'pos' }, // 3
  ]},
  { axis: 'attribute', sub: 'rude', phrases: [
    { phrase: 'rude', polarity: 'neg' }, // 11
  ]},
  { axis: 'attribute', sub: 'speed', phrases: [
    { phrase: 'quick service', polarity: 'pos' }, // 7
    { phrase: 'fast', polarity: 'pos' }, // 6
    { phrase: 'service was terrible', polarity: 'neg' }, // 3
    { phrase: 'service was a bit slow', polarity: 'neg' }, // 3
    { phrase: 'slow service', polarity: 'neg' }, // 3
    { phrase: 'horrible service', polarity: 'neg' }, // 3
    { phrase: 'slow', polarity: 'neg' }, // 3
  ]},
  { axis: 'attribute', sub: 'temp', phrases: [
    { phrase: 'food was cold', polarity: 'neg' }, // 7
  ]},
  // ── PRODUCT ───────────────────────────────────────────────────
  { axis: 'product', sub: 'burritos', phrases: [
    { phrase: 'burrito', polarity: 'neu' }, // 8
    { phrase: 'burritos', polarity: 'neu' }, // 6
    { phrase: 'steak burrito', polarity: 'neu' }, // 4
    { phrase: 'burritos are huge', polarity: 'pos' }, // 3
  ]},
  { axis: 'product', sub: 'chimichanga', phrases: [
    { phrase: 'chicken flautas', polarity: 'neu' }, // 3
    { phrase: 'flautas', polarity: 'neu' }, // 3
    { phrase: 'chuychanga', polarity: 'neu' }, // 3
    { phrase: 'chimichanga', polarity: 'neu' }, // 3
  ]},
  { axis: 'product', sub: 'chips and salsa', phrases: [
    { phrase: 'chips and salsa', polarity: 'neu' }, // 21
    { phrase: 'chips', polarity: 'neu' }, // 5
    { phrase: 'chips and dips', polarity: 'neu' }, // 4
  ]},
  { axis: 'product', sub: 'desserts', phrases: [
    { phrase: 'tres leches', polarity: 'neu' }, // 6
    { phrase: 'tres leches cake', polarity: 'neu' }, // 4
  ]},
  { axis: 'product', sub: 'enchiladas', phrases: [
    { phrase: 'enchiladas', polarity: 'neu' }, // 15
    { phrase: 'cheese enchilada', polarity: 'neu' }, // 3
  ]},
  { axis: 'product', sub: 'fajitas', phrases: [
    { phrase: 'fajitas', polarity: 'neu' }, // 17
    { phrase: 'chicken fajitas', polarity: 'neu' }, // 5
    { phrase: 'steak fajitas', polarity: 'neu' }, // 4
  ]},
  { axis: 'product', sub: 'guacamole', phrases: [
    { phrase: 'guacamole', polarity: 'neu' }, // 4
  ]},
  { axis: 'product', sub: 'nachos', phrases: [
    { phrase: 'panchos', polarity: 'neu' }, // 3
  ]},
  { axis: 'product', sub: 'quesadilla', phrases: [
    { phrase: 'quesadillas', polarity: 'neu' }, // 4
  ]},
  { axis: 'product', sub: 'queso', phrases: [
    { phrase: 'queso', polarity: 'neu' }, // 21
    { phrase: 'creamy jalapeno dip', polarity: 'neu' }, // 5
    { phrase: 'queso dip', polarity: 'neu' }, // 3
    { phrase: 'queso compuesto', polarity: 'neu' }, // 3
    { phrase: 'creamy jalapeño dip', polarity: 'pos' }, // 2
    { phrase: 'creamy jalapeño dip', polarity: 'neu' }, // 2
  ]},
  { axis: 'product', sub: 'rice and beans', phrases: [
    { phrase: 'rice and beans', polarity: 'neu' }, // 9
    { phrase: 'rice', polarity: 'neu' }, // 5
  ]},
  { axis: 'product', sub: 'salsa', phrases: [
    { phrase: 'salsa', polarity: 'neu' }, // 11
    { phrase: 'boom boom sauce', polarity: 'neu' }, // 7
  ]},
  { axis: 'product', sub: 'tacos', phrases: [
    { phrase: 'tacos', polarity: 'neu' }, // 11
    { phrase: 'tacos al carbon', polarity: 'neu' }, // 4
    { phrase: 'shrimp tacos', polarity: 'neu' }, // 4
    { phrase: 'chicken tacos', polarity: 'neu' }, // 3
    { phrase: 'taco', polarity: 'neu' }, // 3
    { phrase: 'soft tacos', polarity: 'neu' }, // 3
  ]},
  { axis: 'product', sub: 'tortilla soup', phrases: [
    { phrase: 'chicken tortilla soup', polarity: 'neu' }, // 5
    { phrase: 'tortillas', polarity: 'neu' }, // 3
  ]},
  // ── BEVERAGE ──────────────────────────────────────────────────
  { axis: 'beverage', sub: 'margarita', phrases: [
    { phrase: 'margaritas', polarity: 'neu' }, // 8
    { phrase: 'margarita', polarity: 'neu' }, // 7
  ]},
  // ── AMBIANCE ──────────────────────────────────────────────────
  { axis: 'ambiance', sub: 'appearance', phrases: [
    { phrase: 'great atmosphere', polarity: 'pos' }, // 3
  ]},
  { axis: 'ambiance', sub: 'clean', phrases: [
    { phrase: 'clean', polarity: 'pos' }, // 4
    { phrase: 'very clean', polarity: 'pos' }, // 3
  ]},
  { axis: 'ambiance', sub: 'decor', phrases: [
    { phrase: 'love the atmosphere', polarity: 'pos' }, // 3
  ]},
  { axis: 'ambiance', sub: 'noise', phrases: [
    { phrase: 'extremely loud', polarity: 'neg' }, // 3
    { phrase: 'a little loud', polarity: 'neg' }, // 3
  ]},
  // ── CONTEXT ───────────────────────────────────────────────────
  { axis: 'context', sub: 'birthday', phrases: [
    { phrase: 'birthday dinner', polarity: 'neu' }, // 3
  ]},
  { axis: 'context', sub: 'dinner', phrases: [
    { phrase: 'dinner', polarity: 'neu' }, // 3
  ]},
  { axis: 'context', sub: 'lunch', phrases: [
    { phrase: 'lunch', polarity: 'neu' }, // 8
  ]},
  { axis: 'context', sub: 'mothers-day', phrases: [
    { phrase: 'mother\'s day', polarity: 'neu' }, // 7
  ]},
  { axis: 'context', sub: 'special-occasion', phrases: [
    { phrase: 'cinco de mayo', polarity: 'neu' }, // 8
  ]},
  { axis: 'context', sub: 'to-go', phrases: [
    { phrase: 'to go order', polarity: 'neu' }, // 6
    { phrase: 'to go', polarity: 'neu' }, // 3
    { phrase: 'to-go order', polarity: 'neu' }, // 3
  ]},
  // ── OUTCOME ───────────────────────────────────────────────────
  { axis: 'outcome', sub: 'affordable', phrases: [
    { phrase: 'affordable', polarity: 'pos' }, // 4
    { phrase: 'good prices', polarity: 'pos' }, // 4
    { phrase: 'good price', polarity: 'pos' }, // 4
    { phrase: 'prices are great', polarity: 'pos' }, // 3
  ]},
  { axis: 'outcome', sub: 'brand-love', phrases: [
    { phrase: 'great experience', polarity: 'pos' }, // 8
    { phrase: 'love this place', polarity: 'pos' }, // 6
    { phrase: 'best experience', polarity: 'pos' }, // 4
    { phrase: 'love chuys', polarity: 'pos' }, // 4
    { phrase: 'love chuy\'s', polarity: 'pos' }, // 4
    { phrase: 'love this restaurant', polarity: 'pos' }, // 3
    { phrase: 'love it', polarity: 'pos' }, // 3
    { phrase: 'great place', polarity: 'pos' }, // 3
  ]},
  { axis: 'outcome', sub: 'not-recommend', phrases: [
    { phrase: 'won\'t be back', polarity: 'neg' }, // 5
    { phrase: 'will not be back', polarity: 'neg' }, // 4
    { phrase: 'never again', polarity: 'neg' }, // 3
    { phrase: 'will not return', polarity: 'neg' }, // 3
    { phrase: 'not impressed', polarity: 'neg' }, // 3
  ]},
  { axis: 'outcome', sub: 'recommend', phrases: [
    { phrase: 'highly recommend', polarity: 'pos' }, // 18
    { phrase: 'recommend', polarity: 'pos' }, // 6
    { phrase: 'definitely recommend', polarity: 'pos' }, // 3
    { phrase: 'would recommend', polarity: 'pos' }, // 3
  ]},
  { axis: 'outcome', sub: 'return', phrases: [
    { phrase: 'definitely be back', polarity: 'pos' }, // 10
    { phrase: 'will be back', polarity: 'pos' }, // 7
    { phrase: 'will definitely be back', polarity: 'pos' }, // 5
    { phrase: 'definitely come back', polarity: 'pos' }, // 3
    { phrase: 'great experience', polarity: 'pos' }, // 3
    { phrase: 'worth the wait', polarity: 'pos' }, // 3
    { phrase: 'definitely be returning', polarity: 'pos' }, // 3
    { phrase: 'coming back', polarity: 'pos' }, // 3
  ]},
]
