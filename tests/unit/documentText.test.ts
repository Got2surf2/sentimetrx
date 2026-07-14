// P2c — text-first document extraction for KB ingestion (PDF/DOCX/text).
// The DOCX path is exercised against a REAL docx buffer (built with the `docx`
// package) through mammoth; the PDF assembly + sparse detection are tested pure
// (no binary fixture needed); docKind + htmlToMarkdownish are pure helpers.
import { describe, it, expect } from 'vitest'
import { Document, Packer, Paragraph, HeadingLevel } from 'docx'
import {
  docKind,
  assemblePdfPages,
  htmlToMarkdownish,
  extractDocumentText,
} from '@/lib/botKnowledge/documentText'

describe('docKind', () => {
  it('classifies by mime type first', () => {
    expect(docKind('x', 'application/pdf')).toBe('pdf')
    expect(docKind('x', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx')
    expect(docKind('x', 'text/plain')).toBe('text')
  })
  it('falls back to extension', () => {
    expect(docKind('report.PDF', '')).toBe('pdf')
    expect(docKind('brief.docx', '')).toBe('docx')
    expect(docKind('notes.md', '')).toBe('text')
    expect(docKind('sheet.xlsx', 'application/octet-stream')).toBe('unsupported')
  })
})

describe('assemblePdfPages', () => {
  it('titles each page and reports the count', () => {
    const r = assemblePdfPages(['Hello world '.repeat(20), 'Second page content '.repeat(20)])
    expect(r.pageCount).toBe(2)
    expect(r.text).toContain('## Page 1')
    expect(r.text).toContain('## Page 2')
    expect(r.sparse).toBe(false)
  })
  it('flags a scanned/image-only PDF as sparse', () => {
    // Three pages, almost no text → below the 40 chars/page floor.
    expect(assemblePdfPages(['', ' ', '']).sparse).toBe(true)
    expect(assemblePdfPages(['a', '', '']).sparse).toBe(true)
  })
  it('a single dense page is not sparse', () => {
    expect(assemblePdfPages(['This page has plenty of real readable text on it.']).sparse).toBe(false)
  })
})

describe('htmlToMarkdownish', () => {
  it('converts headings and lists and decodes entities', () => {
    const md = htmlToMarkdownish('<h1>Title</h1><p>Fish &amp; chips</p><ul><li>one</li><li>two</li></ul>')
    expect(md).toContain('## Title')
    expect(md).toContain('Fish & chips')
    expect(md).toContain('- one')
    expect(md).toContain('- two')
    expect(md).not.toMatch(/<[a-z]/i)
  })
})

describe('extractDocumentText', () => {
  it('extracts a real DOCX through mammoth', async () => {
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ text: 'Menu Overview', heading: HeadingLevel.HEADING_1 }),
          new Paragraph('We serve wood-fired steaks and fresh Gulf seafood daily.'),
        ],
      }],
    })
    const buf = await Packer.toBuffer(doc)
    const r = await extractDocumentText(Buffer.from(buf), 'menu.docx', '')
    expect(r.method).toBe('docx')
    expect(r.sparse).toBe(false)
    expect(r.text).toContain('Menu Overview')
    expect(r.text).toContain('wood-fired steaks')
  })

  it('wraps a plain text/markdown file with a source heading', async () => {
    const r = await extractDocumentText(Buffer.from('Line one.\nLine two.'), 'field-notes.md', 'text/markdown')
    expect(r.method).toBe('text')
    expect(r.text).toContain('## field notes')
    expect(r.text).toContain('Line one.')
  })

  it('extracts a real text PDF through unpdf', async () => {
    // A minimal one-page PDF whose content stream draws "Hello Sentimetrx knowledge base".
    const pdf = Buffer.from('JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCA2MTIgNzkyXS9SZXNvdXJjZXM8PC9Gb250PDwvRjEgNCAwIFI+Pj4+L0NvbnRlbnRzIDUgMCBSPj4KZW5kb2JqCjQgMCBvYmoKPDwvVHlwZS9Gb250L1N1YnR5cGUvVHlwZTEvQmFzZUZvbnQvSGVsdmV0aWNhPj4KZW5kb2JqCjUgMCBvYmoKPDwvTGVuZ3RoIDYwPj4Kc3RyZWFtCkJUCi9GMSAyNCBUZgoxMDAgNzAwIFRkCihIZWxsbyBTZW50aW1ldHJ4IGtub3dsZWRnZSBiYXNlKSBUagpFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0NSAwMDAwMCBuIAowMDAwMDAwMzE3IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA2L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKNDI3CiUlRU9GCg==', 'base64')
    const r = await extractDocumentText(pdf, 'hello.pdf', 'application/pdf')
    expect(r.method).toBe('pdf-text')
    expect(r.pageCount).toBe(1)
    expect(r.text).toContain('## Page 1')
    expect(r.text.replace(/\s+/g, ' ')).toContain('Hello Sentimetrx knowledge base')
  })

  it('rejects unsupported types', async () => {
    await expect(extractDocumentText(Buffer.from('xx'), 'a.xlsx', 'application/octet-stream')).rejects.toThrow(/Unsupported file type/)
  })
})
