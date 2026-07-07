'use client'

// app/b/[slug]/BotClient.tsx
// Client component that renders the shared ChatBot with dynamic bot config

import { useSearchParams } from 'next/navigation'
import ChatBot, { type ChatBotConfig } from '@/components/ui/ChatBot'

interface Bot {
  id: string
  name: string
  slug: string
  // askName/dynamicChips may arrive from DB JSON as strings ('false'/'true'),
  // so they're widened here to allow the raw string comparisons below.
  config: Partial<Omit<ChatBotConfig, 'askName' | 'dynamicChips'>> & {
    initialMessage?: string
    suggestions?: string[]
    askName?: boolean | string
    dynamicChips?: boolean | string
  }
  // True when any research probe is enabled (server-computed) — forces the
  // §14.3 disclosure line in the widget chrome, not removable while active.
  researchDisclosure?: boolean
}

const ALLOWED_SITES = new Set(['foundations', 'coalition'])

export default function BotClient({ bot }: { bot: Bot }) {
  const c = bot.config || {}
  const searchParams = useSearchParams()
  const rawSite = searchParams?.get('site')?.toLowerCase() || ''
  const site = ALLOWED_SITES.has(rawSite) ? rawSite : null

  const config: ChatBotConfig = {
    apiEndpoint: '/api/bots/' + bot.id + '/chat',
    name: c.name || bot.name,
    subtitle: c.subtitle || '',
    avatarLetter: c.avatarLetter || bot.name.charAt(0).toUpperCase(),
    headerGradient: c.headerGradient || 'linear-gradient(135deg, #0a1628, #1a2d4a)',
    avatarGradient: c.avatarGradient || 'linear-gradient(135deg, #00b4d8, #0077a8)',
    avatarTextColor: c.avatarTextColor,
    accentColor: c.accentColor || '#00b4d8',
    pageBg: c.pageBg || '#f8fafc',
    userBubbleBg: c.userBubbleBg || '#0a1628',
    websiteUrl: c.websiteUrl || 'https://www.datanautix.com',
    websiteLabel: c.websiteLabel || 'datanautix.com',
    placeholder: c.placeholder || 'Ask me anything...',
    fontFamily: c.fontFamily,
    suggestions: c.suggestions || [],
    initialMessage: c.initialMessage || 'Hi! How can I help you today?',
    askName: c.askName !== 'false',
    dynamicChips: c.dynamicChips === true || c.dynamicChips === 'true',
    languages: Array.isArray(c.languages) ? c.languages : undefined,
    language: c.language,
    extraBody: site ? { site } : undefined,
    researchDisclosure: bot.researchDisclosure === true,
  }

  return <ChatBot config={config} />
}
