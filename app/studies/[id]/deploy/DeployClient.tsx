'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'

interface Study {
  id:        string
  guid:      string
  name:      string
  bot_name:  string
  bot_emoji: string
  status:    string
  config:    any
}

interface Props { study: Study; surveyUrl: string; logoUrl?: string; orgName?: string; isAdmin?: boolean; userEmail?: string; fullName?: string }

export default function DeployClient({ study: initial, surveyUrl, logoUrl='', orgName='', isAdmin=false, userEmail='', fullName='' }: Props) {
  const [study,       setStudy]       = useState(initial)
  const [copied,      setCopied]      = useState(false)
  const [toggling,    setToggling]    = useState(false)
  const [qrDataUrl,   setQrDataUrl]   = useState<string | null>(null)
  const [error,       setError]       = useState<string | null>(null)
  const [shareExpiry, setShareExpiry] = useState<'24h' | '7d' | '30d'>('7d')
  const [shareLoading,setShareLoading]= useState(false)
  const [shareCopied, setShareCopied] = useState<string | null>(null)
  const [shareLinks,  setShareLinks]  = useState<{ url: string; token: string; expires_at: string; created_at: string; last_accessed_at: string | null }[]>([])
  const [shareLinksLoaded, setShareLinksLoaded] = useState(false)

  // Kiosk mode (?kiosk=1) — unattended shared-tablet link + attract-screen copy
  const kioskUrl = surveyUrl + '?kiosk=1'
  const [kioskCopied,   setKioskCopied]   = useState(false)
  const [kioskQrDataUrl, setKioskQrDataUrl] = useState<string | null>(null)
  const [kioskHeadline, setKioskHeadline] = useState<string>(initial.config?.kioskAttractHeadline || '')
  const [kioskSubtext,  setKioskSubtext]  = useState<string>(initial.config?.kioskAttractSubtext || '')
  const [kioskSaving,   setKioskSaving]   = useState(false)
  const [kioskSaved,    setKioskSaved]    = useState(false)


  // Load existing share links
  useEffect(() => {
    fetch('/api/share?list_type=study&list_target_id=' + study.id)
      .then(r => r.json())
      .then(d => setShareLinks(d.links || []))
      .catch(() => {})
      .finally(() => setShareLinksLoaded(true))
  }, [study.id])

  // Generate QR code client-side using qrcode npm package
  useEffect(() => {
    QRCode.toDataURL(surveyUrl, { width: 200, margin: 2, color: { dark: '#ffffff', light: '#0a1628' } })
      .then(url => setQrDataUrl(url))
      .catch(() => {})
  }, [surveyUrl])

  // Kiosk QR — encodes the ?kiosk=1 link
  useEffect(() => {
    QRCode.toDataURL(kioskUrl, { width: 200, margin: 2, color: { dark: '#ffffff', light: '#0a1628' } })
      .then(url => setKioskQrDataUrl(url))
      .catch(() => {})
  }, [kioskUrl])

  const handleSaveKioskCopy = async () => {
    setKioskSaving(true)
    setError(null)
    try {
      const nextConfig = { ...study.config, kioskAttractHeadline: kioskHeadline.trim() || undefined, kioskAttractSubtext: kioskSubtext.trim() || undefined }
      const res = await fetch(`/api/studies/${study.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: nextConfig }),
      })
      if (!res.ok) throw new Error('save failed')
      setStudy(prev => ({ ...prev, config: nextConfig }))
      setKioskSaved(true)
      setTimeout(() => setKioskSaved(false), 2000)
    } catch {
      setError('Failed to save kiosk text. Please try again.')
    } finally {
      setKioskSaving(false)
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(surveyUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownloadQR = () => {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.href     = qrDataUrl
    a.download = `${study.guid}-qrcode.png`
    a.click()
  }

  const handleToggleStatus = async () => {
    setToggling(true)
    setError(null)
    const newStatus = study.status === 'active' ? 'paused' : 'active'
    try {
      const res = await fetch(`/api/studies/${study.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error('Failed to update status')
      setStudy(prev => ({ ...prev, status: newStatus }))
    } catch {
      setError('Failed to update study status. Please try again.')
    } finally {
      setToggling(false)
    }
  }

  const theme = study.config?.theme || {}
  const isActive = study.status === 'active'

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav logoUrl={logoUrl} orgName={orgName} isAdmin={isAdmin} userEmail={userEmail} fullName={fullName} currentPage='deploy' />
      <SubHeader crumbs={[{label: 'Dashboard', href: '/dashboard'}, {label: study.name, href: '/studies/' + study.id + '/edit'}, {label: 'Publish'}]} />

      <main className="max-w-2xl mx-auto px-6 py-10">

        {/* Study header */}
        <div className="flex items-center gap-4 mb-10">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0"
            style={{ background: theme.headerGradient || 'linear-gradient(135deg,#1e3a5f,#0d1f3c)' }}
          >
            {study.bot_emoji}
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{study.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                isActive ? 'bg-green-500/15 text-green-400' : 'bg-yellow-500/15 text-yellow-400'
              }`}>
                {study.status}
              </span>
              <span className="text-gray-500 text-xs">{study.bot_name}</span>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-5">

          {/* Survey link */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-1">Survey link</h2>
            <p className="text-gray-400 text-sm mb-4">
              Share this link via email, SMS, or any messaging platform.
            </p>
            <div className="flex gap-2">
              <div className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-sm text-gray-300 font-mono truncate">
                {surveyUrl}
              </div>
              <button
                onClick={handleCopy}
                className={`px-4 py-3 rounded-xl text-sm font-medium transition-all flex-shrink-0 ${
                  copied
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <a
              href={surveyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors mt-2 inline-block"
            >
              Open survey in new tab →
            </a>
          </div>

          {/* Hidden fields URL template */}
          {(() => {
            const hiddenFields = (study.config?.questions ?? []).filter((q: any) => q.type === 'hidden')
              .map((q: any) => ({ ...q, paramKey: q.paramKey || (q.prompt || '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '') }))
              .filter((q: any) => q.paramKey)
            if (hiddenFields.length === 0) return null
            const templateUrl = surveyUrl + '?' + hiddenFields.map((q: any) => q.paramKey + '=').join('&')
            return (
              <div className="bg-white border border-gray-200 rounded-2xl p-6">
                <h2 className="font-semibold text-white mb-1">Hidden fields</h2>
                <p className="text-gray-400 text-sm mb-4">
                  This survey has hidden fields that can be populated via URL parameters. Use this template when building campaign links.
                </p>
                <div className="px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-sm text-gray-300 font-mono break-all mb-3">
                  {templateUrl}
                </div>
                <div className="flex flex-col gap-1.5">
                  {hiddenFields.map((q: any) => (
                    <div key={q.id} className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-cyan-400">{q.paramKey}</span>
                      <span className="text-gray-500">→</span>
                      <span className="text-gray-400">{q.prompt || q.exportLabel || 'Unnamed field'}</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(templateUrl)
                  }}
                  className="mt-3 px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium transition-all"
                >
                  Copy template URL
                </button>
              </div>
            )
          })()}

          {/* QR code */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-1">QR code</h2>
            <p className="text-gray-400 text-sm mb-5">
              Print and display at a physical location — restaurant table, hotel desk, event venue.
            </p>
            <div className="flex flex-col items-center gap-4">
              {qrDataUrl && (
                <div
                  className="rounded-2xl overflow-hidden p-4"
                  style={{ background: '#0a1628', border: `2px solid ${theme.primaryColor || '#00b4d8'}30` }}
                >
                  <img src={qrDataUrl} alt="QR code" width={200} height={200} />
                </div>
              )}
              {qrDataUrl && (
                <button
                  onClick={handleDownloadQR}
                  className="px-5 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium transition-all"
                >
                  Download QR code (PNG)
                </button>
              )}
              {!qrDataUrl && (
                <p className="text-gray-500 text-xs">Generating QR code...</p>
              )}
            </div>
          </div>

          {/* Kiosk mode */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-1">Kiosk mode</h2>
            <p className="text-gray-400 text-sm mb-4">
              For an unattended shared tablet (counter or table-top feedback station). Each guest gets a fresh survey; it auto-returns to a welcome screen between guests. Lock the tablet to this link using its built-in kiosk setting (Fire OS Single-App Mode, Android kiosk, or iPad Guided Access).
            </p>

            {/* Kiosk link */}
            <div className="flex gap-2 mb-3">
              <div className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-sm text-gray-300 font-mono truncate">
                {kioskUrl}
              </div>
              <button
                onClick={async () => { await navigator.clipboard.writeText(kioskUrl); setKioskCopied(true); setTimeout(() => setKioskCopied(false), 2000) }}
                className={`px-4 py-3 rounded-xl text-sm font-medium transition-all flex-shrink-0 ${
                  kioskCopied ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
              >
                {kioskCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <a href={kioskUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors inline-block mb-5">
              Preview kiosk mode in new tab →
            </a>

            {/* Welcome-screen copy */}
            <div className="border-t border-gray-200 pt-5">
              <label className="text-xs font-medium text-gray-500 block mb-1.5">Welcome screen headline</label>
              <input
                type="text"
                value={kioskHeadline}
                onChange={e => setKioskHeadline(e.target.value)}
                placeholder="We'd love your feedback"
                style={{ fontSize: '16px' }}
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-gray-200 outline-none mb-3"
              />
              <label className="text-xs font-medium text-gray-500 block mb-1.5">Welcome screen sub-text</label>
              <input
                type="text"
                value={kioskSubtext}
                onChange={e => setKioskSubtext(e.target.value)}
                placeholder="It only takes a minute — and it's completely anonymous."
                style={{ fontSize: '16px' }}
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-gray-200 outline-none mb-4"
              />
              <button
                onClick={handleSaveKioskCopy}
                disabled={kioskSaving}
                className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50 ${
                  kioskSaved ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
              >
                {kioskSaving ? 'Saving...' : kioskSaved ? 'Saved!' : 'Save welcome screen'}
              </button>
            </div>

            {/* Kiosk QR */}
            {kioskQrDataUrl && (
              <div className="flex flex-col items-center gap-3 mt-6 pt-5 border-t border-gray-200">
                <div className="rounded-2xl overflow-hidden p-4" style={{ background: '#0a1628', border: `2px solid ${theme.primaryColor || '#00b4d8'}30` }}>
                  <img src={kioskQrDataUrl} alt="Kiosk QR code" width={200} height={200} />
                </div>
                <button
                  onClick={() => { const a = document.createElement('a'); a.href = kioskQrDataUrl; a.download = `${study.guid}-kiosk-qrcode.png`; a.click() }}
                  className="px-5 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium transition-all"
                >
                  Download kiosk QR code (PNG)
                </button>
              </div>
            )}
          </div>

          {/* Share dashboard */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-1">Share dashboard</h2>
            <p className="text-gray-400 text-sm mb-4">
              View-only links to share response metrics with clients — no login required.
            </p>

            {/* Active links — always show section */}
            <div className="mb-4">
              <label className="text-xs font-medium text-gray-500 block mb-1.5">Active links {shareLinks.length > 0 ? '(' + shareLinks.length + ')' : ''}</label>
              {shareLinksLoaded && shareLinks.length === 0 && (
                <p className="text-xs text-gray-400 italic py-2">No active links. Create one below.</p>
              )}
              {shareLinksLoaded && shareLinks.length > 0 && (
                <div className="relative">
                  <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 200 }}>
                    {shareLinks.slice().sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime()).map(link => {
                      const diffH = Math.round((new Date(link.expires_at).getTime() - Date.now()) / 3600000)
                      const timeLeft = diffH < 1 ? 'expires soon' : diffH < 24 ? diffH + 'h left' : Math.round(diffH / 24) + 'd left'
                      const expiryDate = new Date(link.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      return (
                        <div key={link.token} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] text-gray-500 font-mono truncate">{link.url}</p>
                            <p className="text-[10px] text-gray-400">
                              Expires {expiryDate} <span className="text-gray-300">·</span> {timeLeft}
                              {link.last_accessed_at && <> <span className="text-gray-300">·</span> Viewed {new Date(link.last_accessed_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>}
                              {!link.last_accessed_at && <> <span className="text-gray-300">·</span> Never viewed</>}
                            </p>
                          </div>
                          <button onClick={() => { navigator.clipboard.writeText(link.url); setShareCopied(link.url); setTimeout(() => setShareCopied(null), 2000) }}
                            className={'px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex-shrink-0 ' +
                              (shareCopied === link.url ? 'bg-green-500/20 text-green-400' : 'bg-gray-200 hover:bg-gray-300 text-gray-700')}>
                            {shareCopied === link.url ? 'Copied!' : 'Copy'}
                          </button>
                          <button onClick={async () => {
                            const res = await fetch('/api/share?token=' + encodeURIComponent(link.token), { method: 'DELETE' })
                            if (res.ok) setShareLinks(prev => prev.filter(l => l.token !== link.token))
                          }}
                            className="px-2 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all"
                            title="Delete link">
                            &times;
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  {shareLinks.length > 4 && (
                    <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white to-transparent pointer-events-none rounded-b-lg" />
                  )}
                </div>
              )}
            </div>

            {/* Create new */}
            <div className="flex items-center gap-3">
              <select value={shareExpiry} onChange={e => setShareExpiry(e.target.value as any)}
                className="px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-sm text-gray-700 outline-none">
                <option value="24h">Expires in 24 hours</option>
                <option value="7d">Expires in 7 days</option>
                <option value="30d">Expires in 30 days</option>
              </select>
              <button disabled={shareLoading} onClick={async () => {
                setShareLoading(true)
                try {
                  const res = await fetch('/api/share', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'study', target_id: study.id, expires_in: shareExpiry }) })
                  const data = await res.json()
                  if (res.ok) setShareLinks(prev => [{ url: data.url, token: data.token, expires_at: data.expires_at, created_at: new Date().toISOString(), last_accessed_at: null }, ...prev])
                } finally { setShareLoading(false) }
              }} className="px-5 py-2.5 rounded-xl text-white text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: '#E8632A' }}>
                {shareLoading ? 'Creating...' : '+ Create New Link'}
              </button>
            </div>
          </div>

          {/* Status control */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-1">Study status</h2>
            <p className="text-gray-400 text-sm mb-4">
              {isActive
                ? 'This study is live and accepting responses. Pause it to stop collecting.'
                : 'This study is paused. Visitors who follow the link will see a "not active" message.'
              }
            </p>
            <button
              onClick={handleToggleStatus}
              disabled={toggling}
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 ${
                isActive
                  ? 'bg-yellow-500/15 hover:bg-yellow-500/25 text-yellow-400 border border-yellow-500/20'
                  : 'bg-green-500/15 hover:bg-green-500/25 text-green-400 border border-green-500/20'
              }`}
            >
              {toggling ? 'Updating...' : isActive ? 'Pause study' : 'Resume study'}
            </button>
          </div>

          {/* Study design export */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-1">Study design summary</h2>
            <p className="text-gray-400 text-sm mb-4">
              Download a presentation that outlines every prompt, question, and setting — ready to share with clients.
            </p>
            <button
              onClick={() => {
                const a = document.createElement('a')
                a.href = `/api/studies/${study.id}/design-export`
                a.download = study.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_design.pptx'
                a.click()
              }}
              className="px-5 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium transition-all"
            >
              Download design deck (PPTX)
            </button>
          </div>

          {/* Quick links */}
          <div className="flex gap-3">
            <Link
              href={`/studies/${study.id}/responses`}
              className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium text-center transition-all"
            >
              View responses
            </Link>
            <Link
              href={`/studies/${study.id}/edit`}
              className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium text-center transition-all"
            >
              Edit study
            </Link>
          </div>

        </div>
      </main>
    </div>
  )
}
