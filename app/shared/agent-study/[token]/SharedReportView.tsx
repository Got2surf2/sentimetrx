'use client'
// app/shared/agent-study/[token]/SharedReportView.tsx
// Renders the baked Agent Study HTML inside a sandboxed iframe. The HTML is a
// point-in-time snapshot built by lib/agentStudyHtml.ts from escaped, derived
// data — but we still sandbox it (scripts + same-origin disabled) so a crafted
// agent/conversation string can never run as same-origin sentimetrx.ai.
// `allow-popups allow-popups-to-escape-sandbox` keeps the footer link clickable.

interface Props {
  html: string
}

export default function SharedReportView({ html }: Props) {
  return (
    <iframe
      srcDoc={html}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      className="w-full min-h-screen border-0"
      title="Shared Agent Study"
    />
  )
}
