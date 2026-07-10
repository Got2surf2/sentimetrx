// Run: node --conditions=react-server --import tsx scripts/oneoff/_nepa_cara_deck_qc.ts <outpath>
import PptxGenJS from 'pptxgenjs'
import { buildNepaCaraReimaginedDeck } from '../../lib/pptx/nepaCaraReimaginedDeck'
;(async () => {
  const pptx = new PptxGenJS()
  buildNepaCaraReimaginedDeck(pptx)
  const out = process.argv[2]
  await pptx.writeFile({ fileName: out })
  console.log('WROTE', out)
})()
