// lib/htmlStrip.ts — the properties CodeQL flagged fourteen inline regexes for:
// tag stripping must reach a fixed point (split tags cannot reassemble),
// closing tags may carry whitespace, and `&amp;` decodes last (one level).
import { describe, it, expect } from 'vitest'
import { stripTags, removeElements, decodeEntities, htmlToPlainText } from '@/lib/htmlStrip'
import { isUrlOnly } from '@/lib/urlOnly'
import { randomId } from '@/lib/clientId'

describe('stripTags', () => {
  it('removes ordinary tags, separating words', () => {
    expect(stripTags('<p>a</p><p>b</p>').replace(/\s+/g, ' ').trim()).toBe('a b')
  })
  it('reaches a fixed point: a tag split by an inner tag cannot reassemble into one', () => {
    // The guarantee is "no `<…` tag opener survives", not "the payload is
    // removed verbatim" — leftover text is inert once no `<` remains.
    const out = stripTags('<scr<b>ipt>alert(1)</scr<b>ipt>', '')
    expect(out).not.toMatch(/</)
    expect(out).not.toMatch(/<script/i)
    expect(stripTags('<<b>script>x</<b>script>', '')).not.toMatch(/</)
  })
  it('pathological nesting still ends with no tag opener left (loose `>` in prose is kept — "a > b" is text)', () => {
    const evil = '<'.repeat(40) + 'x' + '>'.repeat(40)
    expect(stripTags(evil, '')).not.toMatch(/</)
    expect(stripTags('temp > 5 and < 9', '')).toBe('temp > 5 and < 9')
  })
})

describe('removeElements', () => {
  it('drops whole elements including a closing tag with whitespace (</script >)', () => {
    expect(removeElements('a<script>x</script >b<style type="x">y</style>c', ['script', 'style']).replace(/\s+/g, '')).toBe('abc')
  })
  it('fixed point: an element that re-forms after an inner removal is removed too', () => {
    const s = '<script><script>inner</script>outer</script>tail'
    expect(removeElements(s, ['script'])).not.toMatch(/<script/i)
    expect(removeElements(s, ['script'])).toContain('tail')
  })
  it('no tags → unchanged', () => { expect(removeElements('plain', [])).toBe('plain') })
})

describe('decodeEntities', () => {
  it('decodes numeric, hex and named entities', () => {
    expect(decodeEntities('&#65;&#x42;&lt;&gt;&quot;&apos;&nbsp;&rsquo;')).toBe('AB<>"\' ’')
  })
  it('decodes &amp; LAST and only once — &amp;lt; is &lt;, never <', () => {
    expect(decodeEntities('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;')
    expect(decodeEntities('a &amp; b')).toBe('a & b')
  })
  it('drops out-of-range numeric references instead of throwing', () => {
    expect(decodeEntities('&#99999999;x')).toBe('x')
  })
})

describe('htmlToPlainText', () => {
  it('drops non-content elements, strips, decodes, collapses whitespace', () => {
    const html = '<html><head><style>p{}</style><script>1</script></head><body><nav>menu</nav><h1>Title &amp; more</h1>\n\n<p>Body   text</p><footer>f</footer></body></html>'
    expect(htmlToPlainText(html)).toBe('Title & more Body text')
  })
  it('honours a custom drop list', () => {
    expect(htmlToPlainText('<nav>keep</nav><p>x</p>', { drop: ['script'] })).toBe('keep x')
  })
})

describe('isUrlOnly (linear replacement for the exponential URL_ONLY_RE)', () => {
  it('true for one or more bare URLs, false for prose or empty', () => {
    expect(isUrlOnly('https://a.b/c')).toBe(true)
    expect(isUrlOnly('  http://x.y  https://z.w/q?a=1 ')).toBe(true)
    expect(isUrlOnly('see https://a.b')).toBe(false)
    expect(isUrlOnly('')).toBe(false)
    expect(isUrlOnly('   ')).toBe(false)
  })
  it('stays fast on the adversarial prefix that blew up the old regex', () => {
    const t0 = Date.now(); isUrlOnly('http://' + '!'.repeat(50_000)); expect(Date.now() - t0).toBeLessThan(200)
  })
})

describe('randomId', () => {
  it('mints unique, prefixed, non-empty ids from WebCrypto', () => {
    const a = randomId('sess_'), b = randomId('sess_')
    expect(a).toMatch(/^sess_[0-9a-f-]{32,36}$/); expect(a).not.toBe(b)
    expect(randomId()).toMatch(/^[0-9a-f-]{32,36}$/)
  })
})
