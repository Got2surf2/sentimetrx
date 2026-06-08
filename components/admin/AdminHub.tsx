'use client'

// components/admin/AdminHub.tsx
// Organized landing page for all admin / settings tools. Replaces the
// flat 11-item dropdown that used to live in the gear menu.
//
// Tabs across the top group tools by purpose; cards within each tab
// link to the actual pages. Adding a new admin tool = add one entry
// to the CARDS array — nothing else.

import { useState } from 'react'
import Link from 'next/link'

const HERMES = '#E8632A'
const TEAL   = '#0F7173'

type Category = 'team' | 'operations' | 'quality' | 'reports'

interface Card {
  category:    Category
  title:       string
  description: string
  href:        string
  icon:        string
  external?:   boolean
}

const CARDS: Card[] = [
  // Team & Org
  { category: 'team', icon: '👥', title: 'Team Management', description: 'Add and manage team members, roles, and pending invites.', href: '/settings/team' },

  // Operations
  { category: 'operations', icon: '🔧', title: 'Admin Panel',      description: 'Manage client organizations, plans, and platform-wide settings.', href: '/admin' },
  { category: 'operations', icon: '📥', title: 'Download Monitor', description: 'Active syncs, errors, frequencies across Reddit, Google Reviews, Substack, Regulations, and uploads.', href: '/admin/downloads' },
  { category: 'operations', icon: '🐛', title: 'Sentry Digest',    description: 'Unresolved production errors with one-click triage.', href: '/admin/sentry' },
  { category: 'operations', icon: '💰', title: 'AI Usage',         description: 'Token usage and cost tracking by org and model.', href: '/admin/usage' },
  { category: 'operations', icon: '🧮', title: 'Cost Estimator',   description: 'Project AI costs for different usage scenarios.', href: '/admin/estimator' },

  // Quality & Testing
  { category: 'quality', icon: '📋', title: 'Question Library', description: 'Reusable survey questions, organized by domain.', href: '/admin/questions' },
  { category: 'quality', icon: '🧪', title: 'Testing Tools',    description: 'End-to-end test runners and platform diagnostics.', href: '/admin/testing' },
  { category: 'quality', icon: '🔍', title: 'Agent Tester',     description: 'Test conversational AI agents in isolation.', href: '/admin/agent-tester' },
  { category: 'quality', icon: '🎲', title: 'Simulators',       description: 'Simulate respondent flows, PulseIQ sessions, and edge cases.', href: '/admin/simulator' },
  { category: 'quality', icon: '🛡',  title: 'Content Guard',    description: 'Test moderation rules and sentiment scoring on sample text.', href: '/admin/content-guard' },
  { category: 'quality', icon: '🏷', title: 'Dimensions Gold Set', description: 'Review & label the REO taxonomy gold set — the eval harness for the Dimensions classifier.', href: '/admin/reo-gold-set' },

  // Reports
  { category: 'reports', icon: '📈', title: 'Governance Trend',   description: 'Weekly audit scores over time — we monitor and improve on a continuous basis.', href: '/admin/governance' },
  { category: 'reports', icon: '📊', title: 'Investor & Client Presentations',     description: 'Investor pitch, rollup, architecture, engineering reality, and per-client expansion decks.', href: '/admin/decks' },
  { category: 'reports', icon: '⚖',  title: 'Audit PR History',   description: 'Source markdown PRs on GitHub — the merge record is the SOC 2 / NIST AI RMF evidence trail.', href: 'https://github.com/Got2surf2/sentimetrx/pulls', external: true },
]

const TABS: { key: Category; label: string }[] = [
  { key: 'team',       label: 'Team & Org' },
  { key: 'operations', label: 'Operations' },
  { key: 'quality',    label: 'Quality & Testing' },
  { key: 'reports',    label: 'Reports' },
]

export default function AdminHub({ buildNumber, buildDate }: { buildNumber?: string; buildDate?: string }) {
  const [tab, setTab] = useState<Category>('operations')

  const tabCards = CARDS.filter(c => c.category === tab)

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Settings & Admin</h1>
          <p className="text-sm text-gray-500 mt-1">Tools for managing the platform, team, and quality.</p>
        </div>
        <form action="/api/auth/signout" method="POST">
          <button
            type="submit"
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 border border-gray-200 transition-colors">
            Sign out
          </button>
        </form>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200 overflow-x-auto">
        {TABS.map(t => {
          const count = CARDS.filter(c => c.category === t.key).length
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: '10px 18px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                background: 'transparent',
                border: 'none',
                borderBottom: active ? '2px solid ' + HERMES : '2px solid transparent',
                color: active ? HERMES : '#6b7280',
                whiteSpace: 'nowrap',
              }}>
              {t.label} <span style={{ color: active ? HERMES + '99' : '#9ca3af', fontWeight: 500 }}>({count})</span>
            </button>
          )
        })}
      </div>

      {/* Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {tabCards.map(card => (
          <CardLink key={card.href} card={card} />
        ))}
      </div>

      {(buildNumber || buildDate) && (
        <div className="mt-12 text-xs text-gray-400 flex items-center gap-3">
          {buildNumber && <span>Build {buildNumber}</span>}
          {buildDate   && <span style={{ color: '#d1d5db' }}>{buildDate}</span>}
        </div>
      )}
    </div>
  )
}

function CardLink({ card }: { card: Card }) {
  const inner = (
    <div
      style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: '18px 20px',
        cursor: 'pointer',
        transition: 'border-color 0.12s, box-shadow 0.12s, transform 0.12s',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = HERMES + '60'
        el.style.boxShadow = '0 4px 14px rgba(232,99,42,0.08)'
        el.style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = '#e5e7eb'
        el.style.boxShadow = 'none'
        el.style.transform = 'translateY(0)'
      }}
    >
      <div className="flex items-center gap-2">
        <span style={{ fontSize: 22 }}>{card.icon}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{card.title}</span>
        {card.external && <span style={{ fontSize: 10, color: '#9ca3af' }}>↗</span>}
      </div>
      <p style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5, margin: 0 }}>
        {card.description}
      </p>
      <div style={{ marginTop: 'auto', paddingTop: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: TEAL }}>
          Open {card.external ? '↗' : '→'}
        </span>
      </div>
    </div>
  )
  if (card.external) {
    return <a href={card.href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>{inner}</a>
  }
  return <Link href={card.href} style={{ textDecoration: 'none' }}>{inner}</Link>
}
