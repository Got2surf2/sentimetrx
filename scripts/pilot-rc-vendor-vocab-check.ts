/* eslint-disable */
// One-off: run the client's authoritative cross-brand classification scheme
// (Darden "Classification Categories" PDF, 2026-06-02) through our legacy
// mapper to see which of THEIR canonical labels we cover vs. drop to _unmapped.
//
// Run: node_modules/.bin/tsx scripts/pilot-rc-vendor-vocab-check.ts

import { mapLegacyLabel } from '../lib/taxonomyMapping'

// Their labels, as they'd appear in a Classification column (the "By " is a UI
// grouping prefix, dropped). Tested in the abbreviated forms shown in the doc.
const LABELS = [
  'Ambiance - Appearance', 'Ambiance - Clean', 'Ambiance - Decor', 'Ambiance - Dress Code',
  'Ambiance - Light', 'Ambiance - Location', 'Ambiance - Music', 'Ambiance - Noise', 'Ambiance - Odor',
  'Dayparts - Dinner', 'Dayparts - Happy Hour', 'Dayparts - Latenight', 'Dayparts - Lunch',
  'Food - Accuracy', 'Food - Eighty-Sixed', 'Food - Flavor', 'Food - Menu Variety', 'Food - Portion',
  'Food - Prep', 'Food - Presentation', 'Food - Quality',
  'IOR - Brand Love', 'IOR - Check in', 'IOR - Frequency', 'IOR - Loyalty', 'IOR - Recommend', 'IOR - Return',
  'SERV - Bartender', 'SERV - Busser Janitor', 'SERV - Chef', 'SERV - Delivery', 'SERV - Host',
  'SERV - Manager', 'SERV - Pace', 'SERV - Sequence', 'SERV - Server', 'SERV - Service',
  'Service - Accuracy', 'Service - Appearance', 'Service - Attentive', 'Service - Experience',
  'Service - Knowledge', 'Service - Speed', 'Service - Staff', 'Service - Ziosk', 'Service - Friendly',
  'Staff-Bartender', 'Staff-Busser', 'Staff-Host', 'Staff-Manager', 'Staff-Server',
  'Special Occasions', 'Sporting event',
  'Steak - Filet', 'Steak - NY Strip', 'Steak - Porterhouse', 'Steak - Ribeye', 'Steak - Ribeye Bone-In',
  'Steak - Sirloin', 'Steak - T-Bone', 'Steak - All Steak Cuts',
  'Value - Affordable', 'Value - Discount', 'Value - Expensive', 'Value - Price Increase',
  'The Generous Pour', 'Total Off Premise', 'TO-GO',
  'Bev - Alcohol', 'Bev - Assort.', 'Bev - Beer', 'Bev - Champagne', 'Bev - Cocktail', 'Bev - Coffee',
  'Bev - Flavor', 'Bev - Margarita', 'Bev - Martini', 'Bev - Wine', 'Bev - Sangria',
  'Christmas', "Valentine's Day", "Mother's Day", 'Easter', 'Thanksgiving', "New Year's",
]

let mapped = 0, quarantined = 0, unmapped = 0
const unmappedList: string[] = []
const mappedList: string[] = []
for (const raw of LABELS) {
  const r = mapLegacyLabel(raw)
  if (r.assertions.length > 0) {
    mapped++
    mappedList.push(`  OK    ${raw.padEnd(26)} -> ${r.assertions.map(a => `${a.axis}:${a.sub}${a.item ? '·' + a.item : ''}${a.severity !== 'normal' ? '[' + a.severity + ']' : ''}`).join(', ')}`)
  } else if (r.quarantine && r.quarantine !== '_unmapped') {
    quarantined++
    mappedList.push(`  QUAR  ${raw.padEnd(26)} -> ${r.quarantine}`)
  } else {
    unmapped++
    unmappedList.push(`  MISS  ${raw}`)
  }
}

console.log(mappedList.join('\n'))
console.log(`\n${'='.repeat(60)}`)
console.log(`UNMAPPED (${unmapped}) — labels our mapper drops to _unmapped:`)
console.log(unmappedList.join('\n'))
console.log(`\nTotal ${LABELS.length}:  mapped ${mapped}  ·  quarantined ${quarantined}  ·  UNMAPPED ${unmapped}  (${(100 * unmapped / LABELS.length).toFixed(0)}% miss)`)
