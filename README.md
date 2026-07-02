# Sentimetrx

[![CI](https://github.com/Got2surf2/sentimetrx/actions/workflows/ci.yml/badge.svg)](https://github.com/Got2surf2/sentimetrx/actions/workflows/ci.yml)

AI-powered conversational feedback intelligence — surveys, town halls, agents, and analytics.

## Local development

```bash
npm install
npm run dev          # http://localhost:3000
```

> **Note on the `xlsx` dependency:** it is sourced from the SheetJS CDN
> (`cdn.sheetjs.com`), not the npm registry — the registry package is
> frozen at an older version. If `npm install` fails with a 403/network
> error on that tarball, it's a CDN-side issue: retry, or download the
> tarball once and `npm install` from a local file. Long-term
> replacement (e.g. `exceljs`) is tracked in the weekly governance
> audit findings.

## Tests

```bash
npm run typecheck    # tsc --noEmit (strict)
npm test             # unit + integration via Vitest
npm run test:e2e     # Playwright (env-gated, see docs/TESTING.md)
```

The full testing strategy — what we test, what we skip, how to add new
tests, and how to wire up the env-gated RLS / Playwright suites — lives
in [`docs/TESTING.md`](docs/TESTING.md).
