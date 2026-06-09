// Local QC harness for the MCO "Listening to Your Guests" deck.
// Renders the deck to ~/Downloads with no auth / no DB writes, so it can be
// visually QC'd (LibreOffice → pdftoppm → PNG). Read-only.
//
//   node --conditions=react-server --import tsx scripts/_mco_listening_deck_qc.ts

import PptxGenJS from 'pptxgenjs'
import { homedir } from 'os'
import { join } from 'path'
import { buildMcoListeningDeck } from '../lib/pptx/mcoListeningDeck'

async function main() {
  const pptx = new PptxGenJS()
  buildMcoListeningDeck(pptx)
  const out = join(homedir(), 'Downloads', 'MCO-Listening-To-Your-Guests.pptx')
  await pptx.writeFile({ fileName: out })
  console.log('Wrote', out)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
