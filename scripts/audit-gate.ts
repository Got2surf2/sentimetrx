// scripts/audit-gate.ts — CI dependency-audit gate (SECURITY.md Open item 2,
// ENGINEERING.md "Dependabot + npm audit").
//
// Fails when `npm audit` reports a HIGH or CRITICAL advisory that is
//   (a) a ROOT — the package has its own advisory (an OBJECT in `via[]`),
//       not merely a dependent of one (collateral carries only strings and
//       falls away when the root is fixed), and
//   (b) not covered by an UNEXPIRED entry in audit-allowlist.json.
//
// The allowlist is for advisories that are verified unreachable and have no
// in-major fix (today: image-size via pptxgenjs — see ENGINEERING.md, "The
// last 2 advisories are a phantom dependency"). Every entry carries a
// `reviewBy` date; once it passes, the gate fails until someone re-verifies
// and moves the date. That is deliberate: an acceptance is a decision with a
// shelf life, not a permanent mute.
//
// Run:  npm run audit:gate          (CI runs this on every push + PR)
//       tsx scripts/audit-gate.ts --json path/to/audit.json   (offline)
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type AllowEntry = {
  ghsa: string        // e.g. GHSA-w3rx-r6r6-pgpr
  package: string     // the ROOT package the advisory is against
  reason: string      // one line; the long form lives in ENGINEERING.md
  reviewBy: string    // YYYY-MM-DD — gate fails after this date until re-reviewed
}

export type Advisory = {
  package: string
  severity: string
  ghsa: string
  title: string
  range: string
}

export type Verdict = {
  ok: boolean
  failures: string[]   // human-readable, one per blocking advisory
  allowed: Advisory[]  // high+ roots covered by an unexpired allowlist entry
  ignoredCollateral: string[]
  totals: Record<string, number>
}

const BLOCKING = new Set(['high', 'critical'])

type ViaObject = { source?: number; name?: string; url?: string; severity?: string; title?: string; range?: string }
type Vuln = { severity?: string; via?: Array<string | ViaObject>; range?: string }
type AuditJson = { vulnerabilities?: Record<string, Vuln>; metadata?: { vulnerabilities?: Record<string, number> } }

function ghsaFromUrl(url: string | undefined): string {
  const m = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(url || '')
  return m ? m[0].toUpperCase() : ''
}

export function evaluateAudit(audit: unknown, allow: AllowEntry[], now: Date = new Date()): Verdict {
  const a = (audit || {}) as AuditJson
  const vulns = a.vulnerabilities || {}
  const failures: string[] = []
  const allowed: Advisory[] = []
  const ignoredCollateral: string[] = []
  const today = now.toISOString().slice(0, 10)

  for (const [pkg, v] of Object.entries(vulns)) {
    const roots = (v.via || []).filter((x): x is ViaObject => typeof x === 'object' && x !== null)
    if (roots.length === 0) {
      if (BLOCKING.has(String(v.severity))) ignoredCollateral.push(`${pkg} (${v.severity}, collateral)`)
      continue
    }
    for (const r of roots) {
      const sev = String(r.severity || v.severity || '').toLowerCase()
      if (!BLOCKING.has(sev)) continue
      const adv: Advisory = { package: pkg, severity: sev, ghsa: ghsaFromUrl(r.url), title: r.title || '', range: r.range || '' }
      const entry = allow.find(e => e.ghsa.toUpperCase() === adv.ghsa && e.package === pkg)
      if (!entry) {
        failures.push(`${sev.toUpperCase()} ${pkg} ${adv.ghsa || '(no GHSA id)'} — ${adv.title} [${adv.range}] — not allowlisted`)
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewBy) || entry.reviewBy < today) {
        failures.push(`${sev.toUpperCase()} ${pkg} ${adv.ghsa} — allowlist entry EXPIRED (reviewBy ${entry.reviewBy}); re-verify and move the date or fix the root`)
      } else {
        allowed.push(adv)
      }
    }
  }

  return { ok: failures.length === 0, failures, allowed, ignoredCollateral, totals: a.metadata?.vulnerabilities || {} }
}

function runNpmAudit(): unknown {
  // npm audit exits non-zero whenever ANY vulnerability exists; the JSON is
  // still on stdout, so read it from the error as well as the success path.
  try {
    return JSON.parse(execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
  } catch (err) {
    const out = (err as { stdout?: string }).stdout
    if (out) return JSON.parse(out)
    throw err
  }
}

function main() {
  const args = process.argv.slice(2)
  const jsonIdx = args.indexOf('--json')
  const audit = jsonIdx >= 0 ? JSON.parse(readFileSync(args[jsonIdx + 1], 'utf8')) : runNpmAudit()
  const allow = JSON.parse(readFileSync(resolve(process.cwd(), 'audit-allowlist.json'), 'utf8')) as AllowEntry[]
  const v = evaluateAudit(audit, allow)

  console.log(`npm audit totals: ${JSON.stringify(v.totals)}`)
  for (const adv of v.allowed) console.log(`  allowed  ${adv.severity.toUpperCase()} ${adv.package} ${adv.ghsa} — ${adv.title}`)
  for (const c of v.ignoredCollateral) console.log(`  collateral ${c}`)
  if (v.ok) {
    console.log(`audit gate: PASS (${v.allowed.length} allowlisted high+ root advisories, 0 blocking)`)
    return
  }
  for (const f of v.failures) console.log(`  BLOCK  ${f}`)
  console.log(`audit gate: FAIL — ${v.failures.length} blocking advisor${v.failures.length === 1 ? 'y' : 'ies'}. Fix the root (npm audit fix, or scope/repoint an overrides pin — never --force here), or add a verified entry to audit-allowlist.json with a reviewBy date.`)
  process.exit(1)
}

if (process.argv[1] && /audit-gate\.(ts|js|mjs)$/.test(process.argv[1])) main()
