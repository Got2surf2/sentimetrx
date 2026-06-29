// Run: node --conditions=react-server --import tsx scripts/_ea_membership_deck_qc.ts
// Renders the EA membership deck to ~/Downloads for pixel-QC (soffice + pdftoppm).
import PptxGenJS from 'pptxgenjs'
import { buildEaMembershipDeck } from '../lib/pptx/eaMembershipDeck'
import { homedir } from 'os'
import { join } from 'path'
;(async () => {
  const pptx = new PptxGenJS()
  buildEaMembershipDeck(pptx)
  const out = join(homedir(), 'Downloads', 'Sentimetrx-EA-Membership-Research.pptx')
  await pptx.writeFile({ fileName: out })
  console.log('WROTE', out)
})()
