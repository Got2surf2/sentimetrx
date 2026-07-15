import { describe, it, expect } from 'vitest'
import { strictScaleMapping } from '@/lib/scaleUtils'

// strictScaleMapping gates the SYSTEM-WIDE auto-quant of Likert categoricals
// (lib/datasetUtils schema detection). It must map genuine ranked scales and
// REJECT nominal fields — a false positive would silently turn a category like
// "Region" into a bogus number everywhere.
describe('strictScaleMapping — conservative Likert detection', () => {
  it('maps a full satisfaction scale 1→5 in order', () => {
    const m = strictScaleMapping(['Highly Satisfied', 'Somewhat Satisfied', 'Neither Satisfied nor Dissatisfied', 'Somewhat Dissatisfied', 'Highly Dissatisfied'])!
    expect(m).not.toBeNull()
    expect(m['Highly Dissatisfied']).toBe(1)
    expect(m['Neither Satisfied nor Dissatisfied']).toBe(3)
    expect(m['Highly Satisfied']).toBe(5)
  })

  it('maps a Poor→Excellent quality scale', () => {
    const m = strictScaleMapping(['Poor', 'Fair', 'Average', 'Good', 'Excellent'])!
    expect(m['Poor']).toBe(1)
    expect(m['Excellent']).toBe(5)
  })

  it('maps an agreement scale', () => {
    const m = strictScaleMapping(['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'])!
    expect(m['Strongly Disagree']).toBe(1)
    expect(m['Strongly Agree']).toBe(5)
  })

  it('REJECTS nominal fields (no false-positive auto-quant)', () => {
    expect(strictScaleMapping(['Dine In', 'Take Out', 'Delivery'])).toBeNull()
    expect(strictScaleMapping(['New York', 'Los Angeles', 'Chicago', 'Houston'])).toBeNull()
    expect(strictScaleMapping(['Red', 'Green', 'Blue'])).toBeNull()
    expect(strictScaleMapping(['Alice', 'Bob', 'Carol'])).toBeNull()
  })

  it('REJECTS a mostly-nominal field with one coincidental scale hit', () => {
    // "Good" matches the quality scale but the rest are product names → not a scale
    expect(strictScaleMapping(['Good', 'Widget', 'Gadget', 'Gizmo'])).toBeNull()
  })
})
