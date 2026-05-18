import { redirect } from 'next/navigation'

// Permanent redirect — the page moved under /admin/control-reports/governance
// so it groups alongside spec-drift and future control reports.
export default function GovernanceRedirect() {
  redirect('/admin/control-reports/governance')
}
