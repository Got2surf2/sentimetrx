export default function SurveyNotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#0a1628] p-8">
      <div className="text-center max-w-sm">
        <div className="text-5xl mb-6">🔍</div>
        <h1 className="text-2xl font-semibold text-white mb-3">
          Survey not found
        </h1>
        <p className="text-white/50 text-sm leading-relaxed">
          This survey link may have expired, been paused, or the address
          may be incorrect. Please check the link you were sent and try again.
        </p>
      </div>
    </main>
  )
}
