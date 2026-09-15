// lib/htmlStrip.ts
// Tag stripping and entity decoding done the way CodeQL (and the HTML spec)
// insist on, in ONE place. Fourteen call sites had their own single-pass
// `.replace(/<[^>]+>/g, '')` — which leaves `<scr<b>ipt>` as `<script>` — and
// decoded `&amp;` FIRST, which turns `&amp;lt;` into `<` (double-unescape).
// None of those outputs is rendered as HTML today (they feed prompts, KB text
// and React text nodes), so this is defence in depth: if one ever is, the
// stripping still holds.
//
// Pure, dependency-free, safe on the client.

const MAX_PASSES = 10

/** Remove tags until nothing changes (a fixed point), so nested/split tags
 *  cannot reassemble. `replaceWith` defaults to a space so adjacent words
 *  don't fuse (`<p>a</p><p>b</p>` → `a b`). */
export function stripTags(s: string, replaceWith = ' '): string {
  let out = s
  for (let i = 0; i < MAX_PASSES; i++) {
    const next = out.replace(/<[^>]*>/g, replaceWith)
    if (next === out) return out
    out = next
  }
  return out.replace(/[<>]/g, replaceWith)   // pathological input: drop what's left of any bracket
}

/** Remove whole elements (`<script …>…</script >`) for the given tag names,
 *  tolerating whitespace before the closing `>` (js/bad-tag-filter) and, via
 *  the fixed point, elements that re-form after an inner removal. */
export function removeElements(html: string, tags: readonly string[]): string {
  if (tags.length === 0) return html
  const re = new RegExp(`<(${tags.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi')
  let out = html
  for (let i = 0; i < MAX_PASSES; i++) {
    const next = out.replace(re, ' ')
    if (next === out) return out
    out = next
  }
  return out
}

const NAMED: Record<string, string> = {
  lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', mdash: '—', ndash: '–',
}

/** Decode numeric + the common named entities. `&amp;` is decoded LAST, in a
 *  single pass, so `&amp;lt;` becomes `&lt;` (one level), never `<`. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => safeChar(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&(lt|gt|quot|apos|nbsp|rsquo|lsquo|rdquo|ldquo|hellip|mdash|ndash);/g, (_, name: string) => NAMED[name] ?? _)
    .replace(/&amp;/g, '&')
}

function safeChar(code: number): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
}

/** Whole-document text extraction used by the crawl / fetch-url / research
 *  paths: drop non-content elements, strip tags, decode, collapse whitespace. */
export function htmlToPlainText(html: string, opts: { drop?: readonly string[] } = {}): string {
  const drop = opts.drop ?? ['script', 'style', 'nav', 'header', 'footer', 'noscript']
  return decodeEntities(stripTags(removeElements(html, drop)))
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
