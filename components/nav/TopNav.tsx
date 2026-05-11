'use client'

import { useState } from 'react'
import Link from 'next/link'
import DatanautixAttribution from '@/components/ui/DatanautixAttribution'

interface Props {
  logoUrl?:        string
  orgName?:        string
  isAdmin?:        boolean
  userEmail?:      string
  fullName?:       string
  crumbs?:         any
  analyzeEnabled?: boolean   // legacy — use features.analyze instead
  campaignsEnabled?: boolean // legacy — use features.campaigns instead
  features?: { surveys?: boolean; analyze?: boolean; googleReviews?: boolean; reddit?: boolean; substack?: boolean; townhall?: boolean; campaigns?: boolean; bots?: boolean; social?: boolean }
  currentPage?:    'dashboard' | 'team' | 'admin' | 'questions' | 'responses' | 'analytics' | 'edit' | 'deploy' | 'new' | 'analyze' | 'campaigns' | 'townhall' | 'bots' | 'social' | 'test-spinner' | 'agent-tester' | 'simulator' | 'content-guard' | 'usage' | 'estimator' | 'decks' | 'downloads'
  datasetName?:    string    // shown as centered pill when inside a dataset
}

const HERMES = '#E8632A'

function CogMenu({ currentPage }: { currentPage?: string }) {
  var [open, setOpen] = useState(false)
  // Active when on any hub-linked page (covers team, all /admin/* pages,
  // downloads, etc.). Keeps the gear visually anchored on those pages.
  var isActive = currentPage === 'team' || currentPage === 'admin' || currentPage === 'questions' || currentPage === 'downloads'
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={function() { setOpen(function(v) { return !v }) }}
        className={'text-sm font-medium transition-all whitespace-nowrap px-2.5 py-1.5 rounded-full ' +
          (isActive ? 'bg-white/25 text-white' : 'text-orange-100 hover:bg-white/15 hover:text-white')}
        title="Settings & Admin"
        style={{ fontSize: 16, lineHeight: 1 }}>
        {'\u2699'}
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={function() { setOpen(false) }} />
          <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, background: 'white', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.15)', zIndex: 100, minWidth: 200, padding: '4px 0', overflow: 'hidden' }}>
            <Link href="/admin/hub" onClick={function() { setOpen(false) }}
              style={{ display: 'block', padding: '10px 16px', fontSize: 13, fontWeight: 600, color: '#374151', textDecoration: 'none', transition: 'background .1s' }}
              onMouseEnter={function(e) { (e.target as HTMLElement).style.background = '#f9fafb' }}
              onMouseLeave={function(e) { (e.target as HTMLElement).style.background = 'transparent' }}>
              {'\u2699'} Settings & Admin
            </Link>
            <form action="/api/auth/signout" method="POST">
              <button type="submit"
                onClick={function() { setOpen(false) }}
                style={{ display: 'block', width: '100%', textAlign: 'left' as const, padding: '10px 16px', fontSize: 13, fontWeight: 500, color: '#374151', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', transition: 'background .1s' }}
                onMouseEnter={function(e) { (e.target as HTMLElement).style.background = '#f9fafb' }}
                onMouseLeave={function(e) { (e.target as HTMLElement).style.background = 'transparent' }}>
                {'\u21A6'} Sign out
              </button>
            </form>
            <div style={{ borderTop: '1px solid #f3f4f6', margin: '4px 0' }} />
            <div style={{ padding: '8px 16px' }}>
              <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Build {process.env.NEXT_PUBLIC_BUILD_NUMBER}</div>
              <div style={{ fontSize: 10, color: '#d1d5db', marginTop: 2 }}>{process.env.NEXT_PUBLIC_BUILD_DATE}</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function TopNav({ logoUrl, orgName, isAdmin, userEmail, fullName, analyzeEnabled, campaignsEnabled, features, currentPage, datasetName }: Props) {
  // Merge legacy props with features object. When a feature flag is not
  // explicitly set we default to *visible* so the nav stays consistent across
  // pages that don't bother resolving features (legacy, mostly admin pages).
  // Admins always see every nav item regardless of org-level flags so they
  // can support / manage everything. Pages that want strict per-feature
  // gating must pass the resolved `features` object.
  const f = {
    surveys:   (features?.surveys   !== undefined ? features.surveys   : true)                              || !!isAdmin,
    analyze:   (features?.analyze   !== undefined ? features.analyze   : (analyzeEnabled   ?? true))        || !!isAdmin,
    townhall:  (features?.townhall  !== undefined ? features.townhall  : true)                              || !!isAdmin,
    campaigns: (features?.campaigns !== undefined ? features.campaigns : (campaignsEnabled ?? true))        || !!isAdmin,
    bots:      (features?.bots      !== undefined ? features.bots      : true)                              || !!isAdmin,
    social:    (features?.social    !== undefined ? features.social    : true)                              || !!isAdmin,
  }

  const surveyPages = new Set(['dashboard', 'new', 'edit', 'deploy', 'responses'])

  // Mobile drawer state — used by the hamburger when the bar collapses.
  const [mobileOpen, setMobileOpen] = useState(false)

  // navLink renders icon + label. The label hides at narrower widths via
  // `hidden xl:inline` so the bar shrinks to icons only between md and xl.
  // The same function is reused vertically inside the mobile drawer.
  const navLink = (page: string, href: string, label: string, icon: string, mode: 'bar' | 'drawer' = 'bar') => {
    const active = page === 'dashboard' ? surveyPages.has(currentPage || '') : currentPage === page
    if (mode === 'drawer') {
      return (
        <Link key={page} href={href} onClick={() => setMobileOpen(false)}
          className={'flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors ' +
            (active ? 'bg-orange-50 text-orange-700' : 'text-gray-700 hover:bg-gray-50')}>
          <span className="text-base w-5 text-center">{icon}</span>
          <span>{label}</span>
        </Link>
      )
    }
    return (
      <Link key={page} href={href} title={label}
        className={'flex items-center gap-1.5 text-sm font-medium transition-all whitespace-nowrap px-2.5 py-1.5 rounded-full ' +
          (active ? 'bg-white/25 text-white' : 'text-orange-100 hover:bg-white/15 hover:text-white')}>
        <span className="text-base leading-none">{icon}</span>
        {/* Active item always shows its label so the user can see which page
            they're on at narrow widths. Non-active items stay icons-only
            until the full xl breakpoint. */}
        <span className={active ? 'inline' : 'hidden xl:inline'}>{label}</span>
      </Link>
    )
  }

  // Items array drives both the desktop bar and the mobile drawer.
  const navItems: Array<{ page: string; href: string; label: string; icon: string; show: boolean }> = [
    { page: 'analyze',   href: '/analyze',   label: 'Analytics', icon: '📊', show: f.analyze },   // 📊
    { page: 'dashboard', href: '/dashboard', label: 'Surveys',   icon: '📝', show: f.surveys },   // 📝
    { page: 'campaigns', href: '/campaigns', label: 'Campaigns', icon: '✉',       show: f.campaigns }, // ✉
    { page: 'townhall',  href: '/townhall',  label: 'PulseIQ',   icon: '💬', show: f.townhall },  // 💬
    { page: 'bots',      href: '/bots',      label: 'Agents',    icon: '🤖', show: f.bots },     // 🤖
    { page: 'social',    href: '/social',    label: 'Social',    icon: '📱', show: f.social },   // 📱
  ]

  const displayName = fullName
    ? (fullName + (userEmail ? ' (' + userEmail + ')' : ''))
    : userEmail || ''

  return (
    <nav className="px-5 flex items-center justify-between h-14 fixed top-0 left-0 right-0 z-50 shadow-md"
      style={{ background: HERMES }}>

      {/* Left: logo + org name + user */}
      <div className="flex items-center gap-3 min-w-0">
        <Link href="/dashboard" className="flex items-center gap-2.5 flex-shrink-0">
          {logoUrl ? (
            <img src={logoUrl} alt={orgName || 'Logo'} className="h-8 w-auto object-contain max-w-[120px] rounded" />
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
                <span className="text-white font-black text-sm leading-none">S</span>
              </div>
              <span className="font-bold text-white text-sm tracking-tight whitespace-nowrap">sentimetrx.ai</span>
            </div>
          )}
        </Link>
        <DatanautixAttribution variant="compact" className="hidden sm:inline-block" />
        {orgName && (
          <>
            <span className="text-orange-200/60 text-sm hidden sm:block">|</span>
            <span className="text-orange-100 text-sm font-medium truncate max-w-[120px] hidden sm:block">{orgName}</span>
          </>
        )}
        {displayName && !datasetName && (
          <>
            <span className="text-orange-200/40 text-sm hidden lg:block">·</span>
            <span className="text-orange-200 text-xs truncate max-w-[180px] hidden lg:block">{displayName}</span>
          </>
        )}
        {datasetName && (
          <>
            <span className="text-orange-200/60 text-sm hidden sm:block">|</span>
            <span style={{
              background: '#2563eb', color: 'white', fontSize: 11, fontWeight: 700,
              padding: '3px 12px', borderRadius: 20, whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220,
              flexShrink: 1, minWidth: 0,
            }} className="hidden sm:block" title={datasetName}>
              {datasetName}
            </span>
          </>
        )}
      </div>

      {/* Right: nav — full bar at md+, hamburger on smaller screens */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {/* Desktop / tablet: horizontal nav with icons (labels appear at xl+) */}
        <div className="hidden md:flex items-center gap-0.5">
          {navItems.filter(n => n.show).map(n => navLink(n.page, n.href, n.label, n.icon, 'bar'))}
          {isAdmin && <CogMenu currentPage={currentPage} />}
          <div className="w-px h-5 bg-white/20 mx-2" />
          <form action="/api/auth/signout" method="POST">
            <button title="Sign out" className="flex items-center gap-1.5 text-sm text-orange-100 hover:text-white hover:bg-white/15 transition-all px-2.5 py-1.5 rounded-full whitespace-nowrap">
              <span className="text-base leading-none">↦</span>
              <span className="hidden xl:inline">Sign out</span>
            </button>
          </form>
        </div>

        {/* Mobile: hamburger button */}
        <button onClick={() => setMobileOpen(v => !v)} aria-label="Menu"
          className="md:hidden text-white text-2xl px-2 py-1 rounded-full hover:bg-white/15 transition-colors">
          {mobileOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* Mobile drawer — overlays from below the nav bar */}
      {mobileOpen && (
        <>
          <div className="md:hidden fixed inset-0 top-14 bg-black/30 z-40" onClick={() => setMobileOpen(false)} />
          <div className="md:hidden fixed top-14 right-0 left-0 bg-white shadow-lg z-50 max-h-[80vh] overflow-y-auto">
            {navItems.filter(n => n.show).map(n => navLink(n.page, n.href, n.label, n.icon, 'drawer'))}
            {isAdmin && (
              <>
                <div className="border-t border-gray-100 my-1" />
                <Link href="/settings/team" onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  <span className="text-base w-5 text-center">{'👥'}</span><span>Team Management</span>
                </Link>
                <Link href="/admin" onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  <span className="text-base w-5 text-center">{'🔧'}</span><span>Admin Panel</span>
                </Link>
                <Link href="/admin/downloads" onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  <span className="text-base w-5 text-center">{'📥'}</span><span>Download Monitor</span>
                </Link>
                <Link href="/admin/usage" onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  <span className="text-base w-5 text-center">{'💰'}</span><span>AI Usage</span>
                </Link>
                <Link href="/admin/decks" onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  <span className="text-base w-5 text-center">{'📊'}</span><span>Investor Decks</span>
                </Link>
                <a href="https://github.com/Got2surf2/sentimetrx/pulls" target="_blank" rel="noopener noreferrer" onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  <span className="text-base w-5 text-center">{'⚖'}</span><span>Governance Reports</span>
                </a>
              </>
            )}
            <div className="border-t border-gray-100 my-1" />
            <form action="/api/auth/signout" method="POST">
              <button className="w-full flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 text-left">
                <span className="text-base w-5 text-center">↦</span><span>Sign out</span>
              </button>
            </form>
          </div>
        </>
      )}
    </nav>
  )
}
