// Tests for the panel-roster speaker match (lib/recordings/panel.ts) — the gate
// that excludes organizer/panel speech from community-voice analysis.

import { describe, it, expect } from 'vitest'
import { isPanelMember } from '@/lib/recordings/panel'

const PANEL = [
  { name: 'Nick Nesta', role: 'Mayor of Apopka' },
  { name: 'Brian Sanders', role: 'Transportation Planning Division Manager' },
  { name: 'Hatem A. Abou-Senna', role: 'Project Manager' },
  { name: 'Babuji Ambikapathy', role: 'VHB Consultant' },
]

describe('isPanelMember', () => {
  it('matches an exact panel name', () => {
    expect(isPanelMember('Brian Sanders', PANEL)).toBe(true)
    expect(isPanelMember('Nick Nesta', PANEL)).toBe(true)
  })

  it('tolerates middle initials (Hatem A. Abou-Senna ↔ Hatem Abou-Senna)', () => {
    expect(isPanelMember('Hatem Abou-Senna', PANEL)).toBe(true)
    expect(isPanelMember('Hatem A. Abou-Senna', PANEL)).toBe(true)
  })

  it('is case- and punctuation-insensitive', () => {
    expect(isPanelMember('brian   sanders', PANEL)).toBe(true)
    expect(isPanelMember('"Babuji Ambikapathy"', PANEL)).toBe(true)
  })

  it('does NOT match a community member with a different name', () => {
    expect(isPanelMember('Tatiana Morales', PANEL)).toBe(false)
    expect(isPanelMember('Sylvester Hall', PANEL)).toBe(false)
    expect(isPanelMember('Francine Boykin', PANEL)).toBe(false)
  })

  it('is conservative: a partial/first-name-only match does not trigger', () => {
    // "Brian" alone shouldn't exclude a different Brian in the audience.
    expect(isPanelMember('Brian', PANEL)).toBe(false)
  })

  it('returns false for empty/absent name or roster (nothing excluded)', () => {
    expect(isPanelMember(null, PANEL)).toBe(false)
    expect(isPanelMember('', PANEL)).toBe(false)
    expect(isPanelMember('Brian Sanders', [])).toBe(false)
    expect(isPanelMember('Brian Sanders', null)).toBe(false)
  })
})
