// lib/taxonomyKeywordsLearned.ts
//
// MACHINE-GENERATED keyword dictionary — do not hand-edit; regenerate via
// scripts/pilot-rc-keyword-build.ts. Mined from real Ruth's Chris Google
// reviews (Path B), then frequency-floored. Same KeywordEntry[] shape as the
// hand-written lib/taxonomyKeywords.ts, consumed by lib/taxonomyKeywordMatcher.ts.
//
// Provenance: 5000 reviews mined, 26105 raw mentions, min-count=3.
// Result: 90 entries, 1017 phrases.
// Per-axis phrase counts: touchpoint=184, attribute=304, product=184, beverage=28, ambiance=37, context=59, outcome=221
// The trailing count comment on each phrase is its sample frequency (audit trail).

import type { KeywordEntry } from './taxonomyKeywords'

export const LEARNED_KEYWORD_DICTIONARY: KeywordEntry[] = [
  // ── TOUCHPOINT ────────────────────────────────────────────────
  { axis: 'touchpoint', sub: 'bartender', phrases: [
    { phrase: 'bartender', polarity: 'neu' }, // 10
    { phrase: 'bartenders', polarity: 'neu' }, // 6
  ]},
  { axis: 'touchpoint', sub: 'chef', phrases: [
    { phrase: 'chef', polarity: 'neu' }, // 4
  ]},
  { axis: 'touchpoint', sub: 'host', phrases: [
    { phrase: 'hostess', polarity: 'neu' }, // 15
    { phrase: 'host', polarity: 'neu' }, // 6
    { phrase: 'seated promptly', polarity: 'pos' }, // 4
  ]},
  { axis: 'touchpoint', sub: 'manager', phrases: [
    { phrase: 'manager', polarity: 'neu' }, // 38
    { phrase: 'management', polarity: 'neu' }, // 6
    { phrase: 'general manager', polarity: 'neu' }, // 5
    { phrase: 'manager came over', polarity: 'neu' }, // 4
    { phrase: 'manager was great', polarity: 'pos' }, // 3
    { phrase: 'manager stopped by', polarity: 'pos' }, // 3
  ]},
  { axis: 'touchpoint', sub: 'server', phrases: [
    { phrase: 'great service', polarity: 'pos' }, // 136
    { phrase: 'excellent service', polarity: 'pos' }, // 61
    { phrase: 'service', polarity: 'pos' }, // 47
    { phrase: 'server', polarity: 'neu' }, // 45
    { phrase: 'waiter', polarity: 'neu' }, // 41
    { phrase: 'service was great', polarity: 'pos' }, // 38
    { phrase: 'service was excellent', polarity: 'pos' }, // 27
    { phrase: 'server was great', polarity: 'pos' }, // 20
    { phrase: 'good service', polarity: 'pos' }, // 18
    { phrase: 'amazing service', polarity: 'pos' }, // 18
    { phrase: 'service was good', polarity: 'pos' }, // 17
    { phrase: 'great server', polarity: 'pos' }, // 17
    { phrase: 'amazing', polarity: 'pos' }, // 16
    { phrase: 'excellent server', polarity: 'pos' }, // 16
    { phrase: 'amazing server', polarity: 'pos' }, // 14
    { phrase: 'service was amazing', polarity: 'pos' }, // 14
    { phrase: 'waitress', polarity: 'neu' }, // 14
    { phrase: 'friendly', polarity: 'pos' }, // 14
    { phrase: 'waiter was great', polarity: 'pos' }, // 13
    { phrase: 'server was excellent', polarity: 'pos' }, // 13
    { phrase: 'server was amazing', polarity: 'pos' }, // 12
    { phrase: 'fantastic service', polarity: 'pos' }, // 12
    { phrase: 'fantastic', polarity: 'pos' }, // 12
    { phrase: 'outstanding service', polarity: 'pos' }, // 11
    { phrase: 'friendly staff', polarity: 'pos' }, // 10
    { phrase: 'service was outstanding', polarity: 'pos' }, // 10
    { phrase: 'impeccable service', polarity: 'pos' }, // 9
    { phrase: 'wonderful service', polarity: 'pos' }, // 9
    { phrase: 'service was impeccable', polarity: 'pos' }, // 9
    { phrase: 'waiter was amazing', polarity: 'pos' }, // 9
    { phrase: 'servers', polarity: 'neu' }, // 8
    { phrase: 'great staff', polarity: 'pos' }, // 8
    { phrase: 'very attentive', polarity: 'pos' }, // 8
    { phrase: 'service excellent', polarity: 'pos' }, // 8
    { phrase: 'exceptional service', polarity: 'pos' }, // 8
    { phrase: 'service was wonderful', polarity: 'pos' }, // 8
    { phrase: 'absolutely amazing', polarity: 'pos' }, // 8
    { phrase: 'best server', polarity: 'pos' }, // 7
    { phrase: 'service was fantastic', polarity: 'pos' }, // 7
    { phrase: 'great waiter', polarity: 'pos' }, // 7
    { phrase: 'attentive service', polarity: 'pos' }, // 7
    { phrase: 'service was perfect', polarity: 'pos' }, // 7
    { phrase: 'service was very good', polarity: 'pos' }, // 7
    { phrase: 'staff', polarity: 'neu' }, // 7
    { phrase: 'service was exceptional', polarity: 'pos' }, // 7
    { phrase: 'excellent waiter', polarity: 'pos' }, // 6
    { phrase: 'server was friendly', polarity: 'pos' }, // 6
    { phrase: 'server was attentive', polarity: 'pos' }, // 6
    { phrase: 'knowledgeable', polarity: 'pos' }, // 6
    { phrase: 'server was wonderful', polarity: 'pos' }, // 6
    { phrase: 'best service', polarity: 'pos' }, // 6
    { phrase: 'wonderful server', polarity: 'pos' }, // 6
    { phrase: 'server was very friendly', polarity: 'pos' }, // 6
    { phrase: 'awesome', polarity: 'pos' }, // 6
    { phrase: 'amazing waiter', polarity: 'pos' }, // 6
    { phrase: 'amazing waitress', polarity: 'pos' }, // 6
    { phrase: 'fantastic server', polarity: 'pos' }, // 6
    { phrase: 'wonderful staff', polarity: 'pos' }, // 6
    { phrase: 'staff was wonderful', polarity: 'pos' }, // 6
    { phrase: 'server was fantastic', polarity: 'pos' }, // 5
    { phrase: 'outstanding', polarity: 'pos' }, // 5
    { phrase: 'very personable', polarity: 'pos' }, // 5
    { phrase: 'wonderful', polarity: 'pos' }, // 5
    { phrase: 'service was even better', polarity: 'pos' }, // 5
    { phrase: 'staff is friendly', polarity: 'pos' }, // 5
    { phrase: 'server was the best', polarity: 'pos' }, // 5
    { phrase: 'customer service', polarity: 'pos' }, // 5
    { phrase: 'wonderful waitress', polarity: 'pos' }, // 5
    { phrase: 'very nice', polarity: 'pos' }, // 5
    { phrase: 'staff was great', polarity: 'pos' }, // 5
    { phrase: 'service is always great', polarity: 'pos' }, // 5
    { phrase: 'absolutely wonderful', polarity: 'pos' }, // 5
    { phrase: 'phenomenal server', polarity: 'pos' }, // 5
    { phrase: 'hillary', polarity: 'neu' }, // 5
    { phrase: 'waiter was fantastic', polarity: 'pos' }, // 4
    { phrase: 'waitress was awesome', polarity: 'pos' }, // 4
    { phrase: 'excellent recommendations', polarity: 'pos' }, // 4
    { phrase: 'service was superb', polarity: 'pos' }, // 4
    { phrase: 'waiter was outstanding', polarity: 'pos' }, // 4
    { phrase: 'service was awesome', polarity: 'pos' }, // 4
    { phrase: 'service was spectacular', polarity: 'pos' }, // 4
    { phrase: 'server was exceptional', polarity: 'pos' }, // 4
    { phrase: 'jordan', polarity: 'neu' }, // 4
    { phrase: 'waitress was great', polarity: 'pos' }, // 4
    { phrase: 'staff was very friendly', polarity: 'pos' }, // 4
    { phrase: 'phenomenal', polarity: 'pos' }, // 4
    { phrase: 'amazing job', polarity: 'pos' }, // 4
    { phrase: 'he was great', polarity: 'pos' }, // 4
    { phrase: 'excellent customer service', polarity: 'pos' }, // 4
    { phrase: 'server was outstanding', polarity: 'pos' }, // 4
    { phrase: 'anthony was great', polarity: 'pos' }, // 4
    { phrase: 'staff was attentive', polarity: 'pos' }, // 4
    { phrase: 'kind', polarity: 'pos' }, // 4
    { phrase: 'whitney', polarity: 'neu' }, // 4
    { phrase: 'great recommendations', polarity: 'pos' }, // 4
    { phrase: 'service is great', polarity: 'pos' }, // 4
    { phrase: 'service was top notch', polarity: 'pos' }, // 4
    { phrase: 'david', polarity: 'neu' }, // 4
    { phrase: 'service was poor', polarity: 'neg' }, // 4
    { phrase: 'he was awesome', polarity: 'pos' }, // 4
    { phrase: 'service was top-notch', polarity: 'pos' }, // 4
    { phrase: 'fabulous service', polarity: 'pos' }, // 4
    { phrase: 'went above and beyond', polarity: 'pos' }, // 4
    { phrase: 'attentive', polarity: 'pos' }, // 4
    { phrase: 'giuliano rios', polarity: 'neu' }, // 4
    { phrase: 'staff was friendly', polarity: 'pos' }, // 4
    { phrase: 'wait staff', polarity: 'neu' }, // 4
    { phrase: 'attentive to our needs', polarity: 'pos' }, // 4
    { phrase: 'waitress was amazing', polarity: 'pos' }, // 3
    { phrase: 'great personality', polarity: 'pos' }, // 3
    { phrase: 'sweet', polarity: 'pos' }, // 3
    { phrase: 'staff went above and beyond', polarity: 'pos' }, // 3
    { phrase: 'service is excellent', polarity: 'pos' }, // 3
    { phrase: 'understaffed', polarity: 'neg' }, // 3
    { phrase: 'service is impeccable', polarity: 'pos' }, // 3
    { phrase: 'very professional', polarity: 'pos' }, // 3
    { phrase: 'server was rude', polarity: 'neg' }, // 3
    { phrase: 'awesome service', polarity: 'pos' }, // 3
    { phrase: 'lorenzo', polarity: 'neu' }, // 3
    { phrase: 'he was the best', polarity: 'pos' }, // 3
    { phrase: 'great servers', polarity: 'pos' }, // 3
    { phrase: 'william was amazing', polarity: 'pos' }, // 3
    { phrase: 'staff was excellent', polarity: 'pos' }, // 3
    { phrase: 'one of the best waiters', polarity: 'pos' }, // 3
    { phrase: 'good server', polarity: 'pos' }, // 3
    { phrase: 'amazing staff', polarity: 'pos' }, // 3
    { phrase: 'service outstanding', polarity: 'pos' }, // 3
    { phrase: 'terrible service', polarity: 'neg' }, // 3
    { phrase: 'julio', polarity: 'neu' }, // 3
    { phrase: 'best waiter', polarity: 'pos' }, // 3
    { phrase: 'hospitality', polarity: 'pos' }, // 3
    { phrase: 'stephon', polarity: 'neu' }, // 3
    { phrase: 'server was very attentive', polarity: 'pos' }, // 3
    { phrase: 'whitney was amazing', polarity: 'pos' }, // 3
    { phrase: 'server was pleasant', polarity: 'pos' }, // 3
    { phrase: 'staff was amazing', polarity: 'pos' }, // 3
    { phrase: 'very accommodating', polarity: 'pos' }, // 3
    { phrase: 'superb service', polarity: 'pos' }, // 3
    { phrase: 'recommendations were spot on', polarity: 'pos' }, // 3
    { phrase: 'service was attentive', polarity: 'pos' }, // 3
    { phrase: 'best', polarity: 'pos' }, // 3
    { phrase: 'phenomenal service', polarity: 'pos' }, // 3
    { phrase: 'worst service', polarity: 'neg' }, // 3
    { phrase: 'waitress was the best', polarity: 'pos' }, // 3
    { phrase: 'knowledgeable about the menu', polarity: 'pos' }, // 3
    { phrase: 'waiter david', polarity: 'neu' }, // 3
    { phrase: 'waitress was very attentive', polarity: 'pos' }, // 3
    { phrase: 'love the service', polarity: 'pos' }, // 3
    { phrase: 'took great care of us', polarity: 'pos' }, // 3
    { phrase: 'michelle was amazing', polarity: 'pos' }, // 3
    { phrase: 'very pleasant', polarity: 'pos' }, // 3
    { phrase: 'great suggestions', polarity: 'pos' }, // 3
    { phrase: 'waiter william', polarity: 'neu' }, // 3
    { phrase: 'waitress was wonderful', polarity: 'pos' }, // 3
    { phrase: 'welcoming', polarity: 'pos' }, // 3
    { phrase: 'true professional', polarity: 'pos' }, // 3
    { phrase: 'anthony', polarity: 'neu' }, // 3
    { phrase: 'waiter was nice', polarity: 'pos' }, // 3
    { phrase: 'apologetic', polarity: 'pos' }, // 3
    { phrase: 'took care of us', polarity: 'pos' }, // 3
    { phrase: 'warm', polarity: 'pos' }, // 3
    { phrase: 'great waitress', polarity: 'pos' }, // 3
    { phrase: 'best waiter ever', polarity: 'pos' }, // 3
    { phrase: 'service was on point', polarity: 'pos' }, // 3
    { phrase: 'very knowledgeable about the menu', polarity: 'pos' }, // 3
    { phrase: 'server was very nice', polarity: 'pos' }, // 3
    { phrase: 'great customer service', polarity: 'pos' }, // 3
    { phrase: 'server was very good', polarity: 'pos' }, // 3
    { phrase: 'server william', polarity: 'neu' }, // 2
    { phrase: 'service was average', polarity: 'neg' }, // 2
    { phrase: 'service was average', polarity: 'neu' }, // 2
    { phrase: 'the service', polarity: 'neu' }, // 2
  ]},
  // ── ATTRIBUTE ─────────────────────────────────────────────────
  { axis: 'attribute', sub: 'accuracy', phrases: [
    { phrase: 'accuracy', polarity: 'neg' }, // 4
    { phrase: 'as ordered', polarity: 'pos' }, // 3
  ]},
  { axis: 'attribute', sub: 'attentive', phrases: [
    { phrase: 'attentive', polarity: 'pos' }, // 160
    { phrase: 'very attentive', polarity: 'pos' }, // 89
    { phrase: 'great service', polarity: 'pos' }, // 18
    { phrase: 'went above and beyond', polarity: 'pos' }, // 16
    { phrase: 'attention to detail', polarity: 'pos' }, // 12
    { phrase: 'helpful', polarity: 'pos' }, // 12
    { phrase: 'very helpful', polarity: 'pos' }, // 12
    { phrase: 'attentive to our needs', polarity: 'pos' }, // 9
    { phrase: 'attentiveness', polarity: 'pos' }, // 9
    { phrase: 'super attentive', polarity: 'pos' }, // 9
    { phrase: 'patient', polarity: 'pos' }, // 8
    { phrase: 'took great care of us', polarity: 'pos' }, // 8
    { phrase: 'attentive service', polarity: 'pos' }, // 8
    { phrase: 'excellent service', polarity: 'pos' }, // 8
    { phrase: 'accommodating', polarity: 'pos' }, // 7
    { phrase: 'extremely attentive', polarity: 'pos' }, // 7
    { phrase: 'service was great', polarity: 'pos' }, // 6
    { phrase: 'very accommodating', polarity: 'pos' }, // 6
    { phrase: 'amazing service', polarity: 'pos' }, // 6
    { phrase: 'very attentive and helpful', polarity: 'pos' }, // 5
    { phrase: 'service was amazing', polarity: 'pos' }, // 5
    { phrase: 'outstanding service', polarity: 'pos' }, // 5
    { phrase: 'staff was attentive', polarity: 'pos' }, // 4
    { phrase: 'very attentive to our needs', polarity: 'pos' }, // 4
    { phrase: 'best service', polarity: 'pos' }, // 3
    { phrase: 'attentive staff', polarity: 'pos' }, // 3
    { phrase: 'amazing', polarity: 'pos' }, // 3
    { phrase: 'taking care of us', polarity: 'pos' }, // 3
    { phrase: 'service was attentive', polarity: 'pos' }, // 3
    { phrase: 'highly attentive', polarity: 'pos' }, // 3
    { phrase: 'inattentive', polarity: 'neg' }, // 3
    { phrase: 'took good care of us', polarity: 'pos' }, // 3
    { phrase: 'taken care of', polarity: 'pos' }, // 3
    { phrase: 'service was exceptional', polarity: 'pos' }, // 3
    { phrase: 'incredibly attentive', polarity: 'pos' }, // 3
    { phrase: 'service was above and beyond', polarity: 'pos' }, // 3
    { phrase: 'well taken care of', polarity: 'pos' }, // 3
    { phrase: 'service was outstanding', polarity: 'pos' }, // 3
    { phrase: 'so attentive', polarity: 'pos' }, // 3
    { phrase: 'very nice and attentive', polarity: 'pos' }, // 3
    { phrase: 'service was impeccable', polarity: 'pos' }, // 3
  ]},
  { axis: 'attribute', sub: 'flavor', phrases: [
    { phrase: 'delicious', polarity: 'pos' }, // 133
    { phrase: 'food was delicious', polarity: 'pos' }, // 107
    { phrase: 'food was great', polarity: 'pos' }, // 37
    { phrase: 'food was excellent', polarity: 'pos' }, // 36
    { phrase: 'food was amazing', polarity: 'pos' }, // 36
    { phrase: 'great food', polarity: 'pos' }, // 32
    { phrase: 'delicious food', polarity: 'pos' }, // 27
    { phrase: 'food was good', polarity: 'pos' }, // 22
    { phrase: 'flavorful', polarity: 'pos' }, // 21
    { phrase: 'tender', polarity: 'pos' }, // 16
    { phrase: 'excellent', polarity: 'pos' }, // 16
    { phrase: 'absolutely delicious', polarity: 'pos' }, // 16
    { phrase: 'very good', polarity: 'pos' }, // 15
    { phrase: 'food was outstanding', polarity: 'pos' }, // 13
    { phrase: 'amazing', polarity: 'pos' }, // 13
    { phrase: 'everything was delicious', polarity: 'pos' }, // 12
    { phrase: 'excellent food', polarity: 'pos' }, // 12
    { phrase: 'so good', polarity: 'pos' }, // 12
    { phrase: 'good', polarity: 'pos' }, // 11
    { phrase: 'good food', polarity: 'pos' }, // 11
    { phrase: 'food was very good', polarity: 'pos' }, // 11
    { phrase: 'food was phenomenal', polarity: 'pos' }, // 9
    { phrase: 'tasty', polarity: 'pos' }, // 9
    { phrase: 'to die for', polarity: 'pos' }, // 8
    { phrase: 'bursting with flavor', polarity: 'pos' }, // 8
    { phrase: 'food was fantastic', polarity: 'pos' }, // 7
    { phrase: 'full of flavor', polarity: 'pos' }, // 7
    { phrase: 'very delicious', polarity: 'pos' }, // 7
    { phrase: 'very tasty', polarity: 'pos' }, // 7
    { phrase: 'great flavor', polarity: 'pos' }, // 7
    { phrase: 'food is always great', polarity: 'pos' }, // 7
    { phrase: 'really good', polarity: 'pos' }, // 6
    { phrase: 'outstanding', polarity: 'pos' }, // 6
    { phrase: 'awesome', polarity: 'pos' }, // 5
    { phrase: 'incredible', polarity: 'pos' }, // 5
    { phrase: 'tender, juicy', polarity: 'pos' }, // 5
    { phrase: 'dry', polarity: 'neg' }, // 5
    { phrase: 'juicy', polarity: 'pos' }, // 5
    { phrase: 'no flavor', polarity: 'neg' }, // 5
    { phrase: 'amazing food', polarity: 'pos' }, // 5
    { phrase: 'food was wonderful', polarity: 'pos' }, // 4
    { phrase: 'food was exceptional', polarity: 'pos' }, // 4
    { phrase: 'very flavorful', polarity: 'pos' }, // 4
    { phrase: 'so delicious', polarity: 'pos' }, // 4
    { phrase: 'great', polarity: 'pos' }, // 4
    { phrase: 'food was awesome', polarity: 'pos' }, // 4
    { phrase: 'food quality', polarity: 'pos' }, // 4
    { phrase: 'food was terrible', polarity: 'neg' }, // 4
    { phrase: 'delicious meal', polarity: 'pos' }, // 4
    { phrase: 'fabulous', polarity: 'pos' }, // 4
    { phrase: 'bland', polarity: 'neg' }, // 4
    { phrase: 'always delicious', polarity: 'pos' }, // 4
    { phrase: 'food was perfect', polarity: 'pos' }, // 4
    { phrase: 'food was mediocre', polarity: 'neg' }, // 4
    { phrase: 'exceptional', polarity: 'pos' }, // 4
    { phrase: 'food is delicious', polarity: 'pos' }, // 4
    { phrase: 'fantastic', polarity: 'pos' }, // 4
    { phrase: 'superb', polarity: 'pos' }, // 4
    { phrase: 'food was on point', polarity: 'pos' }, // 4
    { phrase: 'really delicious', polarity: 'pos' }, // 4
    { phrase: 'incredibly delicious', polarity: 'pos' }, // 4
    { phrase: 'food was absolutely delicious', polarity: 'pos' }, // 4
    { phrase: 'food is amazing', polarity: 'pos' }, // 4
    { phrase: 'seasoned to perfection', polarity: 'pos' }, // 4
    { phrase: 'wonderful', polarity: 'pos' }, // 4
    { phrase: 'flavor', polarity: 'neg' }, // 4
    { phrase: 'perfect', polarity: 'pos' }, // 4
    { phrase: 'tasteless', polarity: 'neg' }, // 4
    { phrase: 'well-seasoned', polarity: 'pos' }, // 3
    { phrase: 'great taste', polarity: 'pos' }, // 3
    { phrase: 'succulent', polarity: 'pos' }, // 3
    { phrase: 'too much salt', polarity: 'neg' }, // 3
    { phrase: 'food is good', polarity: 'pos' }, // 3
    { phrase: 'melt in your mouth', polarity: 'pos' }, // 3
    { phrase: 'food delicious', polarity: 'pos' }, // 3
    { phrase: 'food perfect', polarity: 'pos' }, // 3
    { phrase: 'food excellent', polarity: 'pos' }, // 3
    { phrase: 'packed with flavor', polarity: 'pos' }, // 3
    { phrase: 'food was absolutely amazing', polarity: 'pos' }, // 3
    { phrase: 'phenomenal', polarity: 'pos' }, // 3
    { phrase: 'food is always excellent', polarity: 'pos' }, // 3
    { phrase: 'melted in my mouth', polarity: 'pos' }, // 3
    { phrase: 'spectacular', polarity: 'pos' }, // 3
    { phrase: 'well seasoned', polarity: 'pos' }, // 3
    { phrase: 'food amazing', polarity: 'pos' }, // 3
    { phrase: 'disappointing', polarity: 'neg' }, // 3
    { phrase: 'food was bland', polarity: 'neg' }, // 3
    { phrase: 'food was fabulous', polarity: 'pos' }, // 3
    { phrase: 'food is always delicious', polarity: 'pos' }, // 3
    { phrase: 'perfectly seasoned', polarity: 'pos' }, // 3
    { phrase: 'on point', polarity: 'pos' }, // 3
    { phrase: 'tasted very good', polarity: 'pos' }, // 3
    { phrase: 'tasted great', polarity: 'pos' }, // 3
    { phrase: 'mediocre', polarity: 'neg' }, // 3
    { phrase: 'food was incredible', polarity: 'pos' }, // 3
    { phrase: 'food was terrific', polarity: 'pos' }, // 3
    { phrase: 'magnificent', polarity: 'pos' }, // 3
    { phrase: 'quality food', polarity: 'pos' }, // 3
    { phrase: 'everything was amazing', polarity: 'pos' }, // 3
    { phrase: 'food was top notch', polarity: 'pos' }, // 3
    { phrase: 'food taste', polarity: 'pos' }, // 3
    { phrase: 'quality of the food', polarity: 'pos' }, // 2
  ]},
  { axis: 'attribute', sub: 'food safety', phrases: [
    { phrase: 'fresh', polarity: 'pos' }, // 3
    { phrase: 'food poisoning', polarity: 'neg' }, // 3
  ]},
  { axis: 'attribute', sub: 'friendly', phrases: [
    { phrase: 'friendly', polarity: 'pos' }, // 73
    { phrase: 'very friendly', polarity: 'pos' }, // 18
    { phrase: 'personable', polarity: 'pos' }, // 16
    { phrase: 'courteous', polarity: 'pos' }, // 13
    { phrase: 'polite', polarity: 'pos' }, // 13
    { phrase: 'kind', polarity: 'pos' }, // 12
    { phrase: 'very personable', polarity: 'pos' }, // 10
    { phrase: 'very kind', polarity: 'pos' }, // 10
    { phrase: 'very nice', polarity: 'pos' }, // 9
    { phrase: 'super friendly', polarity: 'pos' }, // 8
    { phrase: 'so kind', polarity: 'pos' }, // 8
    { phrase: 'pleasant', polarity: 'pos' }, // 7
    { phrase: 'very polite', polarity: 'pos' }, // 7
    { phrase: 'welcoming', polarity: 'pos' }, // 7
    { phrase: 'amazing', polarity: 'pos' }, // 7
    { phrase: 'engaging', polarity: 'pos' }, // 6
    { phrase: 'nice', polarity: 'pos' }, // 6
    { phrase: 'wonderful', polarity: 'pos' }, // 6
    { phrase: 'awesome', polarity: 'pos' }, // 5
    { phrase: 'very helpful', polarity: 'pos' }, // 5
    { phrase: 'great attitude', polarity: 'pos' }, // 5
    { phrase: 'sweet', polarity: 'pos' }, // 5
    { phrase: 'very pleasant', polarity: 'pos' }, // 5
    { phrase: 'friendly demeanor', polarity: 'pos' }, // 5
    { phrase: 'so friendly', polarity: 'pos' }, // 4
    { phrase: 'staff was friendly', polarity: 'pos' }, // 4
    { phrase: 'funny', polarity: 'pos' }, // 3
    { phrase: 'patient', polarity: 'pos' }, // 3
    { phrase: 'great personality', polarity: 'pos' }, // 3
    { phrase: 'great', polarity: 'pos' }, // 3
    { phrase: 'very sweet', polarity: 'pos' }, // 3
    { phrase: 'friendliness', polarity: 'pos' }, // 3
    { phrase: 'so nice', polarity: 'pos' }, // 3
    { phrase: 'fantastic', polarity: 'pos' }, // 3
    { phrase: 'great sense of humor', polarity: 'pos' }, // 3
    { phrase: 'great hospitality', polarity: 'pos' }, // 3
    { phrase: 'hospitable', polarity: 'pos' }, // 3
    { phrase: 'extremely friendly', polarity: 'pos' }, // 3
    { phrase: 'so pleasant', polarity: 'pos' }, // 3
    { phrase: 'hospitality', polarity: 'pos' }, // 3
  ]},
  { axis: 'attribute', sub: 'knowledge', phrases: [
    { phrase: 'knowledgeable', polarity: 'pos' }, // 44
    { phrase: 'great recommendations', polarity: 'pos' }, // 14
    { phrase: 'very knowledgeable', polarity: 'pos' }, // 12
    { phrase: 'knowledgeable about the menu', polarity: 'pos' }, // 10
    { phrase: 'great suggestions', polarity: 'pos' }, // 7
    { phrase: 'informative', polarity: 'pos' }, // 6
    { phrase: 'excellent recommendations', polarity: 'pos' }, // 6
    { phrase: 'knowledge', polarity: 'pos' }, // 4
    { phrase: 'very knowledgeable about the menu', polarity: 'pos' }, // 4
    { phrase: 'very informative', polarity: 'pos' }, // 3
    { phrase: 'knowledgeable of the menu', polarity: 'pos' }, // 3
    { phrase: 'knowledge of the menu', polarity: 'pos' }, // 3
  ]},
  { axis: 'attribute', sub: 'pace', phrases: [
    { phrase: 'never felt rushed', polarity: 'pos' }, // 4
    { phrase: 'didn\'t rush us', polarity: 'pos' }, // 3
  ]},
  { axis: 'attribute', sub: 'portion', phrases: [
    { phrase: 'plentiful', polarity: 'pos' }, // 3
    { phrase: 'generous portion', polarity: 'pos' }, // 3
  ]},
  { axis: 'attribute', sub: 'presentation', phrases: [
    { phrase: 'beautifully presented', polarity: 'pos' }, // 6
    { phrase: 'perfectly prepared', polarity: 'pos' }, // 5
    { phrase: 'made to perfection', polarity: 'pos' }, // 3
    { phrase: 'outstanding', polarity: 'pos' }, // 3
  ]},
  { axis: 'attribute', sub: 'professional', phrases: [
    { phrase: 'great service', polarity: 'pos' }, // 78
    { phrase: 'professional', polarity: 'pos' }, // 64
    { phrase: 'excellent service', polarity: 'pos' }, // 47
    { phrase: 'excellent', polarity: 'pos' }, // 35
    { phrase: 'service was great', polarity: 'pos' }, // 25
    { phrase: 'amazing service', polarity: 'pos' }, // 21
    { phrase: 'service was excellent', polarity: 'pos' }, // 21
    { phrase: 'professionalism', polarity: 'pos' }, // 20
    { phrase: 'exceptional service', polarity: 'pos' }, // 18
    { phrase: 'amazing', polarity: 'pos' }, // 16
    { phrase: 'outstanding', polarity: 'pos' }, // 15
    { phrase: 'exceptional', polarity: 'pos' }, // 14
    { phrase: 'very professional', polarity: 'pos' }, // 14
    { phrase: 'went above and beyond', polarity: 'pos' }, // 11
    { phrase: 'top notch', polarity: 'pos' }, // 11
    { phrase: 'service', polarity: 'pos' }, // 11
    { phrase: 'top notch service', polarity: 'pos' }, // 10
    { phrase: 'outstanding service', polarity: 'pos' }, // 9
    { phrase: 'fantastic', polarity: 'pos' }, // 9
    { phrase: 'impeccable service', polarity: 'pos' }, // 9
    { phrase: 'fantastic service', polarity: 'pos' }, // 8
    { phrase: 'service was fantastic', polarity: 'pos' }, // 8
    { phrase: 'phenomenal', polarity: 'pos' }, // 8
    { phrase: 'service was amazing', polarity: 'pos' }, // 8
    { phrase: 'service was impeccable', polarity: 'pos' }, // 8
    { phrase: 'great', polarity: 'pos' }, // 8
    { phrase: 'superb', polarity: 'pos' }, // 7
    { phrase: 'service was outstanding', polarity: 'pos' }, // 7
    { phrase: 'food and service was excellent', polarity: 'pos' }, // 6
    { phrase: 'service was good', polarity: 'pos' }, // 5
    { phrase: 'good service', polarity: 'pos' }, // 5
    { phrase: 'wonderful service', polarity: 'pos' }, // 5
    { phrase: 'poor service', polarity: 'neg' }, // 4
    { phrase: 'absolutely amazing', polarity: 'pos' }, // 4
    { phrase: 'awesome service', polarity: 'pos' }, // 4
    { phrase: 'perfect', polarity: 'pos' }, // 4
    { phrase: 'service is top notch', polarity: 'pos' }, // 4
    { phrase: 'service was exceptional', polarity: 'pos' }, // 4
    { phrase: 'service was top notch', polarity: 'pos' }, // 4
    { phrase: 'best service', polarity: 'pos' }, // 4
    { phrase: 'terrible service', polarity: 'neg' }, // 4
    { phrase: 'food and service were excellent', polarity: 'pos' }, // 4
    { phrase: 'incredible service', polarity: 'pos' }, // 4
    { phrase: 'respectful', polarity: 'pos' }, // 4
    { phrase: 'extremely professional', polarity: 'pos' }, // 4
    { phrase: 'service was stellar', polarity: 'pos' }, // 4
    { phrase: 'polite', polarity: 'pos' }, // 3
    { phrase: 'professional service', polarity: 'pos' }, // 3
    { phrase: 'service was very good', polarity: 'pos' }, // 3
    { phrase: 'incredible', polarity: 'pos' }, // 3
    { phrase: 'unprofessional', polarity: 'neg' }, // 3
    { phrase: 'service was superb', polarity: 'pos' }, // 3
    { phrase: 'consummate professional', polarity: 'pos' }, // 3
    { phrase: 'service was perfect', polarity: 'pos' }, // 3
    { phrase: 'wonderful job', polarity: 'pos' }, // 3
    { phrase: 'excellent food and service', polarity: 'pos' }, // 3
  ]},
  { axis: 'attribute', sub: 'rude', phrases: [
    { phrase: 'rude', polarity: 'neg' }, // 16
    { phrase: 'extremely rude', polarity: 'neg' }, // 3
  ]},
  { axis: 'attribute', sub: 'speed', phrases: [
    { phrase: 'service was slow', polarity: 'neg' }, // 15
    { phrase: 'efficient', polarity: 'pos' }, // 11
    { phrase: 'service was great', polarity: 'pos' }, // 6
    { phrase: 'service was very slow', polarity: 'neg' }, // 5
    { phrase: 'quick', polarity: 'pos' }, // 5
    { phrase: 'slow service', polarity: 'neg' }, // 5
    { phrase: 'fast', polarity: 'pos' }, // 5
    { phrase: 'seated immediately', polarity: 'pos' }, // 5
    { phrase: 'prompt', polarity: 'pos' }, // 4
    { phrase: 'extremely slow', polarity: 'neg' }, // 4
    { phrase: 'service was prompt', polarity: 'pos' }, // 4
    { phrase: 'timely', polarity: 'pos' }, // 3
    { phrase: 'fast service', polarity: 'pos' }, // 3
    { phrase: 'service was quick', polarity: 'pos' }, // 3
    { phrase: 'service was a bit slow', polarity: 'neg' }, // 3
    { phrase: 'promptly seated', polarity: 'pos' }, // 3
  ]},
  { axis: 'attribute', sub: 'temp', phrases: [
    { phrase: 'cooked to perfection', polarity: 'pos' }, // 59
    { phrase: 'cooked perfectly', polarity: 'pos' }, // 33
    { phrase: 'perfectly cooked', polarity: 'pos' }, // 20
    { phrase: 'overcooked', polarity: 'neg' }, // 18
    { phrase: 'hot', polarity: 'pos' }, // 10
    { phrase: 'cold', polarity: 'neg' }, // 8
    { phrase: 'undercooked', polarity: 'neg' }, // 7
    { phrase: 'over cooked', polarity: 'neg' }, // 6
    { phrase: 'cooked to absolute perfection', polarity: 'pos' }, // 5
    { phrase: 'medium rare', polarity: 'neu' }, // 5
    { phrase: 'steak was overcooked', polarity: 'neg' }, // 5
    { phrase: 'cooked perfect', polarity: 'pos' }, // 5
    { phrase: 'food was cooked perfectly', polarity: 'pos' }, // 5
    { phrase: 'food was cooked to perfection', polarity: 'pos' }, // 5
    { phrase: 'cooked well', polarity: 'pos' }, // 4
    { phrase: 'piping hot', polarity: 'pos' }, // 4
    { phrase: 'food was hot', polarity: 'pos' }, // 4
    { phrase: 'they were cold', polarity: 'neg' }, // 3
    { phrase: 'steak was cooked perfectly', polarity: 'pos' }, // 3
    { phrase: 'under cooked', polarity: 'neg' }, // 3
    { phrase: 'temp', polarity: 'neg' }, // 3
    { phrase: 'steaks were overcooked', polarity: 'neg' }, // 3
    { phrase: 'came out cold', polarity: 'neg' }, // 3
  ]},
  // ── PRODUCT ───────────────────────────────────────────────────
  { axis: 'product', sub: 'apps', phrases: [
    { phrase: 'calamari', polarity: 'neu' }, // 15
    { phrase: 'stuffed mushrooms', polarity: 'neu' }, // 9
    { phrase: 'lamb chops', polarity: 'neu' }, // 5
    { phrase: 'spicy shrimp', polarity: 'neu' }, // 5
    { phrase: 'fried calamari', polarity: 'neu' }, // 4
    { phrase: 'goat cheese and artichoke dip', polarity: 'neu' }, // 4
    { phrase: 'crabmeat stuffed mushrooms', polarity: 'neu' }, // 3
    { phrase: 'crab stuffed mushrooms', polarity: 'neu' }, // 3
    { phrase: 'artichoke dip', polarity: 'neu' }, // 3
  ]},
  { axis: 'product', sub: 'apps', item: 'crab cake', phrases: [
    { phrase: 'crab cakes', polarity: 'neu' }, // 33
    { phrase: 'crab cake', polarity: 'neu' }, // 2
  ]},
  { axis: 'product', sub: 'apps', item: 'shrimp cocktail', phrases: [
    { phrase: 'shrimp cocktail', polarity: 'neu' }, // 6
  ]},
  { axis: 'product', sub: 'beef', phrases: [
    { phrase: 'lamb chops', polarity: 'neu' }, // 3
  ]},
  { axis: 'product', sub: 'beef', item: 'filet', phrases: [
    { phrase: 'filet', polarity: 'neu' }, // 13
    { phrase: 'filets', polarity: 'neu' }, // 4
    { phrase: 'filet mignon', polarity: 'neu' }, // 4
  ]},
  { axis: 'product', sub: 'bread', phrases: [
    { phrase: 'bread', polarity: 'neu' }, // 9
  ]},
  { axis: 'product', sub: 'chicken', phrases: [
    { phrase: 'stuffed chicken', polarity: 'neu' }, // 14
    { phrase: 'stuffed chicken breast', polarity: 'neu' }, // 8
    { phrase: 'chicken', polarity: 'neu' }, // 8
    { phrase: 'chicken breast', polarity: 'neu' }, // 4
    { phrase: 'chicken sandwich', polarity: 'neu' }, // 3
  ]},
  { axis: 'product', sub: 'desserts', phrases: [
    { phrase: 'dessert', polarity: 'neu' }, // 17
    { phrase: 'crème brûlée', polarity: 'neu' }, // 14
    { phrase: 'creme brulee', polarity: 'neu' }, // 10
    { phrase: 'complimentary dessert', polarity: 'pos' }, // 8
    { phrase: 'chocolate sin cake', polarity: 'neu' }, // 7
    { phrase: 'chocolate cake', polarity: 'neu' }, // 6
    { phrase: 'cheese cake', polarity: 'neu' }, // 6
    { phrase: 'free dessert', polarity: 'pos' }, // 6
    { phrase: 'desserts', polarity: 'neu' }, // 6
    { phrase: 'carrot cake', polarity: 'neu' }, // 5
    { phrase: 'special dessert', polarity: 'pos' }, // 4
    { phrase: 'creme brûlée', polarity: 'neu' }, // 4
    { phrase: 'key lime pie', polarity: 'neu' }, // 3
  ]},
  { axis: 'product', sub: 'desserts', item: 'bread pudding', phrases: [
    { phrase: 'bread pudding', polarity: 'neu' }, // 12
  ]},
  { axis: 'product', sub: 'desserts', item: 'cheesecake', phrases: [
    { phrase: 'cheesecake', polarity: 'neu' }, // 39
    { phrase: 'complimentary cheesecake', polarity: 'pos' }, // 3
    { phrase: 'mini cheesecake', polarity: 'neu' }, // 3
    { phrase: 'cheesecake dessert', polarity: 'neu' }, // 2
  ]},
  { axis: 'product', sub: 'fries', phrases: [
    { phrase: 'fries', polarity: 'neu' }, // 4
    { phrase: 'zucchini fries', polarity: 'neu' }, // 3
  ]},
  { axis: 'product', sub: 'pasta', phrases: [
    { phrase: 'ravioli', polarity: 'neu' }, // 3
  ]},
  { axis: 'product', sub: 'pasta', item: 'lobster mac', phrases: [
    { phrase: 'lobster mac', polarity: 'neu' }, // 3
  ]},
  { axis: 'product', sub: 'pasta', item: 'mac and cheese', phrases: [
    { phrase: 'lobster mac and cheese', polarity: 'neu' }, // 3
  ]},
  { axis: 'product', sub: 'pork', phrases: [
    { phrase: 'lamb chops', polarity: 'neu' }, // 16
    { phrase: 'lamb', polarity: 'neu' }, // 3
  ]},
  { axis: 'product', sub: 'salads', phrases: [
    { phrase: 'salad', polarity: 'neu' }, // 17
    { phrase: 'salads', polarity: 'neu' }, // 11
    { phrase: 'chopped salad', polarity: 'neu' }, // 9
    { phrase: 'steakhouse salad', polarity: 'neu' }, // 4
    { phrase: 'steak house salad', polarity: 'neu' }, // 3
    { phrase: 'cesar salad', polarity: 'neu' }, // 3
  ]},
  { axis: 'product', sub: 'salads', item: 'caesar salad', phrases: [
    { phrase: 'caesar salad', polarity: 'neu' }, // 30
  ]},
  { axis: 'product', sub: 'salads', item: 'wedge salad', phrases: [
    { phrase: 'wedge salad', polarity: 'neu' }, // 11
  ]},
  { axis: 'product', sub: 'seafood', phrases: [
    { phrase: 'lobster', polarity: 'neu' }, // 22
    { phrase: 'sea bass', polarity: 'neu' }, // 19
    { phrase: 'shrimp', polarity: 'neu' }, // 18
    { phrase: 'spicy shrimp', polarity: 'neu' }, // 14
    { phrase: 'seafood tower', polarity: 'neu' }, // 13
    { phrase: 'salmon', polarity: 'neu' }, // 12
    { phrase: 'steak and lobster', polarity: 'neu' }, // 7
    { phrase: 'salmon and shrimp', polarity: 'neu' }, // 6
    { phrase: 'surf and turf', polarity: 'neu' }, // 6
    { phrase: 'seafood', polarity: 'neu' }, // 6
    { phrase: 'seared ahi tuna', polarity: 'neu' }, // 5
    { phrase: 'bbq shrimp', polarity: 'neu' }, // 4
    { phrase: 'calamari', polarity: 'neu' }, // 3
    { phrase: 'tuna', polarity: 'neu' }, // 3
    { phrase: 'lobster was good', polarity: 'pos' }, // 3
    { phrase: 'lamb chops', polarity: 'neu' }, // 3
    { phrase: 'lobster was overcooked', polarity: 'neg' }, // 3
    { phrase: 'ahi tuna', polarity: 'neu' }, // 2
  ]},
  { axis: 'product', sub: 'seafood', item: 'filet', phrases: [
    { phrase: 'filet and lobster', polarity: 'neu' }, // 3
  ]},
  { axis: 'product', sub: 'seafood', item: 'lobster tail', phrases: [
    { phrase: 'lobster tail', polarity: 'neu' }, // 26
    { phrase: 'lobster tails', polarity: 'neu' }, // 5
  ]},
  { axis: 'product', sub: 'seafood', item: 'mac and cheese', phrases: [
    { phrase: 'lobster mac and cheese', polarity: 'neu' }, // 3
  ]},
  { axis: 'product', sub: 'seafood', item: 'shrimp cocktail', phrases: [
    { phrase: 'shrimp cocktail', polarity: 'neu' }, // 5
  ]},
  { axis: 'product', sub: 'sides', phrases: [
    { phrase: 'sweet potato casserole', polarity: 'neu' }, // 40
    { phrase: 'garlic mashed potatoes', polarity: 'neu' }, // 32
    { phrase: 'mashed potatoes', polarity: 'neu' }, // 30
    { phrase: 'asparagus', polarity: 'neu' }, // 22
    { phrase: 'sides', polarity: 'neu' }, // 16
    { phrase: 'au gratin potatoes', polarity: 'neu' }, // 15
    { phrase: 'brussel sprouts', polarity: 'neu' }, // 14
    { phrase: 'baked potato', polarity: 'neu' }, // 14
    { phrase: 'brussels sprouts', polarity: 'neu' }, // 13
    { phrase: 'potatoes au gratin', polarity: 'neu' }, // 12
    { phrase: 'mushrooms', polarity: 'neu' }, // 9
    { phrase: 'creamy mashed potatoes', polarity: 'pos' }, // 7
    { phrase: 'sides were good', polarity: 'pos' }, // 6
    { phrase: 'sides were great', polarity: 'pos' }, // 6
    { phrase: 'cream spinach', polarity: 'neu' }, // 6
    { phrase: 'garlic mash', polarity: 'neu' }, // 6
    { phrase: 'mac & cheese', polarity: 'neu' }, // 5
    { phrase: 'grilled asparagus', polarity: 'neu' }, // 5
    { phrase: 'spinach', polarity: 'neu' }, // 4
    { phrase: 'loaded baked potato', polarity: 'neu' }, // 4
    { phrase: 'baked potatoes', polarity: 'neu' }, // 4
    { phrase: 'amazing sides', polarity: 'pos' }, // 3
    { phrase: 'mac n cheese', polarity: 'neu' }, // 3
    { phrase: 'zucchini fries', polarity: 'neu' }, // 3
    { phrase: 'sweet potato', polarity: 'neu' }, // 3
    { phrase: 'mash potatoes', polarity: 'neu' }, // 3
    { phrase: 'cremini mushrooms', polarity: 'neu' }, // 3
    { phrase: 'creamy spinach', polarity: 'neu' }, // 2
  ]},
  { axis: 'product', sub: 'sides', item: 'creamed spinach', phrases: [
    { phrase: 'creamed spinach', polarity: 'neu' }, // 49
  ]},
  { axis: 'product', sub: 'sides', item: 'lobster mac', phrases: [
    { phrase: 'lobster mac & cheese', polarity: 'neu' }, // 8
    { phrase: 'lobster mac', polarity: 'neu' }, // 7
    { phrase: 'lobster mac n cheese', polarity: 'neu' }, // 2
  ]},
  { axis: 'product', sub: 'sides', item: 'mac and cheese', phrases: [
    { phrase: 'lobster mac and cheese', polarity: 'neu' }, // 19
    { phrase: 'mac and cheese', polarity: 'neu' }, // 8
  ]},
  { axis: 'product', sub: 'soup', phrases: [
    { phrase: 'french onion soup', polarity: 'neu' }, // 16
    { phrase: 'lobster bisque', polarity: 'neu' }, // 16
    { phrase: 'soup', polarity: 'neu' }, // 3
  ]},
  { axis: 'product', sub: 'steak', phrases: [
    { phrase: 'steak', polarity: 'neu' }, // 76
    { phrase: 'steaks', polarity: 'neu' }, // 39
    { phrase: 'steak sandwich', polarity: 'neu' }, // 18
    { phrase: 'steaks were cooked to perfection', polarity: 'pos' }, // 17
    { phrase: 'great steak', polarity: 'pos' }, // 17
    { phrase: 'best steak', polarity: 'pos' }, // 14
    { phrase: 'new york strip', polarity: 'neu' }, // 13
    { phrase: 'steak was cooked perfectly', polarity: 'pos' }, // 11
    { phrase: 'great steaks', polarity: 'pos' }, // 10
    { phrase: 'perfectly cooked steaks', polarity: 'pos' }, // 10
    { phrase: 'best steak i\'ve ever had', polarity: 'pos' }, // 9
    { phrase: 'steaks were perfect', polarity: 'pos' }, // 9
    { phrase: 'good steak', polarity: 'pos' }, // 7
    { phrase: 'steaks were great', polarity: 'pos' }, // 7
    { phrase: 'steak was cooked to perfection', polarity: 'pos' }, // 7
    { phrase: 'steak was perfect', polarity: 'pos' }, // 5
    { phrase: 'steaks were cooked perfectly', polarity: 'pos' }, // 5
    { phrase: 'excellent steaks', polarity: 'pos' }, // 5
    { phrase: 'steak was great', polarity: 'pos' }, // 5
    { phrase: 'steaks were amazing', polarity: 'pos' }, // 5
    { phrase: 'delicious steak', polarity: 'pos' }, // 5
    { phrase: 'steak was excellent', polarity: 'pos' }, // 5
    { phrase: 'steak was amazing', polarity: 'pos' }, // 5
    { phrase: 'steak was good', polarity: 'pos' }, // 4
    { phrase: 'cowboy steak', polarity: 'neu' }, // 4
    { phrase: 'best steaks', polarity: 'pos' }, // 4
    { phrase: 'fillet', polarity: 'neu' }, // 4
    { phrase: 'best steak in town', polarity: 'pos' }, // 4
    { phrase: 'best new york strip', polarity: 'pos' }, // 3
    { phrase: 'best steak i\'ve had', polarity: 'pos' }, // 3
    { phrase: 'steak was delicious', polarity: 'pos' }, // 3
    { phrase: 'best steak i have ever had', polarity: 'pos' }, // 3
    { phrase: 'amazing steak', polarity: 'pos' }, // 3
    { phrase: 'steak and shrimp', polarity: 'neu' }, // 3
    { phrase: 'best steak i ever had', polarity: 'pos' }, // 3
    { phrase: 'cowboy rib eye', polarity: 'neu' }, // 3
    { phrase: 'rib eye', polarity: 'neu' }, // 3
    { phrase: 'steak cooked perfectly', polarity: 'pos' }, // 3
    { phrase: 'delicious steaks', polarity: 'pos' }, // 3
    { phrase: 'steaks were over cooked', polarity: 'neg' }, // 3
    { phrase: 'steak was undercooked', polarity: 'neg' }, // 3
    { phrase: 'petite fillet', polarity: 'neu' }, // 3
    { phrase: 'delicious', polarity: 'pos' }, // 3
    { phrase: 'steaks were outstanding', polarity: 'pos' }, // 3
    { phrase: 'excellent steak', polarity: 'pos' }, // 3
    { phrase: 'well done steak', polarity: 'neu' }, // 2
  ]},
  { axis: 'product', sub: 'steak', item: 'filet', phrases: [
    { phrase: 'filet', polarity: 'neu' }, // 44
    { phrase: 'filet mignon', polarity: 'neu' }, // 19
    { phrase: 'petite filet', polarity: 'neu' }, // 13
    { phrase: 'petite filet mignon', polarity: 'neu' }, // 5
    { phrase: 'filet steak', polarity: 'neu' }, // 3
    { phrase: 'filets', polarity: 'neu' }, // 3
    { phrase: 'bone-in filet', polarity: 'neu' }, // 3
    { phrase: 'bone in filet', polarity: 'neu' }, // 3
    { phrase: '11oz filet', polarity: 'neu' }, // 3
  ]},
  { axis: 'product', sub: 'steak', item: 'ny strip', phrases: [
    { phrase: 'ny strip', polarity: 'neu' }, // 5
  ]},
  { axis: 'product', sub: 'steak', item: 'porterhouse', phrases: [
    { phrase: 'porterhouse steak', polarity: 'neu' }, // 10
    { phrase: 'porterhouse for two', polarity: 'neu' }, // 8
    { phrase: 'porterhouse for 2', polarity: 'neu' }, // 5
    { phrase: 'porterhouse', polarity: 'neu' }, // 5
  ]},
  { axis: 'product', sub: 'steak', item: 'ribeye', phrases: [
    { phrase: 'ribeye', polarity: 'neu' }, // 37
    { phrase: 'cowboy ribeye', polarity: 'neu' }, // 29
    { phrase: 'ribeye steak', polarity: 'neu' }, // 11
    { phrase: '16 oz ribeye', polarity: 'neu' }, // 3
  ]},
  { axis: 'product', sub: 'steak', item: 't-bone', phrases: [
    { phrase: 't-bone steak', polarity: 'neu' }, // 6
    { phrase: 't-bone', polarity: 'neu' }, // 4
  ]},
  { axis: 'product', sub: 'steak', item: 'tomahawk', phrases: [
    { phrase: 'tomahawk steak', polarity: 'neu' }, // 8
    { phrase: 'tomahawk ribeye', polarity: 'neu' }, // 6
    { phrase: 'tomahawk', polarity: 'neu' }, // 5
  ]},
  // ── BEVERAGE ──────────────────────────────────────────────────
  { axis: 'beverage', sub: 'beer', phrases: [
    { phrase: 'beer', polarity: 'neu' }, // 3
  ]},
  { axis: 'beverage', sub: 'champagne', phrases: [
    { phrase: 'champagne', polarity: 'neu' }, // 5
    { phrase: 'complimentary champagne', polarity: 'pos' }, // 3
  ]},
  { axis: 'beverage', sub: 'cocktail', phrases: [
    { phrase: 'cocktails', polarity: 'neu' }, // 19
    { phrase: 'blueberry mojito', polarity: 'neu' }, // 7
    { phrase: 'great drinks', polarity: 'pos' }, // 6
    { phrase: 'blackberry sidecar', polarity: 'neu' }, // 6
    { phrase: 'great cocktails', polarity: 'pos' }, // 5
    { phrase: 'cocktail', polarity: 'neu' }, // 5
    { phrase: 'lemon drop', polarity: 'neu' }, // 4
    { phrase: 'delicious cocktails', polarity: 'pos' }, // 3
    { phrase: 'old fashioned', polarity: 'neu' }, // 3
    { phrase: 'drinks', polarity: 'pos' }, // 3
    { phrase: 'old fashion', polarity: 'neu' }, // 2
  ]},
  { axis: 'beverage', sub: 'coffee', phrases: [
    { phrase: 'cappuccino', polarity: 'neu' }, // 3
  ]},
  { axis: 'beverage', sub: 'margarita', phrases: [
    { phrase: 'margarita', polarity: 'neu' }, // 4
  ]},
  { axis: 'beverage', sub: 'martini', phrases: [
    { phrase: 'pomegranate martini', polarity: 'neu' }, // 7
    { phrase: 'espresso martini', polarity: 'neu' }, // 5
    { phrase: 'expresso martini', polarity: 'neu' }, // 3
  ]},
  { axis: 'beverage', sub: 'nab', phrases: [
    { phrase: 'drinks', polarity: 'neu' }, // 5
    { phrase: 'drinks were delicious', polarity: 'pos' }, // 4
    { phrase: 'drinks', polarity: 'pos' }, // 3
    { phrase: 'drinks were good', polarity: 'pos' }, // 3
  ]},
  { axis: 'beverage', sub: 'wine', phrases: [
    { phrase: 'wine', polarity: 'neu' }, // 8
    { phrase: 'glass of wine', polarity: 'neu' }, // 6
    { phrase: 'red wine', polarity: 'neu' }, // 3
    { phrase: 'bottle of wine', polarity: 'neu' }, // 3
    { phrase: 'drinks were great', polarity: 'pos' }, // 3
  ]},
  // ── AMBIANCE ──────────────────────────────────────────────────
  { axis: 'ambiance', sub: 'appearance', phrases: [
    { phrase: 'great place', polarity: 'pos' }, // 8
    { phrase: 'great atmosphere', polarity: 'pos' }, // 5
    { phrase: 'beautiful restaurant', polarity: 'pos' }, // 4
    { phrase: 'great ambiance', polarity: 'pos' }, // 3
    { phrase: 'good vibe', polarity: 'pos' }, // 3
  ]},
  { axis: 'ambiance', sub: 'decor', phrases: [
    { phrase: 'great atmosphere', polarity: 'pos' }, // 22
    { phrase: 'atmosphere', polarity: 'pos' }, // 13
    { phrase: 'atmosphere was great', polarity: 'pos' }, // 6
    { phrase: 'great ambiance', polarity: 'pos' }, // 6
    { phrase: 'great ambience', polarity: 'pos' }, // 5
    { phrase: 'rose petals on the table', polarity: 'pos' }, // 5
    { phrase: 'ambience', polarity: 'pos' }, // 5
    { phrase: 'ambiance', polarity: 'neu' }, // 5
    { phrase: 'ambiance', polarity: 'pos' }, // 5
    { phrase: 'ambiance was nice', polarity: 'pos' }, // 4
    { phrase: 'nice atmosphere', polarity: 'pos' }, // 4
    { phrase: 'amazing atmosphere', polarity: 'pos' }, // 4
    { phrase: 'beautiful', polarity: 'pos' }, // 3
    { phrase: 'atmosphere was nice', polarity: 'pos' }, // 3
    { phrase: 'confetti on the table', polarity: 'pos' }, // 3
    { phrase: 'upscale atmosphere', polarity: 'pos' }, // 3
    { phrase: 'love the atmosphere', polarity: 'pos' }, // 3
    { phrase: 'atmosphere was amazing', polarity: 'pos' }, // 3
    { phrase: 'good atmosphere', polarity: 'pos' }, // 3
    { phrase: 'table was decorated', polarity: 'pos' }, // 3
  ]},
  { axis: 'ambiance', sub: 'dress code', phrases: [
    { phrase: 'dress code', polarity: 'neu' }, // 7
    { phrase: 'dress code', polarity: 'neg' }, // 5
  ]},
  { axis: 'ambiance', sub: 'light', phrases: [
    { phrase: 'dim lighting', polarity: 'neg' }, // 1
  ]},
  { axis: 'ambiance', sub: 'location', phrases: [
    { phrase: 'plenty of parking', polarity: 'pos' }, // 3
    { phrase: 'great location', polarity: 'pos' }, // 3
    { phrase: 'location', polarity: 'neu' }, // 2
  ]},
  { axis: 'ambiance', sub: 'noise', phrases: [
    { phrase: 'quiet', polarity: 'pos' }, // 5
    { phrase: 'loud', polarity: 'neg' }, // 5
    { phrase: 'noisy', polarity: 'neg' }, // 4
    { phrase: 'nice and quiet', polarity: 'pos' }, // 3
    { phrase: 'quiet booth', polarity: 'pos' }, // 3
    { phrase: 'very noisy', polarity: 'neg' }, // 3
  ]},
  // ── CONTEXT ───────────────────────────────────────────────────
  { axis: 'context', sub: 'anniversary', phrases: [
    { phrase: 'anniversary', polarity: 'neu' }, // 76
    { phrase: 'anniversary dinner', polarity: 'neu' }, // 29
    { phrase: 'celebrating our anniversary', polarity: 'neu' }, // 13
    { phrase: 'wedding anniversary', polarity: 'neu' }, // 9
    { phrase: 'special occasion', polarity: 'neu' }, // 7
    { phrase: 'celebrate our anniversary', polarity: 'neu' }, // 6
    { phrase: '25th anniversary', polarity: 'neu' }, // 5
    { phrase: 'special occasions', polarity: 'neu' }, // 5
    { phrase: 'date night', polarity: 'neu' }, // 5
    { phrase: 'celebrated our anniversary', polarity: 'neu' }, // 4
    { phrase: 'honeymoon', polarity: 'neu' }, // 4
    { phrase: 'anniversary celebration', polarity: 'neu' }, // 4
    { phrase: 'wonderful anniversary dinner', polarity: 'pos' }, // 3
    { phrase: 'great date night', polarity: 'pos' }, // 3
  ]},
  { axis: 'context', sub: 'birthday', phrases: [
    { phrase: 'birthday', polarity: 'neu' }, // 93
    { phrase: 'birthday celebration', polarity: 'neu' }, // 27
    { phrase: 'birthday dinner', polarity: 'neu' }, // 24
    { phrase: 'celebrating a birthday', polarity: 'neu' }, // 10
    { phrase: 'celebrate my birthday', polarity: 'neu' }, // 9
    { phrase: 'special occasion', polarity: 'neu' }, // 7
    { phrase: 'celebrated a birthday', polarity: 'neu' }, // 5
    { phrase: 'great birthday dinner', polarity: 'pos' }, // 4
    { phrase: 'husband\'s birthday', polarity: 'neu' }, // 4
    { phrase: 'wife\'s birthday', polarity: 'neu' }, // 4
    { phrase: 'celebrate a birthday', polarity: 'neu' }, // 4
    { phrase: 'great birthday celebration', polarity: 'pos' }, // 4
    { phrase: 'daughter\'s birthday', polarity: 'neu' }, // 4
    { phrase: 'celebrated my husband\'s birthday', polarity: 'neu' }, // 3
    { phrase: 'great birthday experience', polarity: 'pos' }, // 3
    { phrase: 'wonderful birthday dinner', polarity: 'pos' }, // 3
    { phrase: 'special occasions', polarity: 'neu' }, // 3
    { phrase: 'celebrating my husband\'s birthday', polarity: 'neu' }, // 3
    { phrase: 'celebrated my birthday', polarity: 'neu' }, // 3
    { phrase: 'son\'s birthday', polarity: 'neu' }, // 3
    { phrase: 'happy birthday confetti', polarity: 'pos' }, // 2
  ]},
  { axis: 'context', sub: 'dinner', phrases: [
    { phrase: 'dinner', polarity: 'neu' }, // 26
    { phrase: 'great dinner', polarity: 'pos' }, // 6
    { phrase: 'wonderful dinner', polarity: 'pos' }, // 3
    { phrase: 'amazing dinner', polarity: 'pos' }, // 3
  ]},
  { axis: 'context', sub: 'fathers-day', phrases: [
    { phrase: 'father\'s day', polarity: 'neu' }, // 9
  ]},
  { axis: 'context', sub: 'happy-hour', phrases: [
    { phrase: 'happy hour', polarity: 'neu' }, // 54
    { phrase: 'great happy hour', polarity: 'pos' }, // 5
  ]},
  { axis: 'context', sub: 'lunch', phrases: [
    { phrase: 'lunch', polarity: 'neu' }, // 3
  ]},
  { axis: 'context', sub: 'mothers-day', phrases: [
    { phrase: 'mother\'s day', polarity: 'neu' }, // 7
    { phrase: 'mother\'s day dinner', polarity: 'neu' }, // 5
    { phrase: 'mothers-day', polarity: 'neu' }, // 5
    { phrase: 'mothers day', polarity: 'neu' }, // 3
  ]},
  { axis: 'context', sub: 'new-years', phrases: [
    { phrase: 'new year\'s eve', polarity: 'neu' }, // 3
  ]},
  { axis: 'context', sub: 'prime-hour', phrases: [
    { phrase: 'very busy', polarity: 'neu' }, // 3
  ]},
  { axis: 'context', sub: 'sporting-event', phrases: [
    { phrase: 'before a reds game', polarity: 'neu' }, // 3
  ]},
  { axis: 'context', sub: 'thanksgiving', phrases: [
    { phrase: 'thanksgiving', polarity: 'neu' }, // 11
    { phrase: 'thanksgiving dinner', polarity: 'neu' }, // 11
  ]},
  { axis: 'context', sub: 'to-go', phrases: [
    { phrase: 'to-go', polarity: 'neu' }, // 3
  ]},
  { axis: 'context', sub: 'valentines', phrases: [
    { phrase: 'valentine\'s day', polarity: 'neu' }, // 7
    { phrase: 'valentines', polarity: 'neu' }, // 5
    { phrase: 'valentines dinner', polarity: 'neu' }, // 4
    { phrase: 'valentine\'s day dinner', polarity: 'neu' }, // 4
    { phrase: 'valentines day', polarity: 'neu' }, // 3
  ]},
  { axis: 'context', sub: 'weekend', phrases: [
    { phrase: 'saturday night', polarity: 'neu' }, // 3
  ]},
  // ── OUTCOME ───────────────────────────────────────────────────
  { axis: 'outcome', sub: 'affordable', phrases: [
    { phrase: 'great value', polarity: 'pos' }, // 9
    { phrase: 'worth every penny', polarity: 'pos' }, // 8
    { phrase: 'great deal', polarity: 'pos' }, // 3
    { phrase: 'worth the money', polarity: 'pos' }, // 3
    { phrase: 'excellent value', polarity: 'pos' }, // 3
    { phrase: 'reasonably priced', polarity: 'pos' }, // 3
    { phrase: 'good value', polarity: 'pos' }, // 3
  ]},
  { axis: 'outcome', sub: 'brand-love', phrases: [
    { phrase: 'great experience', polarity: 'pos' }, // 65
    { phrase: 'wonderful experience', polarity: 'pos' }, // 50
    { phrase: 'amazing experience', polarity: 'pos' }, // 36
    { phrase: 'great time', polarity: 'pos' }, // 35
    { phrase: 'amazing', polarity: 'pos' }, // 26
    { phrase: 'wonderful time', polarity: 'pos' }, // 18
    { phrase: 'everything was perfect', polarity: 'pos' }, // 14
    { phrase: 'great meal', polarity: 'pos' }, // 13
    { phrase: 'wonderful evening', polarity: 'pos' }, // 13
    { phrase: 'excellent experience', polarity: 'pos' }, // 13
    { phrase: 'great dining experience', polarity: 'pos' }, // 12
    { phrase: 'great', polarity: 'pos' }, // 12
    { phrase: 'love this place', polarity: 'pos' }, // 12
    { phrase: 'wonderful meal', polarity: 'pos' }, // 12
    { phrase: 'wonderful dining experience', polarity: 'pos' }, // 11
    { phrase: 'never disappoints', polarity: 'pos' }, // 10
    { phrase: 'fantastic', polarity: 'pos' }, // 10
    { phrase: 'fantastic experience', polarity: 'pos' }, // 10
    { phrase: 'amazing time', polarity: 'pos' }, // 10
    { phrase: 'excellent', polarity: 'pos' }, // 10
    { phrase: 'wonderful', polarity: 'pos' }, // 9
    { phrase: 'awesome experience', polarity: 'pos' }, // 9
    { phrase: 'wonderful dinner', polarity: 'pos' }, // 9
    { phrase: 'everything was amazing', polarity: 'pos' }, // 9
    { phrase: 'great dinner', polarity: 'pos' }, // 9
    { phrase: 'awesome', polarity: 'pos' }, // 8
    { phrase: 'favorite steakhouse', polarity: 'pos' }, // 8
    { phrase: 'memorable experience', polarity: 'pos' }, // 7
    { phrase: 'exceptional experience', polarity: 'pos' }, // 7
    { phrase: 'outstanding experience', polarity: 'pos' }, // 7
    { phrase: 'love ruth\'s chris', polarity: 'pos' }, // 7
    { phrase: 'amazing dinner', polarity: 'pos' }, // 7
    { phrase: 'love this restaurant', polarity: 'pos' }, // 7
    { phrase: 'good time', polarity: 'pos' }, // 7
    { phrase: 'loved it', polarity: 'pos' }, // 6
    { phrase: 'great evening', polarity: 'pos' }, // 6
    { phrase: 'best experience', polarity: 'pos' }, // 6
    { phrase: 'very good', polarity: 'pos' }, // 6
    { phrase: 'perfect', polarity: 'pos' }, // 6
    { phrase: 'great night', polarity: 'pos' }, // 6
    { phrase: 'everything was wonderful', polarity: 'pos' }, // 6
    { phrase: 'absolutely amazing', polarity: 'pos' }, // 6
    { phrase: 'exceptional dining experience', polarity: 'pos' }, // 6
    { phrase: 'great restaurant', polarity: 'pos' }, // 6
    { phrase: 'best steakhouse', polarity: 'pos' }, // 6
    { phrase: 'wonderful night', polarity: 'pos' }, // 5
    { phrase: 'very special', polarity: 'pos' }, // 5
    { phrase: 'great place to eat', polarity: 'pos' }, // 5
    { phrase: 'amazing dining experience', polarity: 'pos' }, // 5
    { phrase: 'enjoyed everything', polarity: 'pos' }, // 5
    { phrase: 'memorable', polarity: 'pos' }, // 5
    { phrase: 'nice touch', polarity: 'pos' }, // 5
    { phrase: 'one of the best', polarity: 'pos' }, // 5
    { phrase: 'outstanding', polarity: 'pos' }, // 5
    { phrase: 'very nice experience', polarity: 'pos' }, // 4
    { phrase: 'very enjoyable', polarity: 'pos' }, // 4
    { phrase: 'everything was awesome', polarity: 'pos' }, // 4
    { phrase: 'lovely dinner', polarity: 'pos' }, // 4
    { phrase: 'perfect experience', polarity: 'pos' }, // 4
    { phrase: 'fantastic dining experience', polarity: 'pos' }, // 4
    { phrase: 'it was perfect', polarity: 'pos' }, // 4
    { phrase: 'everything was great', polarity: 'pos' }, // 4
    { phrase: 'top notch', polarity: 'pos' }, // 4
    { phrase: 'favorite restaurants', polarity: 'pos' }, // 4
    { phrase: 'always a pleasure', polarity: 'pos' }, // 4
    { phrase: 'love this location', polarity: 'pos' }, // 4
    { phrase: 'love ruth chris', polarity: 'pos' }, // 4
    { phrase: 'best dining experience', polarity: 'pos' }, // 4
    { phrase: 'delightful experience', polarity: 'pos' }, // 3
    { phrase: 'always the best', polarity: 'pos' }, // 3
    { phrase: 'dining experience', polarity: 'pos' }, // 3
    { phrase: 'exceptional', polarity: 'pos' }, // 3
    { phrase: 'awesome time', polarity: 'pos' }, // 3
    { phrase: 'best meal', polarity: 'pos' }, // 3
    { phrase: 'perfect meal', polarity: 'pos' }, // 3
    { phrase: 'nice', polarity: 'pos' }, // 3
    { phrase: 'fabulous dinner', polarity: 'pos' }, // 3
    { phrase: 'lovely experience', polarity: 'pos' }, // 3
    { phrase: 'special treat', polarity: 'pos' }, // 3
    { phrase: 'thoroughly enjoyed our dining experience', polarity: 'pos' }, // 3
    { phrase: 'really enjoyed it', polarity: 'pos' }, // 3
    { phrase: 'the best', polarity: 'pos' }, // 3
    { phrase: 'excellent dining experience', polarity: 'pos' }, // 3
    { phrase: 'very impressed', polarity: 'pos' }, // 3
    { phrase: 'made our night special', polarity: 'pos' }, // 3
    { phrase: 'excellent meal', polarity: 'pos' }, // 3
    { phrase: 'one of our favorites', polarity: 'pos' }, // 3
    { phrase: 'favorite place', polarity: 'pos' }, // 3
    { phrase: 'wonderful as always', polarity: 'pos' }, // 3
    { phrase: 'love coming here', polarity: 'pos' }, // 3
    { phrase: 'food and service was great', polarity: 'pos' }, // 3
    { phrase: 'perfect night', polarity: 'pos' }, // 3
    { phrase: 'great birthday dinner', polarity: 'pos' }, // 3
  ]},
  { axis: 'outcome', sub: 'discount', phrases: [
    { phrase: 'free dessert', polarity: 'pos' }, // 3
  ]},
  { axis: 'outcome', sub: 'expensive', phrases: [
    { phrase: 'expensive', polarity: 'neg' }, // 39
    { phrase: 'overpriced', polarity: 'neg' }, // 20
    { phrase: 'pricey', polarity: 'neg' }, // 13
    { phrase: 'very expensive', polarity: 'neg' }, // 8
    { phrase: 'not worth the price', polarity: 'neg' }, // 7
    { phrase: 'not worth the money', polarity: 'neg' }, // 6
    { phrase: 'a little pricey', polarity: 'neg' }, // 5
    { phrase: 'pricy', polarity: 'neg' }, // 4
    { phrase: 'way overpriced', polarity: 'neg' }, // 4
    { phrase: 'over priced', polarity: 'neg' }, // 4
    { phrase: 'a bit pricey', polarity: 'neg' }, // 4
    { phrase: 'for the price', polarity: 'neg' }, // 4
    { phrase: 'not worth the cost', polarity: 'neg' }, // 3
    { phrase: 'not worth it', polarity: 'neg' }, // 3
    { phrase: 'price', polarity: 'neg' }, // 3
    { phrase: 'so expensive', polarity: 'neg' }, // 3
    { phrase: 'too expensive', polarity: 'neg' }, // 3
  ]},
  { axis: 'outcome', sub: 'improvement', phrases: [
    { phrase: 'gone downhill', polarity: 'neg' }, // 3
  ]},
  { axis: 'outcome', sub: 'lost-customer', phrases: [
    { phrase: 'will not be back', polarity: 'neg' }, // 3
  ]},
  { axis: 'outcome', sub: 'not-recommend', phrases: [
    { phrase: 'very disappointed', polarity: 'neg' }, // 20
    { phrase: 'disappointing', polarity: 'neg' }, // 10
    { phrase: 'not recommend', polarity: 'neg' }, // 9
    { phrase: 'won\'t be back', polarity: 'neg' }, // 8
    { phrase: 'very disappointing', polarity: 'neg' }, // 7
    { phrase: 'not-recommend', polarity: 'neg' }, // 6
    { phrase: 'won\'t be returning', polarity: 'neg' }, // 6
    { phrase: 'disappointing experience', polarity: 'neg' }, // 5
    { phrase: 'will not go back', polarity: 'neg' }, // 5
    { phrase: 'not worth it', polarity: 'neg' }, // 5
    { phrase: 'disappointed', polarity: 'neg' }, // 5
    { phrase: 'not impressed', polarity: 'neg' }, // 4
    { phrase: 'bad experience', polarity: 'neg' }, // 4
    { phrase: 'terrible experience', polarity: 'neg' }, // 4
    { phrase: 'do not recommend', polarity: 'neg' }, // 4
    { phrase: 'would not return', polarity: 'neg' }, // 3
    { phrase: 'will not be back', polarity: 'neg' }, // 3
    { phrase: 'terrible', polarity: 'neg' }, // 3
    { phrase: 'would never recommend', polarity: 'neg' }, // 3
    { phrase: 'worst experience', polarity: 'neg' }, // 3
    { phrase: 'huge disappointment', polarity: 'neg' }, // 3
    { phrase: 'not a good experience', polarity: 'neg' }, // 3
  ]},
  { axis: 'outcome', sub: 'recommend', phrases: [
    { phrase: 'highly recommend', polarity: 'pos' }, // 124
    { phrase: 'highly recommended', polarity: 'pos' }, // 19
    { phrase: 'recommend', polarity: 'pos' }, // 18
    { phrase: 'definitely recommend', polarity: 'pos' }, // 14
    { phrase: 'would recommend', polarity: 'pos' }, // 11
    { phrase: 'highly recommend this restaurant', polarity: 'pos' }, // 8
    { phrase: 'highly recommend this place', polarity: 'pos' }, // 5
    { phrase: 'highly recommend ruth\'s chris', polarity: 'pos' }, // 4
    { phrase: 'highly recommend it', polarity: 'pos' }, // 4
    { phrase: 'i recommend', polarity: 'pos' }, // 3
    { phrase: 'recommend this place', polarity: 'pos' }, // 3
    { phrase: 'did not disappoint', polarity: 'pos' }, // 3
  ]},
  { axis: 'outcome', sub: 'return', phrases: [
    { phrase: 'great experience', polarity: 'pos' }, // 48
    { phrase: 'will be back', polarity: 'pos' }, // 40
    { phrase: 'definitely be back', polarity: 'pos' }, // 35
    { phrase: 'return', polarity: 'pos' }, // 25
    { phrase: 'we will be back', polarity: 'pos' }, // 21
    { phrase: 'will definitely be back', polarity: 'pos' }, // 19
    { phrase: 'never disappoints', polarity: 'pos' }, // 12
    { phrase: 'definitely return', polarity: 'pos' }, // 12
    { phrase: 'can\'t wait to come back', polarity: 'pos' }, // 12
    { phrase: 'will definitely return', polarity: 'pos' }, // 10
    { phrase: 'will return', polarity: 'pos' }, // 10
    { phrase: 'will be back soon', polarity: 'pos' }, // 9
    { phrase: 'great time', polarity: 'pos' }, // 9
    { phrase: 'we\'ll be back', polarity: 'pos' }, // 9
    { phrase: 'definitely be returning', polarity: 'pos' }, // 9
    { phrase: 'can\'t wait to return', polarity: 'pos' }, // 8
    { phrase: 'great dinner', polarity: 'pos' }, // 8
    { phrase: 'never disappointed', polarity: 'pos' }, // 8
    { phrase: 'did not disappoint', polarity: 'pos' }, // 8
    { phrase: 'coming back', polarity: 'pos' }, // 8
    { phrase: 'come back', polarity: 'pos' }, // 7
    { phrase: 'can\'t wait to go back', polarity: 'pos' }, // 7
    { phrase: 'good experience', polarity: 'pos' }, // 7
    { phrase: 'i will be back', polarity: 'pos' }, // 7
    { phrase: 'worth it', polarity: 'pos' }, // 7
    { phrase: 'great', polarity: 'pos' }, // 7
    { phrase: 'will be back again', polarity: 'pos' }, // 7
    { phrase: 'definitely be coming back', polarity: 'pos' }, // 6
    { phrase: 'definitely be going back', polarity: 'pos' }, // 6
    { phrase: 'definitely come back', polarity: 'pos' }, // 6
    { phrase: 'looking forward to our next visit', polarity: 'pos' }, // 5
    { phrase: 'everything was good', polarity: 'pos' }, // 5
    { phrase: 'experience was great', polarity: 'pos' }, // 5
    { phrase: 'will definitely come back', polarity: 'pos' }, // 5
    { phrase: 'absolutely be back', polarity: 'pos' }, // 5
    { phrase: 'good', polarity: 'pos' }, // 5
    { phrase: 'well worth it', polarity: 'pos' }, // 5
    { phrase: 'never been disappointed', polarity: 'pos' }, // 5
    { phrase: 'wonderful experience', polarity: 'pos' }, // 5
    { phrase: 'will come back', polarity: 'pos' }, // 5
    { phrase: 'very good experience', polarity: 'pos' }, // 5
    { phrase: 'look forward to returning', polarity: 'pos' }, // 5
    { phrase: 'would come back', polarity: 'pos' }, // 5
    { phrase: 'going back', polarity: 'pos' }, // 4
    { phrase: 'will be returning', polarity: 'pos' }, // 4
    { phrase: 'definitely will be back', polarity: 'pos' }, // 4
    { phrase: 'will come again', polarity: 'pos' }, // 4
    { phrase: 'come back again', polarity: 'pos' }, // 4
    { phrase: 'service was great', polarity: 'pos' }, // 4
    { phrase: 'coming back soon', polarity: 'pos' }, // 3
    { phrase: 'keep coming back', polarity: 'pos' }, // 3
    { phrase: 'food and service was great', polarity: 'pos' }, // 3
    { phrase: 'we will be back soon', polarity: 'pos' }, // 3
    { phrase: 'come again', polarity: 'pos' }, // 3
    { phrase: 'very good', polarity: 'pos' }, // 3
    { phrase: 'would go again', polarity: 'pos' }, // 3
    { phrase: 'definitely coming back', polarity: 'pos' }, // 3
    { phrase: 'it was great', polarity: 'pos' }, // 3
    { phrase: 'i\'ll be back', polarity: 'pos' }, // 3
    { phrase: 'excellent experience', polarity: 'pos' }, // 3
    { phrase: 'we\'ll be back soon', polarity: 'pos' }, // 3
    { phrase: 'never disappoint', polarity: 'pos' }, // 3
    { phrase: 'definitely be back again', polarity: 'pos' }, // 3
    { phrase: 'overall good', polarity: 'pos' }, // 3
    { phrase: 'always good', polarity: 'pos' }, // 3
    { phrase: 'everything was great', polarity: 'pos' }, // 3
    { phrase: 'returning', polarity: 'pos' }, // 3
  ]},
]
