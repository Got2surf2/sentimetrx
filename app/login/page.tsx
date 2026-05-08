import LoginForm from './LoginForm'

// Brand-matched login. Soft warm-cream background, white card with the
// concentric-rings wordmark + Sentimetrx mark on top, brand orange primary
// button + teal hover accents — same palette as the email-wordmark SVG and
// the rich HTML magic-link / password-reset templates that go through
// Supabase Auth. Replaces the previous dark-slate / cyan look.

export default function LoginPage() {
  return (
    <main
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'linear-gradient(180deg, #fff7f0 0%, #fef5ed 60%, #f4f5f7 100%)' }}
    >
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl border border-orange-100/70 px-8 py-10 sm:px-10 sm:py-12">
          <div className="flex flex-col items-center text-center mb-8">
            {/* Concentric-rings wordmark — matches public/email-wordmark.svg
                exactly so the sign-in surface and the branded emails feel
                like one product. */}
            <svg
              width="64"
              height="64"
              viewBox="0 0 60 60"
              fill="none"
              role="img"
              aria-label="Sentimetrx"
            >
              <circle cx="30" cy="30" r="23" stroke="#E8632A" strokeWidth="4" />
              <circle cx="30" cy="30" r="11" stroke="#0F7173" strokeWidth="3" />
              <circle cx="30" cy="30" r="3.5" fill="#E8632A" />
            </svg>
            <h1
              className="text-3xl font-bold mt-5 tracking-tight"
              style={{ color: '#1f2937' }}
            >
              Sentimetrx
            </h1>
            <p className="text-sm mt-2" style={{ color: '#6b7280' }}>
              Sign in to your account
            </p>
          </div>
          <LoginForm />
        </div>
        <p className="text-center text-xs mt-5" style={{ color: '#9ca3af' }}>
          Trouble signing in? Email <a className="underline" style={{ color: '#0F7173' }} href="mailto:support@sentimetrx.com">support@sentimetrx.com</a>
        </p>
      </div>
    </main>
  )
}
