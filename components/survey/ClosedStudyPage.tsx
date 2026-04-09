// components/survey/ClosedStudyPage.tsx
// Shown when someone accesses a closed or draft study URL

interface Props {
  study: {
    name:      string
    bot_name:  string
    bot_emoji: string
    status:    string
    config?:   any
  }
}

export default function ClosedStudyPage({ study }: Props) {
  const bg     = study.config?.theme?.backgroundColor || '#0a1628'
  const isDraft = study.status === 'draft'

  return (
    <main
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: bg }}
    >
      <div className="max-w-md w-full text-center">
        {/* Bot avatar */}
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center text-4xl mx-auto mb-6 shadow-lg"
          style={{ background: study.config?.theme?.headerGradient || 'linear-gradient(135deg,#E8632A,#c44d1a)' }}
        >
          {study.bot_emoji}
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">{study.bot_name}</h1>
        <p className="text-white/60 text-sm mb-8">{study.name}</p>

        <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl p-8">
          {isDraft ? (
            <>
              <div className="text-4xl mb-4">🚧</div>
              <h2 className="text-white font-bold text-lg mb-2">Not yet available</h2>
              <p className="text-white/60 text-sm leading-relaxed">
                This survey isn&apos;t published yet. Check back soon.
              </p>
            </>
          ) : (
            <>
              <div className="text-4xl mb-4">🔒</div>
              <h2 className="text-white font-bold text-lg mb-2">This survey is now closed</h2>
              <p className="text-white/60 text-sm leading-relaxed">
                Thank you for your interest. This survey is no longer accepting responses.
              </p>
            </>
          )}
        </div>

        <p className="text-white/30 text-xs mt-8">
          Powered by <span className="text-white/50 font-medium">sentimetrx.ai</span>
        </p>
      </div>
    </main>
  )
}
