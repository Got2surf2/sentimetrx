import { describe, it, expect } from 'vitest'
import { parseCSVRecords, parseCSV, parseTSV, isSurveyMonkeyCSV, parseSurveyMonkeyCSV } from '@/lib/csv'

describe('parseCSVRecords — RFC4180 field splitting', () => {
  it('splits plain fields on commas', () => {
    expect(parseCSVRecords('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })

  it('keeps commas inside quoted fields', () => {
    expect(parseCSVRecords('a,b\n"one, two",3')).toEqual([['a', 'b'], ['one, two', '3']])
  })

  // The prod bug: the old parser toggled on every `"` and never emitted one,
  // mangling 2,796/125,897 ANES rows. `""` inside quotes is a literal quote.
  it('emits "" inside a quoted field as a literal quote (ANES regression)', () => {
    const rows = parseCSVRecords('verbatim\n"He said ""no deal"" twice"')
    expect(rows[1][0]).toBe('He said "no deal" twice')
  })

  it('handles a quoted field that is nothing but an escaped quote', () => {
    expect(parseCSVRecords('a,b\n"""",x')[1]).toEqual(['"', 'x'])
  })

  it('keeps newlines inside quoted fields in one record', () => {
    const rows = parseCSVRecords('a,b\n"line one\nline two",x\ny,z')
    expect(rows).toEqual([['a', 'b'], ['line one\nline two', 'x'], ['y', 'z']])
  })

  it('normalizes CRLF line endings and CRLF inside quotes', () => {
    expect(parseCSVRecords('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCSVRecords('a\r\n"x\r\ny"')[1][0]).toBe('x\ny')
  })

  it('strips a leading BOM', () => {
    expect(parseCSVRecords('\uFEFFa,b\n1,2')[0]).toEqual(['a', 'b'])
  })

  it('skips blank lines but keeps rows of empty fields', () => {
    expect(parseCSVRecords('a,b\n\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCSVRecords('a,b,c\n,,')).toEqual([['a', 'b', 'c'], ['', '', '']])
  })

  it('trims whitespace around fields (previous upload behavior)', () => {
    expect(parseCSVRecords('a, b ,c\n 1,2 , 3 ')[1]).toEqual(['1', '2', '3'])
  })

  it('handles empty and header-only input', () => {
    expect(parseCSVRecords('')).toEqual([])
    expect(parseCSVRecords('a,b')).toEqual([['a', 'b']])
  })
})

describe('parseCSV — row objects from headers', () => {
  it('keys rows by the header record', () => {
    expect(parseCSV('name,score\nAna,9\nSarina,10')).toEqual([
      { name: 'Ana', score: '9' },
      { name: 'Sarina', score: '10' },
    ])
  })

  it('fills missing trailing fields with empty strings', () => {
    expect(parseCSV('a,b,c\n1,2')).toEqual([{ a: '1', b: '2', c: '' }])
  })

  it('returns [] without a data row', () => {
    expect(parseCSV('')).toEqual([])
    expect(parseCSV('only,headers')).toEqual([])
  })

  it('parses a quoted verbatim with quotes, commas, and a newline intact', () => {
    const rows = parseCSV('id,comment\n7,"They said ""wait, what?""\nthen left"')
    expect(rows).toEqual([{ id: '7', comment: 'They said "wait, what?"\nthen left' }])
  })
})

describe('parseTSV', () => {
  it('splits on tabs and keys by headers', () => {
    expect(parseTSV('a\tb\n1\t2')).toEqual([{ a: '1', b: '2' }])
  })

  it('returns [] without a data row', () => {
    expect(parseTSV('a\tb')).toEqual([])
  })
})

describe('SurveyMonkey detection & parsing', () => {
  const smText = [
    'Respondent ID,Start Date,How satisfied are you?,How satisfied are you?,Any comments?',
    ',,Quality,Price,Open-Ended Response',
    '101,1/2/2026,Very satisfied,Neutral,"Great, but pricey"',
    '102,1/3/2026,Neutral,Unsatisfied,"Said ""meh"" overall"',
  ].join('\n')

  it('detects the two-header-row SurveyMonkey shape', () => {
    expect(isSurveyMonkeyCSV(smText)).toBe(true)
  })

  it('does not flag a plain single-header CSV', () => {
    expect(isSurveyMonkeyCSV('name,score\nAna,9\nSarina,10\nMax,7')).toBe(false)
  })

  it('does not flag input with fewer than 3 rows', () => {
    expect(isSurveyMonkeyCSV('a,b\n1,2')).toBe(false)
  })

  it('merges matrix sub-labels into parent headers', () => {
    const { mergedHeaders } = parseSurveyMonkeyCSV(smText)
    expect(mergedHeaders).toEqual([
      'Respondent ID',
      'Start Date',
      'How satisfied are you? - Quality',
      'How satisfied are you? - Price',
      'Any comments?',
    ])
  })

  it('carries a blank parent forward for matrix continuations', () => {
    const text = 'Q1,,\nA,B,C\nx,y,z'
    const { mergedHeaders } = parseSurveyMonkeyCSV(text)
    expect(mergedHeaders).toEqual(['Q1 - A', 'Q1 - B', 'Q1 - C'])
  })

  it('deduplicates repeated merged headers with a counter', () => {
    const text = 'Q,Q\nResponse,Response\n1,2'
    const { mergedHeaders } = parseSurveyMonkeyCSV(text)
    expect(mergedHeaders).toEqual(['Q', 'Q (2)'])
  })

  it('parses data rows against merged headers, preserving escaped quotes', () => {
    const { rows } = parseSurveyMonkeyCSV(smText)
    expect(rows).toHaveLength(2)
    expect(rows[0]['How satisfied are you? - Quality']).toBe('Very satisfied')
    expect(rows[0]['Any comments?']).toBe('Great, but pricey')
    expect(rows[1]['Any comments?']).toBe('Said "meh" overall')
  })

  it('returns empty for fewer than 3 records', () => {
    expect(parseSurveyMonkeyCSV('a,b\n1,2')).toEqual({ rows: [], mergedHeaders: [] })
  })
})
