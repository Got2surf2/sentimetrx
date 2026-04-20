'use client'

import ChatBot from '@/components/ui/ChatBot'

export default function ClaraPage() {
  return (
    <ChatBot config={{
      apiEndpoint: '/api/clara-chat',
      name: 'Clara',
      subtitle: 'Craniometrix Assistant',
      avatarLetter: 'C',
      headerGradient: 'linear-gradient(135deg, #2f3c4c, #1e2a36)',
      avatarGradient: 'linear-gradient(135deg, #8ae0e5, #5bbfc4)',
      avatarTextColor: '#2f3c4c',
      accentColor: '#8ae0e5',
      pageBg: '#f6fdfe',
      userBubbleBg: '#2f3c4c',
      websiteUrl: 'https://www.craniometrix.com',
      websiteLabel: 'craniometrix.com',
      placeholder: 'Ask about Craniometrix...',
      fontFamily: "'Be Vietnam Pro', 'Nunito Sans', system-ui, sans-serif",
      suggestions: [
        'What is Craniometrix?',
        "I'm a caregiver — how can you help?",
        'How does the GUIDE program work?',
        "I'm a provider interested in GUIDE",
        'What is CarePilot?',
        'Is there a cost for families?',
      ],
      initialMessage: "Hi, I'm Clara — your Craniometrix assistant. I'm here to help you learn about how we support dementia patients, caregivers, and providers through the GUIDE program. Are you a caregiver or a healthcare provider?",
    }} />
  )
}
