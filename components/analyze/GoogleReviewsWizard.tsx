'use client'

// components/analyze/GoogleReviewsWizard.tsx
// Three-step wizard: Brand Search → Location Selection → Confirm + Download

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import LottieLoader from '@/components/ui/LottieLoader'

const HERMES = '#E8632A'

interface Location {
  place_id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  rating: number | null
  review_count: number
}

type WizardStep = 1 | 2 | 3

interface Props {
  onBack: () => void
}

export default function GoogleReviewsWizard({ onBack }: Props) {
  const router = useRouter()
  const [step, setStep] = useState<WizardStep>(1)

  // Step 1: Search
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [locations, setLocations] = useState<Location[]>([])

  // Step 2: Selection
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Step 2b: Date range
  const [startDate, setStartDate] = useState('')  // ISO date string, empty = no limit
  const [endDate, setEndDate] = useState('')      // ISO date string, empty = today

  // Step 3: Confirm + Download
  const [datasetName, setDatasetName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [statusMsg, setStatusMsg] = useState('')

  // -- Step 1: Search --------------------------------------------------------

  async function handleSearch() {
    if (!keyword.trim()) return
    setSearching(true)
    setSearchError('')
    setLocations([])
    try {
      const res = await fetch('/api/review-sources/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setSearchError(data.error || 'Search failed'); return }
      if (!data.locations?.length) { setSearchError('No locations found for "' + keyword.trim() + '"'); return }
      setLocations(data.locations)
      // Auto-select all
      const all = new Set<string>()
      data.locations.forEach(function(l: Location) { all.add(l.place_id) })
      setSelected(all)
      setDatasetName(keyword.trim() + ' Reviews')
      setStep(2)
    } catch (err: any) {
      setSearchError(err?.message || 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  // -- Step 2: Selection helpers ---------------------------------------------

  const stateGroups = locations.reduce(function(acc, loc) {
    const st = (loc.state && loc.state.trim()) ? loc.state.trim() : 'Other'
    if (!acc[st]) acc[st] = []
    acc[st].push(loc)
    return acc
  }, {} as Record<string, Location[]>)

  // Sort states alphabetically but put "Other" at the end
  const sortedStates = Object.keys(stateGroups).sort(function(a, b) {
    if (a === 'Other') return 1
    if (b === 'Other') return -1
    return a.localeCompare(b)
  })

  function toggleAll() {
    if (selected.size === locations.length) {
      setSelected(new Set())
    } else {
      const all = new Set<string>()
      locations.forEach(function(l) { all.add(l.place_id) })
      setSelected(all)
    }
  }

  function toggleState(state: string) {
    const locs = stateGroups[state] || []
    const allSelected = locs.every(function(l) { return selected.has(l.place_id) })
    const next = new Set(selected)
    locs.forEach(function(l) {
      if (allSelected) next.delete(l.place_id)
      else next.add(l.place_id)
    })
    setSelected(next)
  }

  function toggleLocation(placeId: string) {
    const next = new Set(selected)
    if (next.has(placeId)) next.delete(placeId)
    else next.add(placeId)
    setSelected(next)
  }

  const selectedLocations = locations.filter(function(l) { return selected.has(l.place_id) })
  const estimatedReviews = selectedLocations.reduce(function(sum, l) { return sum + l.review_count }, 0)

  // -- Step 3: Create --------------------------------------------------------

  async function handleCreate() {
    if (!datasetName.trim() || selectedLocations.length === 0) return
    setCreating(true)
    setCreateError('')
    setStatusMsg('Creating dataset and starting download...')
    try {
      const res = await fetch('/api/review-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand_name: keyword.trim(),
          dataset_name: datasetName.trim(),
          locations: selectedLocations,
          start_date: startDate || null,
          end_date: endDate || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setCreateError(data.error || 'Failed to create'); return }

      setStatusMsg('Download started! Redirecting to your dataset...')

      // Give the sync a moment to start, then redirect
      setTimeout(function() {
        router.push('/analyze/' + data.dataset_id + '/settings')
      }, 1500)
    } catch (err: any) {
      setCreateError(err?.message || 'Failed')
    } finally {
      setCreating(false)
    }
  }

  // -- Render ----------------------------------------------------------------

  return (
    <div className="flex flex-col gap-6">
      {/* Step indicator */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-xs text-gray-400 hover:text-gray-600 mr-2">← Back</button>
        {([1, 2, 3] as WizardStep[]).map(function(s) {
          const labels: Record<WizardStep, string> = { 1: 'Search', 2: 'Select Locations', 3: 'Download' }
          const done = step > s; const current = step === s
          return (
            <div key={s} className="flex items-center gap-2">
              <div className={'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ' + (done ? 'bg-green-500 text-white' : current ? 'text-white' : 'bg-gray-100 text-gray-400')}
                style={current ? { background: HERMES } : {}}>
                {done ? '\u2713' : s}
              </div>
              <span className={'text-sm font-medium ' + (current ? 'text-gray-800' : 'text-gray-400')}>{labels[s]}</span>
              {s < 3 && <div className="w-8 h-px bg-gray-200" />}
            </div>
          )
        })}
      </div>

      {/* Step 1: Brand Search */}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-4">
            <div>
              <h3 className="font-bold text-gray-800 mb-1">Search for a brand or business</h3>
              <p className="text-xs text-gray-400">Enter the name of a restaurant chain, business, or specific location</p>
            </div>
            <div className="flex gap-3">
              <input
                value={keyword}
                onChange={function(e) { setKeyword(e.target.value) }}
                onKeyDown={function(e) { if (e.key === 'Enter') handleSearch() }}
                placeholder='e.g. "Starbucks Tampa"'
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 text-sm outline-none focus:border-orange-400 transition-colors"
              />
              <button
                onClick={handleSearch}
                disabled={searching || !keyword.trim()}
                className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-all"
                style={{ background: HERMES }}>
                {searching ? 'Searching...' : 'Search'}
              </button>
            </div>
            {searching && (
              <div className="flex items-center gap-3 py-2">
                <LottieLoader size={32} message="Searching Google Maps..." />
              </div>
            )}
          </div>
          {searchError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{searchError}</div>
          )}
        </div>
      )}

      {/* Step 2: Location Selection */}
      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-green-500 text-lg">{'\u2713'}</span>
            <div>
              <p className="text-sm font-semibold text-green-700">Found {locations.length} locations for "{keyword}"</p>
              <p className="text-xs text-green-600">{estimatedReviews.toLocaleString()} total reviews estimated</p>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-800">Locations</h3>
                <p className="text-xs text-gray-400">{selected.size} of {locations.length} selected · {estimatedReviews.toLocaleString()} reviews</p>
              </div>
              <button onClick={toggleAll}
                className="text-xs font-semibold hover:underline" style={{ color: HERMES }}>
                {selected.size === locations.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            {/* Split panes: selected on top, unselected on bottom */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Selected pane */}
              <div style={{ border: '1px solid #d1fae5', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ background: '#ecfdf5', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#059669' }}>Selected ({selectedLocations.length})</span>
                  {selectedLocations.length > 0 && (
                    <span style={{ fontSize: 11, color: '#6b7280' }}>{estimatedReviews.toLocaleString()} reviews</span>
                  )}
                </div>
                <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {selectedLocations.length === 0 ? (
                    <div style={{ padding: '24px 14px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No restaurants selected</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <tbody>
                        {selectedLocations.map(function(loc) {
                          return (
                            <tr key={loc.place_id}
                              onClick={function() { toggleLocation(loc.place_id) }}
                              style={{ cursor: 'pointer', borderTop: '1px solid #f0fdf4', transition: 'background .1s' }}
                              onMouseEnter={function(e) { (e.currentTarget as HTMLTableRowElement).style.background = '#fef2f2' }}
                              onMouseLeave={function(e) { (e.currentTarget as HTMLTableRowElement).style.background = '' }}>
                              <td style={{ padding: '6px 14px', width: 28 }}>
                                <input type="checkbox" checked readOnly style={{ accentColor: '#059669', width: 14, height: 14, cursor: 'pointer' }} />
                              </td>
                              <td style={{ padding: '6px 6px', fontWeight: 600, color: '#111827' }}>{loc.name || 'Unknown'}</td>
                              <td style={{ padding: '6px 6px', color: '#6b7280', fontSize: 12 }}>{[loc.city, loc.state].filter(Boolean).join(', ') || loc.address || ''}</td>
                              <td style={{ padding: '6px 6px', textAlign: 'center', color: '#d97706', fontWeight: 700, fontSize: 12, width: 55 }}>{loc.rating != null ? loc.rating.toFixed(1) + ' \u2605' : ''}</td>
                              <td style={{ padding: '6px 14px', textAlign: 'right', color: '#6b7280', fontSize: 12, width: 70 }}>{loc.review_count.toLocaleString()}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Unselected pane */}
              {(function() {
                var unselectedLocs = locations.filter(function(l) { return !selected.has(l.place_id) })
                if (unselectedLocs.length === 0) return null
                return (
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ background: '#f9fafb', padding: '8px 14px' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280' }}>Available ({unselectedLocs.length})</span>
                    </div>
                    <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <tbody>
                          {unselectedLocs.map(function(loc) {
                            return (
                              <tr key={loc.place_id}
                                onClick={function() { toggleLocation(loc.place_id) }}
                                style={{ cursor: 'pointer', borderTop: '1px solid #f3f4f6', opacity: 0.6, transition: 'all .1s' }}
                                onMouseEnter={function(e) { var t = e.currentTarget as HTMLTableRowElement; t.style.background = '#ecfdf5'; t.style.opacity = '1' }}
                                onMouseLeave={function(e) { var t = e.currentTarget as HTMLTableRowElement; t.style.background = ''; t.style.opacity = '0.6' }}>
                                <td style={{ padding: '6px 14px', width: 28 }}>
                                  <input type="checkbox" checked={false} readOnly style={{ accentColor: HERMES, width: 14, height: 14, cursor: 'pointer' }} />
                                </td>
                                <td style={{ padding: '6px 6px', fontWeight: 600, color: '#111827' }}>{loc.name || 'Unknown'}</td>
                                <td style={{ padding: '6px 6px', color: '#6b7280', fontSize: 12 }}>{[loc.city, loc.state].filter(Boolean).join(', ') || loc.address || ''}</td>
                                <td style={{ padding: '6px 6px', textAlign: 'center', color: '#d97706', fontWeight: 700, fontSize: 12, width: 55 }}>{loc.rating != null ? loc.rating.toFixed(1) + ' \u2605' : ''}</td>
                                <td style={{ padding: '6px 14px', textAlign: 'right', color: '#6b7280', fontSize: 12, width: 70 }}>{loc.review_count.toLocaleString()}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={function() { setStep(1) }}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600">Back</button>
            <button onClick={function() { setStep(3) }} disabled={selected.size === 0}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-all"
              style={{ background: HERMES }}>Continue</button>
          </div>
        </div>
      )}

      {/* Step 3: Confirm + Download */}
      {step === 3 && (
        <div className="flex flex-col gap-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-5 flex flex-col gap-3">
            <h3 className="font-bold text-gray-800">Download Summary</h3>
            <div className="flex flex-col gap-1.5 mb-2">
              <label className="text-sm font-semibold text-gray-700">Dataset name</label>
              <input value={datasetName} onChange={function(e) { setDatasetName(e.target.value) }}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm outline-none focus:border-orange-400 transition-colors" />
            </div>
            {([
              ['Brand',              keyword],
              ['Locations selected', selected.size + ' of ' + locations.length],
              ['Estimated reviews',  estimatedReviews.toLocaleString()],
              ['Date range',         (startDate || 'All time') + ' \u2192 ' + (endDate || 'Today')],
              ['Sync frequency',     'Daily (automatic updates)'],
            ] as [string, string][]).map(function([label, val]) {
              return (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{label}</span>
                  <span className="text-gray-800 font-semibold">{val}</span>
                </div>
              )
            })}
            <div className="flex items-end gap-3 pt-2 border-t border-gray-100">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">Reviews from</label>
                <input type="date" value={startDate} onChange={function(e) { setStartDate(e.target.value) }}
                  className="px-3 py-2 rounded-xl border border-gray-300 text-sm outline-none focus:border-orange-400" style={{ width: 160 }} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">Through</label>
                <input type="date" value={endDate} onChange={function(e) { setEndDate(e.target.value) }}
                  className="px-3 py-2 rounded-xl border border-gray-300 text-sm outline-none focus:border-orange-400" style={{ width: 160 }} />
              </div>
              <button onClick={function() { setStartDate(''); setEndDate('') }}
                className="text-xs text-gray-400 hover:text-gray-600 pb-2">Clear</button>
            </div>
            <p className="text-xs text-gray-400">Leave blank for all available reviews. Max 4,490 per location (API limit).</p>
          </div>

          {creating && (
            <div className="flex flex-col gap-3 items-center py-2">
              <LottieLoader size={64} message={statusMsg || 'Creating...'} />
            </div>
          )}

          {createError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{createError}</div>
          )}

          <div className="flex gap-3">
            <button onClick={function() { setStep(2) }} disabled={creating}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600 disabled:opacity-50">Back</button>
            <button onClick={handleCreate} disabled={creating || !datasetName.trim()}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-all"
              style={{ background: HERMES }}>
              {creating ? 'Starting Download...' : 'Start Download'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
