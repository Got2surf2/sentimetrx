// lib/americanize.ts
// Output-side enforcement of the American-English standing rule (owner,
// 2026-09-03: "not just prompts"). The prompt-side rule (AMERICAN_ENGLISH_RULE
// in lib/ai.ts) asks the model; this converts what actually came back.
//
// Deliberately an EXPLICIT pair list, not suffix heuristics — "-ise" rules
// mangle franchise/advertise/surprise, "-our" rules mangle hour/tour/four.
// Apply ONLY to AI-generated prose the product displays; NEVER to verbatim
// user data (quotes stay exactly as written).

const PAIRS: [string, string][] = [
  // -our → -or
  ['behaviour', 'behavior'], ['behaviours', 'behaviors'],
  ['colour', 'color'], ['colours', 'colors'], ['coloured', 'colored'], ['colourful', 'colorful'],
  ['favour', 'favor'], ['favours', 'favors'], ['favourite', 'favorite'], ['favourites', 'favorites'], ['favourable', 'favorable'],
  ['flavour', 'flavor'], ['flavours', 'flavors'], ['flavoured', 'flavored'],
  ['honour', 'honor'], ['honours', 'honors'],
  ['humour', 'humor'], ['labour', 'labor'], ['neighbour', 'neighbor'], ['neighbours', 'neighbors'], ['neighbouring', 'neighboring'],
  ['rumour', 'rumor'], ['rumours', 'rumors'], ['odour', 'odor'], ['vapour', 'vapor'],
  // -re → -er
  ['centre', 'center'], ['centres', 'centers'], ['centred', 'centered'],
  ['metre', 'meter'], ['metres', 'meters'], ['kilometre', 'kilometer'], ['kilometres', 'kilometers'],
  ['centimetre', 'centimeter'], ['centimetres', 'centimeters'], ['millimetre', 'millimeter'], ['millimetres', 'millimeters'],
  ['litre', 'liter'], ['litres', 'liters'], ['fibre', 'fiber'], ['theatre', 'theater'], ['calibre', 'caliber'],
  // -ise/-isation → -ize/-ization (explicit stems only)
  ['analyse', 'analyze'], ['analysed', 'analyzed'], ['analyses', 'analyzes'], ['analysing', 'analyzing'],
  ['organise', 'organize'], ['organised', 'organized'], ['organises', 'organizes'], ['organising', 'organizing'], ['organisation', 'organization'], ['organisations', 'organizations'],
  ['recognise', 'recognize'], ['recognised', 'recognized'], ['recognises', 'recognizes'], ['recognising', 'recognizing'],
  ['prioritise', 'prioritize'], ['prioritised', 'prioritized'], ['prioritises', 'prioritizes'], ['prioritising', 'prioritizing'],
  ['monetise', 'monetize'], ['monetised', 'monetized'], ['monetisation', 'monetization'],
  ['penalise', 'penalize'], ['penalised', 'penalized'], ['penalises', 'penalizes'], ['penalising', 'penalizing'],
  ['criticise', 'criticize'], ['criticised', 'criticized'], ['criticises', 'criticizes'], ['criticising', 'criticizing'],
  ['emphasise', 'emphasize'], ['emphasised', 'emphasized'], ['emphasises', 'emphasizes'], ['emphasising', 'emphasizing'],
  ['summarise', 'summarize'], ['summarised', 'summarized'], ['summarises', 'summarizes'], ['summarising', 'summarizing'],
  ['normalise', 'normalize'], ['normalised', 'normalized'], ['normalisation', 'normalization'],
  ['utilise', 'utilize'], ['utilised', 'utilized'], ['utilisation', 'utilization'],
  ['capitalise', 'capitalize'], ['capitalised', 'capitalized'], ['capitalisation', 'capitalization'],
  ['characterise', 'characterize'], ['characterised', 'characterized'],
  ['stabilise', 'stabilize'], ['stabilised', 'stabilized'], ['stabilisation', 'stabilization'],
  ['optimise', 'optimize'], ['optimised', 'optimized'], ['optimisation', 'optimization'],
  ['minimise', 'minimize'], ['minimised', 'minimized'], ['maximise', 'maximize'], ['maximised', 'maximized'],
  ['standardise', 'standardize'], ['standardised', 'standardized'],
  ['apologise', 'apologize'], ['apologised', 'apologized'],
  ['realise', 'realize'], ['realised', 'realized'], ['realises', 'realizes'], ['realising', 'realizing'],
  // doubled L
  ['travelled', 'traveled'], ['travelling', 'traveling'], ['traveller', 'traveler'], ['travellers', 'travelers'],
  ['cancelled', 'canceled'], ['cancelling', 'canceling'], ['labelled', 'labeled'], ['labelling', 'labeling'],
  ['modelled', 'modeled'], ['modelling', 'modeling'], ['levelled', 'leveled'], ['fuelled', 'fueled'],
  ['signalled', 'signaled'], ['totalled', 'totaled'],
  // misc
  ['grey', 'gray'], ['greys', 'grays'], ['greyed', 'grayed'],
  ['defence', 'defense'], ['defences', 'defenses'], ['offence', 'offense'], ['offences', 'offenses'],
  ['licence', 'license'], ['licences', 'licenses'], ['practise', 'practice'], ['practised', 'practiced'],
  ['learnt', 'learned'], ['spelt', 'spelled'], ['burnt', 'burned'], ['dreamt', 'dreamed'],
  ['whilst', 'while'], ['amongst', 'among'],
  ['aluminium', 'aluminum'], ['sulphur', 'sulfur'], ['tyre', 'tire'], ['tyres', 'tires'],
  ['catalogue', 'catalog'], ['catalogued', 'cataloged'],
  ['cheque', 'check'], ['cheques', 'checks'],
  ['programme', 'program'], ['programmes', 'programs'],
  ['tonne', 'ton'], ['tonnes', 'tons'],
]

const RES: [RegExp, string][] = PAIRS.map(function([uk, us]) {
  return [new RegExp('\\b' + uk + '\\b', 'gi'), us] as [RegExp, string]
})

/** Convert British spellings to American, preserving the first letter's case.
 *  For AI-generated display prose only — never run this on verbatim user data. */
export function americanize(text: string): string {
  let out = text
  for (const [re, us] of RES) {
    out = out.replace(re, function(m) {
      return m[0] === m[0].toUpperCase() ? us[0].toUpperCase() + us.slice(1) : us
    })
  }
  return out
}
