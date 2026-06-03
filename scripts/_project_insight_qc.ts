// Throwaway QC harness — renders the Project Insight deck to ~/Downloads.
// Run: node --conditions=react-server --import tsx scripts/_project_insight_qc.ts
import PptxGenJS from 'pptxgenjs'
import { buildProjectInsightDeck } from '../lib/pptx/projectInsightDeck'
import { homedir } from 'os'
import { join } from 'path'

;(async () => {
  const pptx = new PptxGenJS()
  buildProjectInsightDeck(pptx)
  const out = join(homedir(), 'Downloads', 'Project-Insight-Teaser.pptx')
  await pptx.writeFile({ fileName: out })
  console.log('WROTE', out)
})()
