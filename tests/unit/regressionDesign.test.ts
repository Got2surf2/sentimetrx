import { describe, it, expect } from 'vitest'
import { buildDesign, buildRegVars, type RegVar } from '@/lib/regressionDesign'

const catVar = (field: string, values: string[], remapping?: Record<string, number>): RegVar =>
  ({ key: field, kind: 'categorical', label: field, field, values, remapping })
const numVar = (field: string): RegVar => ({ key: field, kind: 'numeric', label: field, field })
const themeVar = (id: string, keywords: string[], src: string): RegVar =>
  ({ key: 'theme:' + id, kind: 'theme', label: id, themeSource: src, theme: { id, name: id, keywords } as never })

describe('buildDesign — encoding', () => {
  const rows = [
    { visit: 'Dine In', taste: 'Good', txt: 'service was slow' },
    { visit: 'Dine In', taste: 'Good', txt: 'great food' },
    { visit: 'Take Out', taste: 'Poor', txt: 'slow slow' },
    { visit: 'Delivery', taste: 'Good', txt: 'loved it' },
    { visit: 'Dine In', taste: 'Poor', txt: 'ok' },
    { visit: 'Take Out', taste: 'Good', txt: 'fine' },
  ]

  it('one-hot encodes a categorical predictor with the modal level as reference', () => {
    // outcome: taste = Good (1) else 0
    const d = buildDesign(rows, { v: catVar('taste', ['Good', 'Poor']), level: 'Good' }, [
      { v: catVar('visit', ['Dine In', 'Take Out', 'Delivery']), encoding: 'onehot' },
    ])!
    expect(d).not.toBeNull()
    expect(d.n).toBe(6)
    // Dine In is modal (3×) → reference; columns = the other two, sorted
    expect(d.colNames).toEqual(['visit = Delivery', 'visit = Take Out'])
    // row0 Dine In → [0,0]; row2 Take Out → [0,1]; row3 Delivery → [1,0]
    expect(d.X[0]).toEqual([0, 0])
    expect(d.X[2]).toEqual([0, 1])
    expect(d.X[3]).toEqual([1, 0])
    // y = taste==Good : rows 0,1,3,5 = 1 ; rows 2,4 = 0
    expect(d.y).toEqual([1, 1, 0, 1, 0, 1])
    expect(d.nPos).toBe(4)
  })

  it('ordinal encoding uses the remapping as a single column', () => {
    const taste = catVar('taste', ['Poor', 'Good'], { Poor: 1, Good: 5 })
    const d = buildDesign(rows, { v: numVar('n'), cut: 1 }, [{ v: taste, encoding: 'ordinal' }])
    // no numeric 'n' field → outcome undefined for all → null
    expect(d).toBeNull()
    // give a valid numeric outcome
    const rows2 = rows.map((r, i) => ({ ...r, score: i % 2 === 0 ? '5' : '1' }))
    const d2 = buildDesign(rows2, { v: numVar('score'), cut: 3 }, [{ v: taste, encoding: 'ordinal' }])!
    expect(d2.colNames).toEqual(['taste'])
    // Good→5, Poor→1
    expect(d2.X.map((r) => r[0])).toEqual([5, 5, 1, 5, 1, 5])
  })

  it('theme predictor is a 0/1 keyword-match column, and never drops rows', () => {
    const rows2 = rows.map((r, i) => ({ ...r, score: i < 3 ? '5' : '1' }))
    const d = buildDesign(rows2, { v: numVar('score'), cut: 3 }, [{ v: themeVar('Slowness', ['slow'], 'txt') }])!
    expect(d.colNames).toEqual(['Slowness'])
    // rows with 'slow' in txt: row0 ('service was slow'), row2 ('slow slow')
    expect(d.X.map((r) => r[0])).toEqual([1, 0, 1, 0, 0, 0])
    expect(d.n).toBe(6) // theme never drops a row
  })

  it('drops rows missing a numeric predictor (complete-case)', () => {
    const rows2 = [
      { y: '5', x: '1' }, { y: '1', x: '' }, { y: '5', x: '3' }, { y: '1', x: 'abc' }, { y: '5', x: '2' },
    ]
    const d = buildDesign(rows2, { v: numVar('y'), cut: 3 }, [{ v: numVar('x') }])!
    expect(d.n).toBe(3) // rows with x='' and x='abc' dropped
    expect(d.X.map((r) => r[0])).toEqual([1, 3, 2])
  })

  it('theme outcome binarizes on keyword match', () => {
    const d = buildDesign(rows, { v: themeVar('Slowness', ['slow'], 'txt') }, [
      { v: catVar('visit', ['Dine In', 'Take Out', 'Delivery']), encoding: 'onehot' },
    ])!
    expect(d.y).toEqual([1, 0, 1, 0, 0, 0]) // rows mentioning 'slow'
    expect(d.outcomeLabel).toContain('Slowness')
  })
})

describe('buildRegVars', () => {
  it('exposes numeric + categorical fields and themes', () => {
    const fields = [
      { field: 'rating', type: 'numeric', label: 'Rating' },
      { field: 'visit', type: 'categorical', label: 'Visit Type', values: ['A', 'B'] },
      { field: 'id', type: 'id', label: 'ID' },
      { field: 'notes', type: 'open-ended', label: 'Notes' },
    ] as never
    const tm = { themes: [{ id: 't1', name: 'Service', keywords: ['slow'] }] } as never
    const vars = buildRegVars(fields, tm, 'notes')
    expect(vars.map((v) => v.kind)).toEqual(['numeric', 'categorical', 'theme'])
    expect(vars[2].themeSource).toBe('notes')
  })

  it('flags a recognized Likert scale as ordinalable with a rank map (no stored remapping)', () => {
    const fields = [
      { field: 'ft', type: 'categorical', label: 'Food Taste', values: ['Highly Dissatisfied', 'Somewhat Dissatisfied', 'Neither Satisfied nor Dissatisfied', 'Somewhat Satisfied', 'Highly Satisfied'] },
      { field: 'visit', type: 'categorical', label: 'Visit Type', values: ['Dine In', 'Take Out', 'Delivery'] },
    ] as never
    const vars = buildRegVars(fields, null, '')
    const ft = vars.find((v) => v.field === 'ft')!
    expect(ft.ordinalable).toBe(true)
    expect(ft.ordinalMap!['Highly Satisfied']).toBe(5)
    expect(ft.ordinalMap!['Highly Dissatisfied']).toBe(1)
    // a nominal field is not ordinalable
    expect(vars.find((v) => v.field === 'visit')!.ordinalable).toBe(false)
  })
})
