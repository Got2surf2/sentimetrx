import { describe, it, expect } from 'vitest'
import { errMessage } from '@/lib/log'

// Regression for the '[object Object]' class: Supabase/fetch errors are plain
// objects, not Error instances — String() hid a real prod failure
// (agents.industry 42703) behind '[object Object]' for weeks.
describe('errMessage', () => {
  it('Error instance → its message', () => {
    expect(errMessage(new Error('boom'))).toBe('boom')
  })

  it('PostgrestError-shaped object → message | code | details | hint', () => {
    expect(errMessage({ code: '42703', details: null, hint: null, message: 'column agents.industry does not exist' }))
      .toBe('column agents.industry does not exist | 42703')
  })

  it('object without conventional fields → JSON', () => {
    expect(errMessage({ weird: true })).toBe('{"weird":true}')
  })

  it('primitives pass through', () => {
    expect(errMessage('plain string')).toBe('plain string')
    expect(errMessage(undefined)).toBe('undefined')
  })
})
