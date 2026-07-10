// Run: node --conditions=react-server --import tsx scripts/oneoff/_nepa_deck_qc.ts <outpath>
import PptxGenJS from 'pptxgenjs'
import { buildBlueMountainsNepaDeck } from '../../lib/pptx/blueMountainsNepaDeck'
;(async () => {
  const pptx = new PptxGenJS()
  buildBlueMountainsNepaDeck(pptx)
  const out = process.argv[2]
  await pptx.writeFile({ fileName: out })
  console.log('WROTE', out)
})()
