# Sentimetrx

[![CI](https://github.com/Got2surf2/sentimetrx/actions/workflows/ci.yml/badge.svg)](https://github.com/Got2surf2/sentimetrx/actions/workflows/ci.yml)

AI-powered conversational feedback intelligence — surveys, town halls, agents, and analytics.

## Local development

```bash
npm install
npm run dev          # http://localhost:3000
```

> **Note on the `xlsx` dependency:** it installs from a tarball vendored
> in this repo (`vendor/xlsx-0.20.3.tgz`, the official SheetJS build —
> integrity-verified against the original CDN artifact). The npm-registry
> `xlsx` package is frozen at 0.18.5 with unfixed CVEs, and installing
> from `cdn.sheetjs.com` at install time 403'd in clean checkouts, so the
> tarball is committed: `npm install` needs no network access for it and
> the bytes can't change underneath us. To upgrade: download the new
> tarball from the SheetJS CDN, verify its published integrity hash, drop
> it in `vendor/`, and update the `file:` reference in `package.json`.

## Tests

```bash
npm run typecheck    # tsc --noEmit (strict)
npm test             # unit + integration via Vitest
npm run test:e2e     # Playwright (env-gated, see docs/TESTING.md)
```

The full testing strategy — what we test, what we skip, how to add new
tests, and how to wire up the env-gated RLS / Playwright suites — lives
in [`docs/TESTING.md`](docs/TESTING.md).
