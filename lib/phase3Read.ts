// lib/phase3Read.ts
//
// Phase 3 of the agents x PulseIQ convergence (docs/CONVERGENCE.md).
// Single helper that the admin-read paths consult to decide whether to read
// from the new `conversations` + `conversation_turns` substrate or the legacy
// `bot_conversation_turns` table.
//
// Mirrors the DUAL_WRITE_PHASE3 gating idiom in `lib/phase3DualWrite.ts`.
// READ_PHASE3 defaults to OFF in production until parity is verified on
// each cut-over surface; flip it on per-route via Vercel env (or for the
// whole project once every reader is migrated).
//
// Removed once `bot_conversation_turns` is dropped at the end of Phase 3.

export function isPhase3ReadEnabled(): boolean {
  const v = process.env.READ_PHASE3
  return v === 'true' || v === '1'
}
