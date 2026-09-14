// The CI dependency-audit gate (scripts/audit-gate.ts). Pins the decision
// rules on npm-audit-shaped fixtures: roots vs collateral, severity floor,
// allowlist match, and allowlist expiry.
import { describe, it, expect } from 'vitest'
import { evaluateAudit, type AllowEntry } from '../../scripts/audit-gate'

const NOW = new Date('2026-09-14T12:00:00Z')

function root(pkg: string, severity: string, ghsa: string, title = 't') {
  return {
    [pkg]: {
      severity,
      range: '*',
      via: [{ source: 1, name: pkg, url: `https://github.com/advisories/${ghsa}`, severity, title, range: '<1' }],
    },
  }
}
function collateral(pkg: string, severity: string, viaPkg: string) {
  return { [pkg]: { severity, range: '*', via: [viaPkg] } }
}
const audit = (vulnerabilities: Record<string, unknown>) => ({ vulnerabilities, metadata: { vulnerabilities: {} } })

const ALLOW: AllowEntry[] = [
  { ghsa: 'GHSA-w3rx-r6r6-pgpr', package: 'image-size', reason: 'verified unreachable', reviewBy: '2027-03-01' },
]

describe('audit gate', () => {
  it('passes when there are no vulnerabilities', () => {
    expect(evaluateAudit(audit({}), ALLOW, NOW).ok).toBe(true)
  })

  it('blocks a high/critical ROOT that is not allowlisted', () => {
    const v = evaluateAudit(audit({ ...root('next', 'critical', 'GHSA-aaaa-bbbb-cccc', 'RCE') }), ALLOW, NOW)
    expect(v.ok).toBe(false)
    expect(v.failures).toHaveLength(1)
    expect(v.failures[0]).toMatch(/CRITICAL next GHSA-AAAA-BBBB-CCCC — RCE/)
  })

  it('passes an allowlisted high root and reports it as allowed', () => {
    const v = evaluateAudit(audit({ ...root('image-size', 'high', 'GHSA-w3rx-r6r6-pgpr') }), ALLOW, NOW)
    expect(v.ok).toBe(true)
    expect(v.allowed.map(a => a.ghsa)).toEqual(['GHSA-W3RX-R6R6-PGPR'])
  })

  it('an allowlist entry only covers the package it names', () => {
    const v = evaluateAudit(audit({ ...root('other-pkg', 'high', 'GHSA-w3rx-r6r6-pgpr') }), ALLOW, NOW)
    expect(v.ok).toBe(false)
  })

  it('ignores COLLATERAL packages (string-only via) even at high severity', () => {
    const v = evaluateAudit(
      audit({ ...root('image-size', 'high', 'GHSA-w3rx-r6r6-pgpr'), ...collateral('pptxgenjs', 'high', 'image-size') }),
      ALLOW, NOW,
    )
    expect(v.ok).toBe(true)
    expect(v.ignoredCollateral).toEqual(['pptxgenjs (high, collateral)'])
  })

  it('does not block on moderate or low roots', () => {
    const v = evaluateAudit(audit({ ...root('qs', 'moderate', 'GHSA-dddd-eeee-ffff'), ...root('x', 'low', 'GHSA-1111-2222-3333') }), ALLOW, NOW)
    expect(v.ok).toBe(true)
  })

  it('blocks when the allowlist entry has EXPIRED', () => {
    const expired: AllowEntry[] = [{ ...ALLOW[0], reviewBy: '2026-09-13' }]
    const v = evaluateAudit(audit({ ...root('image-size', 'high', 'GHSA-w3rx-r6r6-pgpr') }), expired, NOW)
    expect(v.ok).toBe(false)
    expect(v.failures[0]).toMatch(/EXPIRED \(reviewBy 2026-09-13\)/)
  })

  it('still passes on the reviewBy date itself (inclusive)', () => {
    const edge: AllowEntry[] = [{ ...ALLOW[0], reviewBy: '2026-09-14' }]
    expect(evaluateAudit(audit({ ...root('image-size', 'high', 'GHSA-w3rx-r6r6-pgpr') }), edge, NOW).ok).toBe(true)
  })
})
