# scripts/oneoff — one-shot scripts archive

Underscore-prefixed one-off scripts: agent creators and KB seeds
(Sarina/Vindman corpus SQL, Mason, Hope, MCO, MVP+), client-data ingests
(NOWOCATS), delivered deck/brief generators, and ad-hoc QC probes. Each ran
once (or a handful of times) to produce something that now lives elsewhere —
a live agent, a delivered PDF/PPTX, an ingested dataset.

They are kept as the **provenance trail**: how a live agent's knowledge base
was built, how a delivered artifact can be regenerated. They are NOT part of
the operating system of the app — nothing in `app/`, `lib/`, CI, or cron
imports from here, and nothing in here should be imported from production
code.

Conventions:

- New one-offs start life in `scripts/` (underscore-prefixed, untracked)
  while active; move them here (committed) when the work ships. Actively-run
  harnesses stay in `scripts/` — e.g. the untracked `scripts/_verify_*.ts`
  PulseIQ regression set (see `docs/CONVERGENCE.md` § 4.2).
- Most of these ran with env from `.env.local` and the shims
  `scripts/_no_server_only.cjs` / `_server_only_stub.cjs` (which stay in
  `scripts/` because active one-offs also use them).
- Never point one of these at prod without re-reading it first — several
  mutate data (KB seeds, corrections) and predate current invariants.
