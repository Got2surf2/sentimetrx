// app/privacy/page.tsx — public privacy notice.
//
// Linked from every respondent-facing surface (survey widget, agent chat,
// PulseIQ chat). Static server component, no client JS. Content must stay
// truthful to docs/SECURITY.md § 7 (retention/deletion) and § 8
// (subprocessors) — update this page in the same commit when either
// section changes. Contact address is the real info@datanautix.com
// (already user-facing in agent deflections); never invent addresses.

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Notice — Sentimetrx',
  description: 'How Datanautix handles information collected through Sentimetrx surveys, agents, and live sessions.',
}

const EFFECTIVE_DATE = 'July 3, 2026'

const h2: React.CSSProperties = { fontSize: '1.125rem', fontWeight: 700, color: '#0a1628', marginTop: 36, marginBottom: 10 }
const p: React.CSSProperties = { fontSize: '0.9375rem', lineHeight: 1.7, color: '#374151', marginBottom: 12 }
const li: React.CSSProperties = { fontSize: '0.9375rem', lineHeight: 1.7, color: '#374151', marginBottom: 6 }

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px 80px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0a1628', marginBottom: 4 }}>Privacy Notice</h1>
      <p style={{ fontSize: '0.8125rem', color: '#6b7280', marginBottom: 28 }}>Effective {EFFECTIVE_DATE}</p>

      <p style={p}>
        Sentimetrx is a feedback and analysis platform operated by <strong>Datanautix LLC</strong> (&ldquo;Datanautix&rdquo;,
        &ldquo;we&rdquo;, &ldquo;us&rdquo;). This notice explains what information is handled when you interact with a survey,
        an AI conversation agent, or a live PulseIQ session powered by Sentimetrx, and when you use the Sentimetrx
        application as a customer.
      </p>

      <h2 style={h2}>If you were invited to share feedback</h2>
      <p style={p}>
        When you answer a survey, chat with an agent, or join a live session, you were invited by an organization
        that uses Sentimetrx (for example, a business, campaign, or community group). <strong>That organization
        controls the feedback you provide</strong> — it decides why the feedback is collected, who sees the results,
        and how long it is kept. Datanautix processes your responses on that organization&rsquo;s behalf.
      </p>
      <p style={p}>When you participate, we handle:</p>
      <ul style={{ paddingLeft: 22, marginBottom: 12 }}>
        <li style={li}><strong>What you write or say</strong> — your survey answers and conversation messages, including any optional demographic questions you choose to answer.</li>
        <li style={li}><strong>Basic technical data</strong> — your IP address and browser type, used for rate limiting, security, and abuse prevention.</li>
        <li style={li}><strong>A local session identifier</strong> — stored in your browser&rsquo;s local storage so a refresh doesn&rsquo;t lose your place. Our public feedback pages do not set advertising or analytics tracking cookies.</li>
      </ul>
      <p style={p}>
        Responses are analyzed with the help of AI services (see &ldquo;Service providers&rdquo; below) to summarize
        themes and sentiment for the organization that invited you. Your responses are <strong>never sold</strong> and
        are not used for advertising.
      </p>

      <h2 style={h2}>If you have a Sentimetrx account</h2>
      <p style={p}>
        For customers who sign in to Sentimetrx, we collect your name, email address, and sign-in activity in order
        to operate your account. Your organization&rsquo;s data is isolated from every other customer&rsquo;s and is
        backed up for disaster recovery.
      </p>

      <h2 style={h2}>Service providers</h2>
      <p style={p}>
        Sentimetrx runs on established cloud infrastructure and AI services. Depending on the features an
        organization uses, information may be processed by: <strong>Anthropic</strong> (AI analysis and
        conversation), <strong>OpenAI</strong> (transcription, moderation, and search indexing),
        <strong> Microsoft Azure OpenAI</strong> (AI analysis, where selected), <strong>Deepgram</strong> (audio
        transcription), <strong>Supabase</strong> (database and authentication), <strong>Vercel</strong> (application
        hosting), <strong>Amazon Web Services</strong> (file storage and backups), <strong>Resend</strong>
        (transactional email), and <strong>Sentry</strong> (error monitoring, with personal data scrubbed). Data is
        stored in the United States.
      </p>

      <h2 style={h2}>Retention and deletion</h2>
      <p style={p}>
        Feedback is retained for as long as the organization that collected it keeps its Sentimetrx workspace. When
        an organization&rsquo;s workspace is deleted, its data — including your responses — is erased from our systems.
      </p>
      <p style={p}>
        To ask about, correct, or delete feedback you provided, the fastest path is the organization that invited
        you, since it controls that data. You can also contact us at{' '}
        <a href="mailto:info@datanautix.com" style={{ color: '#0F7173', fontWeight: 600 }}>info@datanautix.com</a> and
        we will route your request to the right organization and support its completion.
      </p>

      <h2 style={h2}>Children</h2>
      <p style={p}>
        Sentimetrx surfaces are not directed to children under 13, and we do not knowingly collect personal
        information from them.
      </p>

      <h2 style={h2}>Changes</h2>
      <p style={p}>
        If this notice changes materially, we will update this page and its effective date. Questions are welcome at{' '}
        <a href="mailto:info@datanautix.com" style={{ color: '#0F7173', fontWeight: 600 }}>info@datanautix.com</a>.
      </p>

      <div style={{ marginTop: 48, paddingTop: 16, borderTop: '1px solid #e5e7eb', fontSize: '0.75rem', color: '#9ca3af' }}>
        Sentimetrx is a product of Datanautix LLC · <a href="https://www.datanautix.com" style={{ color: '#9ca3af' }}>datanautix.com</a>
      </div>
    </main>
  )
}
