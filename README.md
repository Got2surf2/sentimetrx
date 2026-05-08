# Sentimetrx

[![CI](https://github.com/Got2surf2/sentimetrx/actions/workflows/ci.yml/badge.svg)](https://github.com/Got2surf2/sentimetrx/actions/workflows/ci.yml)

AI-powered conversational feedback intelligence — surveys, town halls, agents, and analytics.

## Local development

```bash
npm install
npm run dev          # http://localhost:3000
```

## Tests

```bash
npm run typecheck    # tsc --noEmit (strict)
npm test             # unit + integration via Vitest
npm run test:e2e     # Playwright (env-gated, see docs/TESTING.md)
```

The full testing strategy — what we test, what we skip, how to add new
tests, and how to wire up the env-gated RLS / Playwright suites — lives
in [`docs/TESTING.md`](docs/TESTING.md).
