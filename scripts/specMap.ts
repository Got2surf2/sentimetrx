// Spec-doc → code-path map.
//
// Each entry lists the file globs whose changes should be reflected in the spec doc.
// Globs use ** (any depth) and * (no slashes). Next.js path segments like [datasetId]
// are matched literally (the regex escapes [ and ]).
//
// SPEC.md and FEATURES.md are top-level inventory docs; the spec-drift script treats
// them as "inheriting" drift when any module spec is flagged, so they don't get a
// catch-all glob here.

export type SpecKey =
  | 'docs/SECURITY.md'
  | 'docs/ENGINEERING.md'
  | 'docs/TESTING.md'
  | 'docs/USAGE_ACCOUNTING.md'
  | 'docs/DATA_SOURCES.md'
  | 'docs/SEARCH.md'
  | 'docs/SOCIAL.md'
  | 'docs/ANALYTICS.md'
  | 'docs/CAMPAIGNS.md'
  | 'docs/SURVEYS.md'
  | 'docs/BOTS.md'
  | 'docs/TOWNHALL.md'

export const TOP_LEVEL_SPECS = ['SPEC.md', 'FEATURES.md'] as const

export const SPEC_MAP: Record<SpecKey, string[]> = {
  'docs/SECURITY.md': [
    'middleware.ts',
    'lib/auth/**',
    'lib/rateLimit.ts',
    'lib/oauthState.ts',
    'lib/safeFetch.ts',
    'lib/contentGuard.ts',
    'lib/moderation.ts',
    'lib/guardrails.ts',
    'lib/sentry.ts',
    'lib/cronAuth.ts',
    'lib/orgValidate.ts',
    'lib/userContext.ts',
    'lib/resolveOrg.ts',
    'sentry.client.config.ts',
    'sentry.server.config.ts',
    'sentry.edge.config.ts',
    'components/SessionGuard.tsx',
    'components/team/**',
    // RLS / search-path / security migrations — keep this list in sync as new ones land
    'sql/039_rate_limit_buckets.sql',
    'sql/042_*',
    'sql/044_*',
    'sql/048_*',
    'sql/053_*',
    'sql/056_*',
  ],

  'docs/ENGINEERING.md': [
    'tsconfig.json',
    'next.config.js',
    'eslint.config.*',
    '.eslintrc*',
    '.github/workflows/**',
    '.githooks/**',
    'sentry.client.config.ts',
    'sentry.server.config.ts',
    'sentry.edge.config.ts',
    'middleware.ts',
    'CLAUDE.md',
    'components/admin/AdminHub.tsx',
    'components/admin/GovernanceTrend.tsx',
    'components/admin/SentryDigest.tsx',
    'components/downloads/**',
  ],

  'docs/TESTING.md': [
    'tests/**',
    'package.json',
    'playwright.config.ts',
    'vitest.config.*',
  ],

  'docs/USAGE_ACCOUNTING.md': [
    'lib/ai.ts',
    'lib/aiKey.ts',
    'lib/usageLog.ts',
    'lib/usageRates.ts',
    'app/admin/usage/**',
    'app/admin/estimator/**',
    'app/api/admin/usage/**',
    'app/api/me/ai-mode/**',
    'components/admin/OrgAiKeyPanel.tsx',
    'sql/030_*',
    'sql/051_*',
    'sql/052_*',
  ],

  'docs/DATA_SOURCES.md': [
    'app/api/review-sources/**',
    'app/api/reddit-sources/**',
    'app/api/substack-sources/**',
    'app/api/regulations-sources/**',
    'app/api/cron/review-sync/**',
    'components/analyze/GoogleReviewsWizard.tsx',
    'components/analyze/RedditWizard.tsx',
    'components/analyze/SubstackWizard.tsx',
    'components/analyze/RegulationsWizard.tsx',
    'components/analyze/LocationManager.tsx',
    'components/analyze/RegulationsDownloadBanner.tsx',
    'components/analyze/ReviewSyncStatus.tsx',
    'components/analyze/SyncCadenceControl.tsx',
    'lib/dataforseo.ts',
    'lib/reviewSync.ts',
    'lib/reviewLimits.ts',
    'lib/reddit.ts',
    'lib/redditSync.ts',
    'lib/substack.ts',
    'lib/regulations.ts',
    'sql/phase7_*',
    'sql/phase8_*',
    'sql/065_*',
    'sql/067_*',
  ],

  'docs/SEARCH.md': [
    'app/api/datasets/[datasetId]/search/**',
    'app/api/datasets/[datasetId]/search-interest/**',
    'components/analyze/textmine/SearchPanel.tsx',
    'sql/031_*',
    'sql/042_*',
    'sql/044_*',
  ],

  'docs/SOCIAL.md': [
    'app/social/**',
    'app/api/social/**',
    'app/api/cron/social-sync/**',
    'app/api/cron/social-token-refresh/**',
    'lib/socialTagging.ts',
    'lib/oauthState.ts',
    'sql/026_*',
  ],

  'docs/ANALYTICS.md': [
    'app/analyze/**',
    'app/api/datasets/**',
    'components/analyze/**',
    'components/analytics/**',
    'lib/analyticsCompute.ts',
    'lib/analyzeTheme.ts',
    'lib/analyzeTypes.ts',
    'lib/themeUtils.ts',
    'lib/statsUtils.ts',
    'lib/filterUtils.ts',
    'lib/aliasUtils.ts',
    'lib/scaleUtils.ts',
    'lib/opinionMining.ts',
    'lib/sentimentLexicon.ts',
    'lib/signalStats.ts',
    'lib/signalTier.ts',
    'lib/themeImpact.ts',
    'lib/xlsxExport.ts',
    'lib/trendingWords.ts',
    'lib/termInsights.ts',
    'lib/timeBucket.ts',
    'lib/entityDiscovery.ts',
    'lib/entityFilter.ts',
    'lib/entityVariants.ts',
    'lib/brandMatch.ts',
    'lib/brandRules.ts',
    'lib/collectionSchema.ts',
    'lib/datasetUtils.ts',
    'app/api/cron/entity-discovery/**',
    'sql/054_*',
    'sql/055_*',
    'sql/058_*',
    'sql/059_*',
    'sql/060_*',
    'sql/061_*',
    'sql/062_*',
    'sql/063_*',
    'sql/064_*',
    'sql/066_*',
    'sql/069_*',
    'sql/070_*',
  ],

  'docs/CAMPAIGNS.md': [
    'app/campaigns/**',
    'app/studies/[id]/campaigns/**',
    'app/api/campaigns/**',
    'app/api/cron/campaign-scheduler/**',
    'sql/008_*',
    'sql/010_*',
  ],

  'docs/SURVEYS.md': [
    'app/studies/**',
    'app/s/**',
    'app/api/studies/**',
    'app/api/study/**',
    'app/api/respond/**',
    'app/api/clarify/**',
    'app/api/deflect/**',
    'app/api/translate/**',
    'app/api/translate-responses/**',
    'app/api/ai/study-suggest/**',
    'app/api/suggest/**',
    'components/creator/**',
    'components/survey/**',
    'components/dashboard/**',
    'lib/studyDraft.ts',
    'lib/smartStudyGenerator.ts',
    'lib/industryDefaults.ts',
    'lib/industryThemes.ts',
    'lib/surveyBlueprints.ts',
    'lib/psychoBank.ts',
    'sql/001_*',
    'sql/003_*',
  ],

  'docs/BOTS.md': [
    'app/bots/**',
    'app/b/**',
    'app/api/bots/**',
    'app/api/bot-chat/**',
    'app/api/clara-chat/**',
    'app/api/nora-chat/**',
    'app/api/cron/bot-conversation-review/**',
    'components/agent/**',
    'components/ui/ChatBot.tsx',
    'lib/embeddings.ts',
    'lib/personaExtractor.ts',
    'sql/020_*',
    'sql/022_*',
    'sql/023_*',
    'sql/025_*',
  ],

  'docs/TOWNHALL.md': [
    'app/townhall/**',
    'app/th/**',
    'app/api/townhall/**',
    'app/api/cron/townhall-theme-detection/**',
    'components/townhall/**',
    'lib/townhallThemeDetection.ts',
    'sql/011_*',
    'sql/012_*',
    'sql/013_*',
    'sql/014_*',
    'sql/015_*',
    'sql/016_*',
    'sql/017_*',
    'sql/029_*',
    'sql/032_*',
  ],
}
