// lib/botKnowledge/chunkText.ts
// Pure text→titled-chunks splitter, shared by the knowledge ingest helper and
// the crawl verify harness. No server-only / DB / AI imports so it can run in a
// plain script or unit test.

// ── Chunking logic ────────────────────────────────────────────
// Splits markdown/text by headings (## or ---) into titled sections. Falls back
// to paragraph-based splitting if no headings found. (Moved verbatim from the
// knowledge route.)
export function chunkText(text: string, source?: string, sourceType?: string): { title: string; content: string; metadata: Record<string, unknown> }[] {
  const lines = text.split('\n')
  const chunks: { title: string; content: string; metadata: Record<string, unknown> }[] = []
  let currentTitle = 'General'
  let currentLines: string[] = []
  const baseMeta: Record<string, unknown> = {}
  if (source) baseMeta.source = source
  if (sourceType) baseMeta.source_type = sourceType

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const headingMatch = line.match(/^#{2,4}\s+(.+)/)
    const isSeparator = /^-{3,}\s*$/.test(line)

    if (headingMatch || isSeparator) {
      if (currentLines.length > 0) {
        const content = currentLines.join('\n').trim()
        if (content.length >= 20) {
          chunks.push({ title: currentTitle, content, metadata: { ...baseMeta } })
        }
      }
      currentTitle = headingMatch ? headingMatch[1].replace(/\*\*/g, '').trim() : 'General'
      currentLines = []
    } else {
      if (/^---\s*$/.test(line) && i < 5) continue
      if (/^(name|description|type|originSessionId):/.test(line) && i < 10) continue
      currentLines.push(line)
    }
  }

  if (currentLines.length > 0) {
    const content = currentLines.join('\n').trim()
    if (content.length >= 20) {
      chunks.push({ title: currentTitle, content, metadata: { ...baseMeta } })
    }
  }

  const MAX_CHUNK = 1500
  const subdivided: typeof chunks = []
  for (const chunk of chunks) {
    if (chunk.content.length <= MAX_CHUNK) {
      subdivided.push(chunk)
    } else {
      const paras = chunk.content.split(/\n\n+/)
      let buf = ''
      let subIdx = 1
      for (const para of paras) {
        if (buf.length + para.length > MAX_CHUNK && buf.length > 0) {
          subdivided.push({ title: chunk.title + (subIdx > 1 ? ' (' + subIdx + ')' : ''), content: buf.trim(), metadata: { ...chunk.metadata } })
          subIdx++
          buf = ''
        }
        buf += (buf ? '\n\n' : '') + para
      }
      if (buf.trim().length >= 20) {
        subdivided.push({ title: chunk.title + (subIdx > 1 ? ' (' + subIdx + ')' : ''), content: buf.trim(), metadata: { ...chunk.metadata } })
      }
    }
  }
  if (subdivided.length > chunks.length) return subdivided

  if (chunks.length <= 1 && text.length > 2000) {
    const paragraphs = text.split(/\n\n+/)
    const splitChunks: typeof chunks = []
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i].trim()
      if (para.length < 20) continue
      const firstLine = para.split('\n')[0]
      const title = firstLine.length < 80 ? firstLine.replace(/^#+\s*/, '').replace(/\*\*/g, '') : 'Section ' + (i + 1)
      splitChunks.push({ title, content: para, metadata: { ...baseMeta } })
    }
    if (splitChunks.length > 1) return splitChunks
  }

  return chunks
}
