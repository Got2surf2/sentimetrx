// lib/sentimentLexicon.ts
// Single source of truth for sentiment word lists.
// Used by themeUtils (lexicon scoring) and opinionMining (aspect extraction).

export const POSITIVE_WORDS = new Set([
  'good','great','excellent','amazing','awesome','fantastic','wonderful','perfect','best',
  'delicious','tasty','fresh','friendly','nice','lovely','beautiful','clean','quick','fast',
  'warm','hot','crispy','tender','flavorful','juicy','smooth','rich','creamy','light',
  'attentive','helpful','polite','efficient','professional','outstanding','superb','incredible',
  'impressive','comfortable','cozy','spacious','pleasant','enjoyable','reasonable','generous',
  'authentic','consistent','reliable','prompt','welcoming','accommodating','caring','cheerful',
  'exceptional','phenomenal','spectacular','remarkable','brilliant','divine','heavenly','savory',
  'satisfying','refreshing','favorite','love','loved','enjoy','enjoyed','recommend','happy',
  'pleased','thrilled','grateful','impressed','delighted','satisfied','glad','proud',
])

export const NEGATIVE_WORDS = new Set([
  'bad','terrible','horrible','awful','worst','poor','slow','cold','bland','dry','stale',
  'rude','dirty','expensive','overpriced','small','tiny','loud','noisy','crowded','long',
  'soggy','burnt','undercooked','overcooked','raw','greasy','salty','bitter','tasteless',
  'mediocre','disappointing','disgusting','unpleasant','uncomfortable','unfriendly','inattentive',
  'lazy','careless','unprofessional','disorganized','chaotic','filthy','gross','lukewarm',
  'watery','tough','chewy','rubbery','mushy','old','late','wrong','missing',
  'broken','ignored','forgotten','waited','waiting','complained','annoyed','frustrated',
  'underwhelming','overrated','average','meh','okay','ok',
  'upset','angry','disappointed','unhappy','dissatisfied','regret',
])

export const NEUTRAL_WORDS = new Set([
  'big','large','small','new','different','usual','normal','standard','regular','typical',
  'busy','popular','full','empty','dark','bright','simple','basic','fine','decent',
  'moderate','mixed','fair','adequate','acceptable','sufficient','ordinary',
])

// Negation words — if one of these precedes a sentiment word, flip its polarity
export const NEGATORS = new Set([
  'not','no','never','dont','don\'t','doesnt','doesn\'t','didnt','didn\'t',
  'isnt','isn\'t','arent','aren\'t','wasnt','wasn\'t','werent','weren\'t',
  'wont','won\'t','wouldnt','wouldn\'t','cant','can\'t','cannot','hardly',
  'barely','neither','nor','nothing','nowhere','nobody','lack','without',
])
