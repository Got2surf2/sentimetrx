import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    // Default to node. Component tests should opt into jsdom via the
    // `// @vitest-environment jsdom` directive at the top of the file.
    environment: 'node',
    coverage: {
      provider: 'v8',
      // json-summary writes coverage/coverage-summary.json, which is what the
      // weekly audit reads (.claude/commands/audit-codebase.md, Category 5).
      // Without it the audit has NO coverage data and falls back to a file-count
      // ratio — the proxy that produced two weeks of meaningless Tests scores.
      reporter: ['text', 'html', 'json-summary'],
      include: ['lib/**/*.ts', 'app/api/**/*.ts'],
      // Internal deck generators are OUT of the coverage surface (owner call,
      // 2026-09-01: every standalone deck is internal-consumption only and not
      // subject to the audit's testing bar). The rule is structural: every
      // TOP-LEVEL app/api/*-deck route + the lib/pptx builders only those
      // routes import. Product-facing PPTX stays IN: shared/slideRenderer/
      // styles infrastructure, dataset-scoped deck routes (outlet-plan,
      // operational-review, improvement-plan), and the dataset/agent/recording/
      // collection export builders. See docs/TESTING.md "Coverage surface".
      exclude: [
        '**/*.test.*', 'tests/**',
        'app/api/*-deck/**',
        'lib/pptx/advancedResearchDeck.ts',
        'lib/pptx/blueMountainsNepaDeck.ts',
        'lib/pptx/eaMembershipDeck.ts',
        'lib/pptx/eaNpsPitchDeck.ts',
        'lib/pptx/mcoListeningDeck.ts',
        'lib/pptx/mcoLogo.ts',
        'lib/pptx/nepaCaraReimaginedDeck.ts',
        'lib/pptx/projectInsightDeck.ts',
        'lib/pptx/reviewIntelligenceDeck.ts',
        'lib/pptx/salesPitchDeck.ts',
      ],
      // Ratcheting floor — set just below the current baseline so unrelated
      // churn doesn't redden CI, but no regression is allowed. Bump these up
      // as each batch of tests lands (governance Tests-score progression plan).
      // Ratcheted 2026-08-16: 20/15/20/20 → 30/23/33/30. The old floor sat ~10pp
      // under the real numbers, so it would have passed a 30% regression without
      // complaint — a floor that far below actual isn't a gate, it's decoration.
      // Measured: statements 30.7 · branches 24.07 · functions 33.79 · lines 31.26.
      // Ratcheted 2026-09-01 across the coverage-week suites (lib/csv, chatCore
      // turns + RAG/super/townhall, aux route gates, outletReport) and the
      // internal-deck exclusion. Measured after the outletReport suite:
      // statements 35.03 · branches 26.82 · functions 37.63 · lines 35.95.
      thresholds: {
        statements: 34,
        branches: 26,
        functions: 36,
        lines: 35,
      },
    },
  },
})
