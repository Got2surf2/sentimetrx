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
    const st = loc.state || 'Unknown'
    if (!acc[st]) acc[st] = []
    acc[st].push(loc)
    return acc
  }, {} as Record<string, Location[]>)

  const sortedStates = Object.keys(stateGroups).sort()

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
                <p className="text-xs text-gray-400">{selected.size} of {locations.length} selected</p>
              </div>
              <button onClick={toggleAll}
                className="text-xs font-semibold hover:underline" style={{ color: HERMES }}>
                {selected.size === locations.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            <div style={{ maxHeight: 400, overflowY: 'auto' }} className="flex flex-col gap-2">
              {sortedStates.map(function(state) {
                const locs = stateGroups[state]
                const stateSelected = locs.filter(function(l) { return selected.has(l.place_id) }).length
                const allChecked = stateSelected === locs.length
                return (
                  <div key={state} className="border border-gray-100 rounded-xl overflow-hidden">
                    <button onClick={function() { toggleState(state) }}
                      className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left">
                      <div className="flex items-center gap-3">
                        <input type="checkbox" checked={allChecked} readOnly
                          style={{ accentColor: HERMES, width: 14, height: 14 }} />
                        <span className="text-sm font-semibold text-gray-700">{state}</span>
                        <span className="text-xs text-gray-400">({locs.length})</span>
                      </div>
                      <span className="text-xs text-gray-400">{stateSelected}/{locs.length} selected</span>
                    </button>
                    <div className="flex flex-col">
                      {locs.map(function(loc) {
                        const isSelected = selected.has(loc.place_id)
                        return (
                          <div key={loc.place_id} onClick={function() { toggleLocation(loc.place_id) }}
                            className={'flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-orange-50 transition-colors border-t border-gray-50 ' + (isSelected ? '' : 'opacity-50')}>
                            <input type="checkbox" checked={isSelected} readOnly
                              style={{ accentColor: HERMES, width: 14, height: 14, flexShrink: 0 }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-700 truncate">{loc.name}</p>
                              <p className="text-xs text-gray-400 truncate">{loc.address || [loc.city, loc.state].filter(Boolean).join(', ')}</p>
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              {loc.rating != null && (
                                <span className="text-xs font-semibold text-yellow-600">{loc.rating.toFixed(1)} ★</span>
                              )}
                              <span className="text-xs text-gray-400">{loc.review_count.toLocaleString()} reviews</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
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
              ['Estimated cost',     '$' + (estimatedReviews * 0.000075 + selected.size * 0.00075).toFixed(2)],
              ['Sync frequency',     'Daily (automatic updates)'],
            ] as [string, string][]).map(function([label, val]) {
              return (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{label}</span>
                  <span className="text-gray-800 font-semibold">{val}</span>
                </div>
              )
            })}
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
