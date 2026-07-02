// lib/phase4Flags.ts
//
// Phase 4 of the agents x PulseIQ convergence (docs/CONVERGENCE.md § 4).
// Env-flag helpers that gate the PulseIQ route's delegation to the shared
// chat-core handler (lib/chatCore.ts).
//
// Mirrors the gating idioms in lib/phase3Read.ts + lib/phase3DualWrite.ts.
// Flags default to OFF in production until parity is verified on the new
// path; flip them on per-environment via Vercel env once the cohort layer
// (Phase 5) is wired up.
//
// Removed once the legacy townhall_sessions/townhall_turns code path is
// dropped at the end of Phase 5.

/**
 * TOWNHALL_VIA_AGENT_HANDLER — when true AND a pulseiq_events row resolves
 * for the request's session_id (uuid or slug), /api/townhall/chat
 * bypasses the legacy 995-line PulseIQ orchestrator and delegates to
 * lib/chatCore.handleChatTurn. PulseIQ-specific features (theme
 * assignment, response counter, language switch, auto-end, standby)
 * are NOT carried into the new path in Phase 4 commit 2 — they get
 * rebuilt on the unified substrate in Phase 5.
 *
 * Defaults OFF. With zero pulseiq_events rows in the system, the flag is
 * a no-op on the way in: the new path never matches and the route
 * falls through to legacy.
 */
export function isTownHallViaAgentHandlerEnabled(): boolean {
  const v = process.env.TOWNHALL_VIA_AGENT_HANDLER
  return v === 'true' || v === '1'
}
