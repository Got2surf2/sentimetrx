'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
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

interface Props { study: Study; surveyUrl: string; logoUrl?: string; isAdmin?: boolean; userEmail?: string }

export default function DeployClient({ study: initial, surveyUrl, logoUrl='', isAdmin=false, userEmail='' }: Props) {
  const [study,       setStudy]       = useState(initial)
  const [copied,      setCopied]      = useState(false)
  const [toggling,    setToggling]    = useState(false)
  const [qrDataUrl,   setQrDataUrl]   = useState<string | null>(null)
  const [error,       setError]       = useState<string | null>(null)

  // Generate QR code client-side using qrcode library via CDN
  useEffect(() => {
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
    script.onload = () => {
      const container = document.getElementById('qr-container')
      if (!container) return
      container.innerHTML = ''
      // @ts-ignore
      new window.QRCode(container, {
        text:          surveyUrl,
        width:         200,
        height:        200,
        colorDark:     '#ffffff',
        colorLight:    '#0a1628',
        correctLevel:  2, // QRCode.CorrectLevel.Q
      })
      setTimeout(() => {
        const canvas = container.querySelector('canvas')
        if (canvas) setQrDataUrl(canvas.toDataURL('image/png'))
      }, 200)
    }
    document.head.appendChild(script)
    return () => { document.head.removeChild(script) }
  }, [surveyUrl])

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
      <TopNav logoUrl={logoUrl} isAdmin={isAdmin} userEmail={userEmail} currentPage='deploy' />
      <SubHeader crumbs={[{label: 'Dashboard', href: '/dashboard'}, {label: study.name, href: '/studies/' + study.id + '/edit'}, {label: 'Deploy'}]} />

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

          {/* QR code */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-1">QR code</h2>
            <p className="text-gray-400 text-sm mb-5">
              Print and display at a physical location — restaurant table, hotel desk, event venue.
            </p>
            <div className="flex flex-col items-center gap-4">
              <div
                id="qr-container"
                className="rounded-2xl overflow-hidden p-4"
                style={{ background: '#0a1628', border: `2px solid ${theme.primaryColor || '#00b4d8'}30` }}
              />
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
