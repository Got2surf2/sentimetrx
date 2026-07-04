'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import TopNav from '@/components/nav/TopNav'
import LottieLoader from '@/components/ui/LottieLoader'
import type { ModuleFeatures } from '@/lib/types'

interface Snapshot { key: string; last_modified: string; size_bytes: number }

interface TableReport {
  table: string
  attempted: number
  upserted: number
  deleted: number
  errors: number
  skipped_fk: number
  skipped_conflict: number
  missing: number
  first_error?: string
}

interface RestoreResult {
  ok: boolean
  org_id: string
  snapshot_taken_at: string
  mode: 'merge' | 'replace'
  tables_restored: number
  totals?: { upserted: number; deleted: number; errors: number; skipped_fk: number; skipped_conflict: number; missing: number }
  reports: TableReport[]
}

interface Props {
  orgId: string
  targetOrgName: string
  targetOrgSlug: string
  logoUrl?: string
  orgName?: string
  userEmail: string
  fullName?: string
  features?: ModuleFeatures
}

function formatBytes(n: number): string {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

export default function OrgBackupsClient({ orgId, targetOrgName, targetOrgSlug, logoUrl, orgName, userEmail, fullName, features }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [typedOrgSlug, setTypedOrgSlug] = useState('')
  const [result, setResult] = useState<RestoreResult | null>(null)

  function load() {
    setLoading(true); setError(null)
    fetch('/api/admin/org-snapshots/' + orgId)
      .then(r => r.json())
      .then(d => {
        if (d?.error) setError(d.error)
        else setSnapshots(Array.isArray(d?.snapshots) ? d.snapshots : [])
      })
      .catch(() => setError('Failed to load snapshots'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [orgId])

  async function restore(key: string) {
    if (typedOrgSlug !== targetOrgSlug) {
      setError('Type the org slug exactly to confirm.')
      return
    }
    setRestoring(key); setError(null); setResult(null)
    try {
      const res = await fetch('/api/admin/org-snapshots/' + orgId + '/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, mode }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data?.error || ('HTTP ' + res.status)); return }
      setResult(data as RestoreResult)
      setConfirmKey(null)
      setTypedOrgSlug('')
    } catch (e: any) {
      setError(e?.message || 'Restore failed')
    } finally {
      setRestoring(null)
    }
  }

  return (
    <div className='min-h-screen bg-gray-50'>
      <TopNav logoUrl={logoUrl} orgName={orgName} isAdmin={true} userEmail={userEmail} fullName={fullName} currentPage='admin' features={features} />

      <div className='max-w-5xl mx-auto px-4 py-8'>
        <div className='text-xs text-gray-500 mb-1'>
          <Link href='/admin' className='hover:underline'>Admin</Link> /{' '}
          <Link href='/admin/backups' className='hover:underline'>Backups</Link> /{' '}
          <span className='text-gray-700'>{targetOrgName}</span>
        </div>
        <h1 className='text-2xl font-semibold text-gray-900 mb-1'>Snapshots — {targetOrgName}</h1>
        <p className='text-sm text-gray-600 mb-6'>Slug: <code>{targetOrgSlug}</code> · Org id: <code className='font-mono text-xs'>{orgId}</code></p>

        {error && (
          <div className='mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm'>{error}</div>
        )}

        {result && (
          <div className={'mb-4 rounded-lg p-4 text-sm border ' + (result.ok
            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
            : 'bg-red-50 border-red-200 text-red-900')}>
            <div className='font-semibold mb-2'>{result.ok ? 'Restore complete — verified' : 'Restore INCOMPLETE — some rows did not land'}</div>
            <div className='text-xs mb-2'>Snapshot taken {new Date(result.snapshot_taken_at).toLocaleString()} · mode: {result.mode} · {result.tables_restored} tables touched</div>
            {result.totals && (result.totals.skipped_fk > 0 || result.totals.skipped_conflict > 0 || result.totals.missing > 0 || result.totals.errors > 0) && (
              <div className='text-xs mb-2'>
                {result.totals.errors > 0 && <span className='mr-3 font-semibold'>errors: {result.totals.errors}</span>}
                {result.totals.missing > 0 && <span className='mr-3 font-semibold'>missing after verification: {result.totals.missing}</span>}
                {result.totals.skipped_fk > 0 && <span className='mr-3'>skipped (missing parent): {result.totals.skipped_fk}</span>}
                {result.totals.skipped_conflict > 0 && <span className='mr-3'>skipped (conflict): {result.totals.skipped_conflict}</span>}
              </div>
            )}
            <details>
              <summary className='cursor-pointer text-xs'>Show per-table report</summary>
              <table className='mt-2 text-xs w-full'>
                <thead><tr className={result.ok ? 'border-b border-emerald-300' : 'border-b border-red-300'}><th className='text-left p-1'>Table</th><th className='text-right p-1'>Upserted</th><th className='text-right p-1'>Deleted</th><th className='text-right p-1'>Errors</th><th className='text-right p-1'>Skipped</th><th className='text-right p-1'>Missing</th><th className='text-left p-1'>First error</th></tr></thead>
                <tbody>
                  {result.reports.map(r => (
                    <tr key={r.table} className={result.ok ? 'border-b border-emerald-200' : 'border-b border-red-200'}>
                      <td className='p-1 font-mono'>{r.table}</td>
                      <td className='p-1 text-right'>{r.upserted}</td>
                      <td className='p-1 text-right'>{r.deleted}</td>
                      <td className={'p-1 text-right ' + (r.errors > 0 ? 'text-red-700 font-semibold' : '')}>{r.errors}</td>
                      <td className={'p-1 text-right ' + ((r.skipped_fk || 0) + (r.skipped_conflict || 0) > 0 ? 'text-amber-700 font-semibold' : '')}>{(r.skipped_fk || 0) + (r.skipped_conflict || 0)}</td>
                      <td className={'p-1 text-right ' + ((r.missing || 0) > 0 ? 'text-red-700 font-semibold' : '')}>{r.missing || 0}</td>
                      <td className='p-1 text-red-700'>{r.first_error || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        )}

        {loading && <div className='flex justify-center py-16'><LottieLoader size={64} /></div>}

        {!loading && snapshots.length === 0 && (
          <div className='bg-white border border-dashed border-gray-300 rounded-lg p-10 text-center text-gray-500'>
            <div className='text-sm'>No snapshots yet for this org.</div>
            <div className='text-xs mt-1'>The nightly cron runs at 04:00 UTC. Use "Snapshot now" on the parent page to take one immediately.</div>
          </div>
        )}

        {!loading && snapshots.length > 0 && (
          <div className='bg-white border border-gray-200 rounded-lg divide-y divide-gray-200'>
            {snapshots.map(s => {
              const isConfirm = confirmKey === s.key
              const isRunning = restoring === s.key
              return (
                <div key={s.key} className='p-4'>
                  <div className='flex items-start gap-3'>
                    <div className='flex-1 min-w-0'>
                      <div className='font-mono text-xs text-gray-700 break-all'>{s.key}</div>
                      <div className='text-xs text-gray-500 mt-1'>
                        {new Date(s.last_modified).toLocaleString()} · {formatBytes(s.size_bytes)}
                      </div>
                    </div>
                    {!isConfirm && (
                      <button
                        onClick={() => { setConfirmKey(s.key); setMode('merge'); setTypedOrgSlug(''); setError(null) }}
                        className='px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50'
                      >Restore…</button>
                    )}
                  </div>

                  {isConfirm && (
                    <div className='mt-3 p-3 bg-amber-50 border border-amber-200 rounded text-sm'>
                      <div className='font-semibold mb-2'>Confirm restore</div>
                      <div className='text-xs text-amber-900 mb-3'>
                        This will overwrite rows in <strong>{targetOrgName}</strong>'s tenant data with the contents of this snapshot.
                        {' '}Merge mode upserts by <code>id</code> and leaves other rows untouched.
                        {' '}Replace mode <em>also</em> deletes current rows whose id is not in the snapshot — opt-in only.
                      </div>
                      <div className='flex flex-col gap-2 mb-3'>
                        <label className='flex items-center gap-2 text-xs'>
                          <input type='radio' name='mode' checked={mode === 'merge'} onChange={() => setMode('merge')} />
                          Merge (safe): upsert snapshot rows; leave others alone
                        </label>
                        <label className='flex items-center gap-2 text-xs'>
                          <input type='radio' name='mode' checked={mode === 'replace'} onChange={() => setMode('replace')} />
                          Replace (destructive): also delete rows not in snapshot
                        </label>
                      </div>
                      <div className='text-xs mb-1'>Type the org slug <code>{targetOrgSlug}</code> to confirm:</div>
                      <input
                        type='text'
                        value={typedOrgSlug}
                        onChange={e => setTypedOrgSlug(e.target.value)}
                        className='w-full px-2 py-1 border border-gray-300 rounded text-sm'
                        placeholder={targetOrgSlug}
                      />
                      <div className='flex gap-2 mt-3'>
                        <button
                          onClick={() => { void restore(s.key) }}
                          disabled={isRunning || typedOrgSlug !== targetOrgSlug}
                          className='px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed'
                        >{isRunning ? 'Restoring…' : 'Confirm restore'}</button>
                        <button
                          onClick={() => { setConfirmKey(null); setTypedOrgSlug(''); setError(null) }}
                          disabled={isRunning}
                          className='px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50'
                        >Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
