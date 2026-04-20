'use client'

import ChatBot from '@/components/ui/ChatBot'

export default function NoraPage() {
  return (
    <ChatBot config={{
      apiEndpoint: '/api/nora-chat',
      name: 'Nora',
      subtitle: 'Tabla Cuisine Virtual Host',
      avatarLetter: 'N',
      headerGradient: 'linear-gradient(135deg, #8B1A1A, #5C1010)',
      avatarGradient: 'linear-gradient(135deg, #D4A843, #B8922F)',
      avatarTextColor: '#5C1010',
      accentColor: '#D4A843',
      pageBg: '#FDF8F3',
      userBubbleBg: '#8B1A1A',
      websiteUrl: 'https://www.tablacuisine.com',
      websiteLabel: 'tablacuisine.com',
      placeholder: 'Ask about Tabla...',
      fontFamily: "'Georgia', 'Times New Roman', serif",
      suggestions: [
        'What kind of food do you serve?',
        'Where are your locations?',
        'How do I make a reservation?',
        'Tell me about catering',
        'Do you have vegetarian options?',
        'What is the Masala Club?',
      ],
      initialMessage: "Welcome to Tabla! I'm Nora, your virtual host. I can help you find a location, explore the menu, make a reservation, or learn about catering and events. What can I help you with?",
    }} />
  )
}
