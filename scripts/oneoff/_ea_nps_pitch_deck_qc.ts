// Run: node --conditions=react-server --import tsx scripts/oneoff/_ea_nps_pitch_deck_qc.ts
// Renders the EA "Beyond the Score" NPS pitch deck to ~/Downloads for pixel-QC
// (soffice + pdftoppm).
import PptxGenJS from 'pptxgenjs'
import { buildEaNpsPitchDeck } from '../../lib/pptx/eaNpsPitchDeck'
import { homedir } from 'os'
import { join } from 'path'
;(async () => {
  const pptx = new PptxGenJS()
  buildEaNpsPitchDeck(pptx)
  const out = join(homedir(), 'Downloads', 'Sentimetrx-EA-Beyond-The-Score.pptx')
  await pptx.writeFile({ fileName: out })
  console.log('WROTE', out)
})()
