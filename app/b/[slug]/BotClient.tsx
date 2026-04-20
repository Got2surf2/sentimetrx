'use client'

// app/b/[slug]/BotClient.tsx
// Client component that renders the shared ChatBot with dynamic bot config

import ChatBot, { type ChatBotConfig } from '@/components/ui/ChatBot'

interface Bot {
  id: string
  name: string
  slug: string
  config: Partial<ChatBotConfig> & { initialMessage?: string; suggestions?: string[] }
}

export default function BotClient({ bot }: { bot: Bot }) {
  const c = bot.config || {}

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
  }

  return <ChatBot config={config} />
}
