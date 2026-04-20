'use client'

import ChatBot from '@/components/ui/ChatBot'

export default function BotPage() {
  return (
    <ChatBot config={{
      apiEndpoint: '/api/bot-chat',
      name: 'Datanautix Assistant',
      subtitle: 'Ask me anything about our products',
      avatarLetter: '🤖',
      headerGradient: 'linear-gradient(135deg, #0a1628, #1a2d4a)',
      avatarGradient: 'linear-gradient(135deg, #00b4d8, #0077a8)',
      accentColor: '#00b4d8',
      pageBg: '#f8fafc',
      userBubbleBg: '#0a1628',
      websiteUrl: 'https://www.datanautix.com',
      websiteLabel: 'datanautix.com',
      placeholder: 'Ask about Datanautix products...',
      suggestions: [
        'What does Datanautix do?',
        'How is Sarina different from SurveyMonkey?',
        'What results can I expect?',
        'Tell me about Ana text analytics',
        'What languages do you support?',
        'How does pricing work?',
      ],
      initialMessage: "Hi! I'm the Datanautix assistant. I can answer questions about our products — **Sarina** (conversational surveys), **Ana** (text analytics), and the **Datanautix Platform** (our integrated suite). What would you like to know?",
    }} />
  )
}
