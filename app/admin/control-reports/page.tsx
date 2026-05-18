import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { resolveOrg, effectiveFeatures } from '@/lib/resolveOrg'
import TopNav from '@/components/nav/TopNav'
import { loadAllReports } from '@/lib/governanceReports'
import { loadAllDriftReports } from '@/lib/specDriftReports'

export const dynamic = 'force-dynamic'

const HERMES = '#E8632A'
const TEAL   = '#0F7173'
const RED    = '#dc2626'
const GREEN  = '#059669'

export default async function ControlReportsIndexPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, full_name, features, organizations(is_admin_org, logo_url, name, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any
  if (!orgData?.is_admin_org) redirect('/dashboard')
  const features = effectiveFeatures(orgData?.features, (userData as any)?.features)

  const [governance, drift] = await Promise.all([
    loadAllReports(),
    loadAllDriftReports(),
  ])

  const latestGov = governance[governance.length - 1] || null
  const latestDrift = drift[drift.length - 1] || null

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <TopNav
        logoUrl={orgData?.logo_url || ''}
        orgName={orgData?.name}
        isAdmin
        userEmail={user.email}
        fullName={userData?.full_name}
        features={features}
        currentPage="admin"
      />
      <div style={{ paddingTop: 56 }} className="flex-1">
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-800">Control Reports</h1>
            <p className="text-sm text-gray-500 mt-1">
              Weekly, machine-generated reports reviewed and merged by a human. Each report is the evidence artifact for one control: codebase governance, documentation hygiene, and (over time) more.
            </p>
          </div>

          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            <ReportTile
              href="/admin/control-reports/governance"
              title="Governance"
              subtitle="7-category codebase health audit"
              cadence="Monday 04:00 ET"
              latestLabel={latestGov ? `${latestGov.week} score` : 'No reports yet'}
              latestValue={latestGov?.total != null ? latestGov.total.toFixed(0) : '—'}
              latestSuffix={latestGov?.total != null ? '/ 100' : ''}
              valueColor={HERMES}
              countLabel={`${governance.length} report${governance.length === 1 ? '' : 's'} recorded`}
            />
            <ReportTile
              href="/admin/control-reports/spec-drift"
              title="Spec Drift"
              subtitle="Did docs keep pace with code?"
              cadence="Monday 02:00 ET"
              latestLabel={latestDrift ? `${latestDrift.week} drifted` : 'No reports yet'}
              latestValue={latestDrift?.drifted != null ? latestDrift.drifted.toString() : '—'}
              latestSuffix={latestDrift?.specsTracked != null ? `/ ${latestDrift.specsTracked}` : ''}
              valueColor={latestDrift?.drifted != null && latestDrift.drifted > 0 ? RED : GREEN}
              countLabel={`${drift.length} report${drift.length === 1 ? '' : 's'} recorded`}
            />
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-6 mt-6">
            <h2 className="text-base font-bold text-gray-800 mb-2">What this is</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              Sentimetrx is built primarily with AI coding assistance. Each control report is a weekly artifact a human reviews and merges — the merge is the governance signal, and the git history is the audit trail. The same evidence pattern is used for SOC 2 CC4 (control monitoring), NIST AI RMF, and EU AI Act human-oversight requirements.
            </p>
            <div className="mt-4 text-sm text-gray-600">
              <span className="font-semibold text-gray-700">Source files:</span>{' '}
              <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">docs/weekly-reports/</code>{' '}
              ·{' '}
              <a
                href="https://github.com/Got2surf2/sentimetrx/pulls"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium hover:underline"
                style={{ color: TEAL }}>
                Open PR list ↗
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ReportTile({
  href, title, subtitle, cadence, latestLabel, latestValue, latestSuffix, valueColor, countLabel,
}: {
  href: string
  title: string
  subtitle: string
  cadence: string
  latestLabel: string
  latestValue: string
  latestSuffix: string
  valueColor: string
  countLabel: string
}) {
  return (
    <Link href={href} className="bg-white border border-gray-200 rounded-2xl p-6 hover:shadow-md transition-shadow block" style={{ textDecoration: 'none' }}>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold text-gray-800">{title}</h2>
        <span className="text-xs text-gray-400">{cadence}</span>
      </div>
      <p className="text-sm text-gray-500 mb-4">{subtitle}</p>
      <div className="flex items-baseline gap-2">
        <span style={{ fontSize: 36, fontWeight: 800, color: valueColor, lineHeight: 1 }}>{latestValue}</span>
        {latestSuffix && <span className="text-sm text-gray-400">{latestSuffix}</span>}
      </div>
      <div className="text-xs text-gray-500 mt-2">{latestLabel}</div>
      <div className="text-xs text-gray-400 mt-3">{countLabel}</div>
    </Link>
  )
}
