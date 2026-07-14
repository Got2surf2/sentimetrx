// lib/botKnowledge/documentText.ts
// P2c (AGENT_TIERS §3.1 / §5 Phase 2) — extract plain text from an uploaded
// PDF / DOCX / text file so it feeds the SAME chunk→embed→dedup→budget KB
// ingest path the website-crawl and web-research sources already use. Text
// first (unpdf / mammoth — cheap, local, no sandbox); a PDF that yields almost
// no text is scanned/image-only, and the caller then runs the vision fallback
// (the readDocument pipeline — see documentVision.ts).
//
// Pure at this layer: no network / storage / sandbox, so it is unit-testable
// with a real fixture buffer. Output is markdown-ish with per-section headings
// so chunkText() splits it into titled chunks like every other source.

import 'server-only'
import { extractText, getDocumentProxy } from 'unpdf'
import mammoth from 'mammoth'

export type DocMethod = 'pdf-text' | 'docx' | 'text'

export interface ExtractedDocument {
  text: string
  method: DocMethod
  pageCount: number
  // true when a PDF produced too little text to be real content (scanned /
  // image-only) → the caller should fall back to the vision pipeline.
  sparse: boolean
}

// A text PDF averages hundreds of chars/page; a scanned one yields ~0. Below
// this per-page floor we treat the PDF as image-only and hand off to vision.
const MIN_CHARS_PER_PAGE = 40
// Big-KB ceiling; the per-agent chunk budget (P2b) caps what actually lands.
const MAX_DOC_CHARS = 400_000

export type DocKind = 'pdf' | 'docx' | 'text' | 'unsupported'

/** Classify an upload by mime type first, then filename extension. */
export function docKind(filename: string, mimeType: string): DocKind {
  const name = (filename || '').toLowerCase()
  const mt = (mimeType || '').toLowerCase()
  if (mt.includes('pdf') || name.endsWith('.pdf')) return 'pdf'
  if (mt.includes('wordprocessingml') || mt.includes('msword') || name.endsWith('.docx') || name.endsWith('.doc')) return 'docx'
  if (mt.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.markdown')) return 'text'
  return 'unsupported'
}

function baseName(filename: string): string {
  return (filename || 'Document').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim() || 'Document'
}

function clip(text: string): string {
  return text.length > MAX_DOC_CHARS ? text.slice(0, MAX_DOC_CHARS) + '\n\n[Truncated — document exceeds ' + MAX_DOC_CHARS.toLocaleString() + ' characters]' : text
}

/**
 * Assemble per-page PDF text into markdown sections and decide whether the PDF
 * was scanned (too little text to be real content). Pure — unit-tested.
 */
export function assemblePdfPages(pages: string[]): { text: string; pageCount: number; sparse: boolean } {
  const pageCount = pages.length
  const totalChars = pages.reduce((n, p) => n + (p ? p.trim().length : 0), 0)
  const sparse = totalChars < Math.max(MIN_CHARS_PER_PAGE, pageCount * MIN_CHARS_PER_PAGE)
  const body = pages
    .map((p, i) => '## Page ' + (i + 1) + '\n\n' + (p || '').replace(/[ \t]+/g, ' ').replace(/ *\n/g, '\n').trim())
    .join('\n\n')
    .trim()
  return { text: body, pageCount, sparse }
}

/**
 * Minimal HTML → markdown-ish text for mammoth's DOCX HTML. Headings become
 * markdown headings (so chunkText titles them), lists become bullets, other
 * tags are stripped and entities decoded. No length cap here (clip() applies).
 */
export function htmlToMarkdownish(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n## $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|tr|li|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<td[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function extractPdf(buffer: Buffer): Promise<ExtractedDocument> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  const pages = Array.isArray(text) ? text : [String(text)]
  const { text: body, pageCount, sparse } = assemblePdfPages(pages)
  return { text: clip(body), method: 'pdf-text', pageCount: pageCount || totalPages, sparse }
}

async function extractDocx(buffer: Buffer, filename: string): Promise<ExtractedDocument> {
  const { value: html } = await mammoth.convertToHtml({ buffer })
  const body = htmlToMarkdownish(html)
  const text = body.length > 0 ? body : '## ' + baseName(filename) + '\n\n(no extractable text)'
  return { text: clip(text), method: 'docx', pageCount: 1, sparse: body.length < 10 }
}

/**
 * Text-first extraction. PDF/DOCX/text supported; anything else throws. A PDF
 * that comes back `sparse` is scanned — the route runs the vision fallback.
 */
export async function extractDocumentText(buffer: Buffer, filename: string, mimeType: string): Promise<ExtractedDocument> {
  const kind = docKind(filename, mimeType)
  if (kind === 'pdf') return extractPdf(buffer)
  if (kind === 'docx') return extractDocx(buffer, filename)
  if (kind === 'text') {
    const text = clip(buffer.toString('utf-8').trim())
    return { text: '## ' + baseName(filename) + '\n\n' + text, method: 'text', pageCount: 1, sparse: text.length < 10 }
  }
  throw new Error('Unsupported file type — upload a PDF, DOCX, or text file (' + (mimeType || filename) + ')')
}
