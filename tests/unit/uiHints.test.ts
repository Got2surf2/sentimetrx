import { describe, expect, it } from 'vitest'
import {
  extractUiHints,
  validateHint,
  parseExtractorJson,
  buildExtractorInput,
  UI_HINT_EXTRACTOR_PROMPT,
  type UiHintClassifier,
} from '@/lib/uiHints'

// Stub classifier — returns a canned response. Lets us assert end-to-end
// behavior of the extractor without an LLM call.
function stub(response: string): UiHintClassifier {
  return async () => response
}

describe('parseExtractorJson', () => {
  it('parses a bare JSON object', () => {
    expect(parseExtractorJson('{"hint":null}')).toEqual({ hint: null })
  })

  it('strips markdown code fences', () => {
    const raw = '```json\n{"hint": {"type": "parking"}}\n```'
    expect(parseExtractorJson(raw)).toEqual({ hint: { type: 'parking' } })
  })

  it('strips leading and trailing prose', () => {
    const raw = 'Here is the JSON:\n{"hint": null}\nLet me know if you need more.'
    expect(parseExtractorJson(raw)).toEqual({ hint: null })
  })

  it('returns null on garbage input', () => {
    expect(parseExtractorJson('not json at all')).toBeNull()
    expect(parseExtractorJson('')).toBeNull()
    expect(parseExtractorJson('{ unterminated')).toBeNull()
  })
})

describe('validateHint', () => {
  it('accepts a complete terminal_map hint and preserves fields', () => {
    const out = validateHint({ type: 'terminal_map', from: 'C', to: 'A', via: 'terminal_link_apm', gate: 'A14' })
    expect(out).toEqual({ type: 'terminal_map', from: 'C', to: 'A', via: 'terminal_link_apm', gate: 'A14' })
  })

  it('drops invalid terminal letters', () => {
    const out = validateHint({ type: 'terminal_map', from: 'Z', to: 'A' })
    expect(out).toEqual({ type: 'terminal_map', to: 'A' })
  })

  it('drops invalid via value', () => {
    const out = validateHint({ type: 'terminal_map', via: 'helicopter' as any })
    expect(out).toEqual({ type: 'terminal_map' })
  })

  it('validates parking with highlight array', () => {
    const out = validateHint({ type: 'parking', highlight: ['garage_c', 'endeavour'] })
    expect(out).toEqual({ type: 'parking', highlight: ['garage_c', 'endeavour'] })
  })

  it('caps parking highlight array length to 8', () => {
    const ten = Array.from({ length: 10 }, (_, i) => 'lot_' + i)
    const out = validateHint({ type: 'parking', highlight: ten }) as any
    expect(out.highlight.length).toBe(8)
  })

  it('validates restaurants with context label', () => {
    const out = validateHint({ type: 'restaurants', place_ids: ['ChIJ_abc'], context: 'terminal_a_airside' })
    expect(out).toEqual({ type: 'restaurants', place_ids: ['ChIJ_abc'], context: 'terminal_a_airside' })
  })

  it('coerces missing place_ids to []', () => {
    const out = validateHint({ type: 'restaurants' }) as any
    expect(out.type).toBe('restaurants')
    expect(out.place_ids).toEqual([])
  })

  it('validates link_card with flymco URL', () => {
    const out = validateHint({
      type: 'link_card',
      title: 'MCO Reserve',
      body: 'Free security time slots.',
      cta_url: 'https://flymco.com/speed-through-mco',
      cta_label: 'Reserve',
    })
    expect(out).toBeTruthy()
    expect((out as any).cta_url).toBe('https://flymco.com/speed-through-mco')
  })

  it('rejects link_card with non-flymco cta_url (open-redirect guard)', () => {
    const out = validateHint({
      type: 'link_card',
      title: 'Sketchy',
      body: 'body',
      cta_url: 'https://attacker.example.com/phish',
      cta_label: 'Click',
    })
    expect(out).toBeNull()
  })

  it('rejects link_card missing required fields', () => {
    const out = validateHint({ type: 'link_card', title: 'x' })
    expect(out).toBeNull()
  })

  it('returns null for unknown hint types', () => {
    expect(validateHint({ type: 'made_up' })).toBeNull()
    expect(validateHint(null)).toBeNull()
    expect(validateHint('string')).toBeNull()
  })

  it('truncates oversized strings', () => {
    const longTitle = 'x'.repeat(200)
    const out = validateHint({
      type: 'link_card',
      title: longTitle,
      body: 'b',
      cta_url: 'https://flymco.com/x',
      cta_label: 'Click',
    }) as any
    expect(out.title.length).toBe(80)
  })
})

describe('buildExtractorInput', () => {
  it('combines user + assistant turns with a separator', () => {
    const s = buildExtractorInput('hello', 'hi there')
    expect(s).toContain('USER: hello')
    expect(s).toContain('ASSISTANT: hi there')
  })

  it('truncates oversized inputs', () => {
    const s = buildExtractorInput('x'.repeat(2000), 'y'.repeat(5000))
    expect(s.length).toBeLessThan(2500)
  })
})

describe('UI_HINT_EXTRACTOR_PROMPT', () => {
  it('documents all four hint types', () => {
    expect(UI_HINT_EXTRACTOR_PROMPT).toContain('terminal_map')
    expect(UI_HINT_EXTRACTOR_PROMPT).toContain('parking')
    expect(UI_HINT_EXTRACTOR_PROMPT).toContain('restaurants')
    expect(UI_HINT_EXTRACTOR_PROMPT).toContain('link_card')
  })

  it('instructs JSON-only output', () => {
    expect(UI_HINT_EXTRACTOR_PROMPT).toMatch(/JSON only/i)
  })
})

describe('extractUiHints (end-to-end with stub classifier)', () => {
  it('returns empty on empty input without calling the classifier', async () => {
    let called = false
    const classifier: UiHintClassifier = async () => { called = true; return '{"hint":null}' }
    expect(await extractUiHints({ userMessage: '', assistantMessage: 'reply', classifier })).toEqual({ hints: [], next_chips: [] })
    expect(await extractUiHints({ userMessage: 'q', assistantMessage: '', classifier })).toEqual({ hints: [], next_chips: [] })
    expect(called).toBe(false)
  })

  it('returns no hint when classifier emits hint:null', async () => {
    const out = await extractUiHints({
      userMessage: 'whatever',
      assistantMessage: 'something out of scope',
      classifier: stub('{"hint": null, "next_chips": []}'),
    })
    expect(out.hints).toEqual([])
  })

  it('extracts a terminal_map hint', async () => {
    const out = await extractUiHints({
      userMessage: 'How do I get from C to A?',
      assistantMessage: 'Take the Terminal Link APM from the Train Station to Terminal B, then cross to A.',
      classifier: stub('{"hint": {"type":"terminal_map","from":"C","to":"A","via":"terminal_link_apm"}, "next_chips": ["How long is the APM ride?"]}'),
    })
    expect(out.hints).toEqual([{ type: 'terminal_map', from: 'C', to: 'A', via: 'terminal_link_apm' }])
    expect(out.next_chips).toEqual(['How long is the APM ride?'])
  })

  it('extracts a parking hint with highlight', async () => {
    const out = await extractUiHints({
      userMessage: "Where's the closest parking to Terminal C?",
      assistantMessage: 'Parking Garage C is the closest — directly connected to Terminal C via Level 4.',
      classifier: stub('{"hint": {"type":"parking","highlight":["garage_c"]}, "next_chips": []}'),
    })
    expect(out.hints).toEqual([{ type: 'parking', highlight: ['garage_c'] }])
  })

  it('extracts a restaurants hint with context', async () => {
    const out = await extractUiHints({
      userMessage: 'Where can I eat near Gate A14?',
      assistantMessage: 'Try Starbucks, Auntie Annes, or Cibo Express — all near A14.',
      classifier: stub('{"hint": {"type":"restaurants","place_ids":[],"context":"terminal_a_airside"}, "next_chips": ["Any sit-down options?"]}'),
    })
    expect(out.hints).toEqual([{ type: 'restaurants', place_ids: [], context: 'terminal_a_airside' }])
  })

  it('extracts a link_card hint for MCO Reserve', async () => {
    const out = await extractUiHints({
      userMessage: 'What is MCO Reserve?',
      assistantMessage: 'MCO Reserve is a free service that lets you book a TSA time slot.',
      classifier: stub(JSON.stringify({
        hint: {
          type: 'link_card',
          title: 'MCO Reserve',
          body: 'Free TSA time slots.',
          cta_url: 'https://flymco.com/speed-through-mco',
          cta_label: 'Reserve a time slot',
        },
        next_chips: ['How do I claim a slot?'],
      })),
    })
    expect(out.hints).toHaveLength(1)
    expect(out.hints[0].type).toBe('link_card')
    expect((out.hints[0] as any).cta_url).toBe('https://flymco.com/speed-through-mco')
  })

  it('returns no hint when classifier throws', async () => {
    const out = await extractUiHints({
      userMessage: 'q',
      assistantMessage: 'a',
      classifier: async () => { throw new Error('LLM provider exploded') },
    })
    expect(out).toEqual({ hints: [], next_chips: [] })
  })

  it('returns no hint when classifier emits malformed JSON', async () => {
    const out = await extractUiHints({
      userMessage: 'q',
      assistantMessage: 'a',
      classifier: stub('this is not json'),
    })
    expect(out).toEqual({ hints: [], next_chips: [] })
  })

  it('returns no hint when classifier emits an unknown hint type', async () => {
    const out = await extractUiHints({
      userMessage: 'q',
      assistantMessage: 'a',
      classifier: stub('{"hint": {"type":"weather"}, "next_chips": []}'),
    })
    expect(out.hints).toEqual([])
  })

  it('still surfaces chips even when the hint is rejected', async () => {
    const out = await extractUiHints({
      userMessage: 'q',
      assistantMessage: 'a',
      classifier: stub('{"hint": {"type":"weather"}, "next_chips": ["chip one", "chip two"]}'),
    })
    expect(out.hints).toEqual([])
    expect(out.next_chips).toEqual(['chip one', 'chip two'])
  })

  it('returns no hint when classifier emits a link_card with off-domain URL', async () => {
    const out = await extractUiHints({
      userMessage: 'q',
      assistantMessage: 'a',
      classifier: stub(JSON.stringify({
        hint: {
          type: 'link_card',
          title: 'Sketchy',
          body: 'body',
          cta_url: 'https://evil.example.com/phish',
          cta_label: 'Click',
        },
        next_chips: [],
      })),
    })
    expect(out.hints).toEqual([])
  })

  it('tolerates code-fenced output from the model', async () => {
    const out = await extractUiHints({
      userMessage: 'q',
      assistantMessage: 'a',
      classifier: stub('```json\n{"hint": {"type":"parking","highlight":["garage_a"]}, "next_chips": []}\n```'),
    })
    expect(out.hints).toEqual([{ type: 'parking', highlight: ['garage_a'] }])
  })

  it('caps next_chips to 4 and drops invalid entries', async () => {
    const out = await extractUiHints({
      userMessage: 'q',
      assistantMessage: 'a',
      classifier: stub(JSON.stringify({
        hint: null,
        next_chips: ['one', 'two', 'three', 'four', 'five', '', 42, null, 'six'],
      })),
    })
    expect(out.next_chips).toEqual(['one', 'two', 'three', 'four'])
  })
})
