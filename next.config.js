// next.config.js
const { execSync } = require('child_process')
const { withSentryConfig } = require('@sentry/nextjs')
const { withWorkflow } = require('workflow/next')

// Build info: injected at build time as NEXT_PUBLIC_ env vars
const commitCount = (() => { try { return execSync('git rev-list --count HEAD').toString().trim() } catch { return '0' } })()
const buildDate = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
const buildYear = new Date().getFullYear().toString().slice(-2)

// Security headers applied to every response. Baseline defense-in-depth that
// the 2026-05-09 review flagged as missing. Two layers:
//   1. baseline — applies everywhere (HSTS, MIME sniffing block, referrer,
//      permissions). These don't break anything.
//   2. authed-only — adds clickjacking protection (X-Frame-Options DENY +
//      CSP frame-ancestors 'none') to dashboard/admin paths but NOT to the
//      public embeddable pages (/s, /b, /th, /shared, /clara, /nora, /bot)
//      which by design get iframed onto customer sites.
const baselineSecurityHeaders = [
  // 2 years, includeSubDomains, preload-eligible. Once browsers see this and
  // remember it, http:// downgrade attacks for sentimetrx.ai are off the table.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Stops a browser from MIME-sniffing a response into something executable
  // (e.g. treating an uploaded "image" with HTML content as text/html).
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // On cross-origin navigations, send only the origin (no path/query) so
  // share/auth tokens don't leak to third parties via the Referer header.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable browser features we don't use; keeps embedded third-party content
  // from prompting the user for camera/location. Microphone is allowed for our
  // OWN origin only (`self`) — the Town Hall live-capture page needs it — while
  // still blocked for cross-origin iframes. The user still sees the normal mic
  // permission prompt; `self` only stops the policy from hard-blocking it.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), interest-cohort=()' },
]

const noFrameHeaders = [
  ...baselineSecurityHeaders,
  // X-Frame-Options is the legacy clickjacking gate; CSP frame-ancestors is
  // the modern equivalent and covers older edge cases. Both, for belt-and-suspenders.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
]

// Routes whose pages users hit while authenticated; these never need to be
// iframed by anyone. Adding clickjacking protection costs nothing here.
const AUTHED_PATH_PREFIXES = [
  'admin', 'analyze', 'auth', 'bots', 'campaigns', 'dashboard',
  'invite', 'login', 'pulseiq', 'settings', 'social', 'studies', 'townhall',
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep the headless-Chrome packages out of the webpack bundle — @sparticuz/
  // chromium ships a binary and puppeteer-core resolves native bits at runtime;
  // bundling them breaks the Agent Study PDF route (app/api/bots/[id]/study/pdf).
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  // Raise the body size limit for API routes from the default 4 MB.
  // Dataset row batches can be large; this allows up to 10 MB per request.
  // instrumentation.ts is stable in Next 15 (the experimental.instrumentationHook
  // flag was removed), so it's auto-loaded — no config needed.
  experimental: {
    // Raise the Server Action body size limit from the default 1 MB.
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  // outputFileTracingIncludes moved out of `experimental` in Next 15.
  // /admin/control-reports* reads docs/weekly-reports/*.md at runtime via
  // fs.readdir + fs.readFile (both lib/governanceReports.ts and
  // lib/specDriftReports.ts). Next.js' static tracer can't statically
  // infer a glob over a dynamic dir, so without this hint the markdown
  // files can be missing from the serverless function bundle on Vercel
  // and the loaders would silently return []. Trace them so every
  // committed weekly report is shipped with the build.
  outputFileTracingIncludes: {
    '/admin/control-reports':            ['./docs/weekly-reports/*.md'],
    '/admin/control-reports/governance': ['./docs/weekly-reports/*.md'],
    '/admin/control-reports/spec-drift': ['./docs/weekly-reports/*.md'],
    // @sparticuz/chromium loads its real payload — the brotli-packed Chromium
    // binary + fonts + swiftshader under bin/ — at runtime via a computed path,
    // so the static tracer never sees those files and leaves them out of the
    // serverless function. The function then dies with: input directory
    // "/var/task/node_modules/@sparticuz/chromium/bin" does not exist. serverExternalPackages
    // (above) keeps the JS from being relocated; this ships the bin/ assets
    // alongside it. Needed on EVERY route that renders a PDF with headless Chrome.
    '/api/recordings/[id]/report/pdf':  ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/recordings/[id]/report/send': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/bots/[id]/study/pdf':         ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/bots/[id]/readout/pdf':       ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/collections/[id]/project-report/pdf': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/datasets/[datasetId]/ad-hoc-report':  ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/ana/export-pdf':                      ['./node_modules/@sparticuz/chromium/bin/**'],
    '/story/[slug]/pdf':                        ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/datasets/[datasetId]/outlet-report-pdf': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/datasets/[datasetId]/outlet-leaderboard-pdf': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/datasets/[datasetId]/hierarchy-report-pdf':  ['./node_modules/@sparticuz/chromium/bin/**'],
    // Admin deck PDF routes — same headless-Chrome dependency.
    '/api/community-feedback-deck':     ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/pitch-deck-v2':               ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/pitch-deck-v3':               ['./node_modules/@sparticuz/chromium/bin/**'],
  },
  env: {
    NEXT_PUBLIC_BUILD_NUMBER: `${buildYear}.${commitCount}`,
    NEXT_PUBLIC_BUILD_DATE: buildDate,
  },
  async redirects() {
    return [
      // The PulseIQ admin page moved from /townhall to /pulseiq (2026-07 —
      // the user-facing product name is "PulseIQ"). Old bookmarks/links keep
      // working. API routes stay at /api/townhall and are unaffected.
      { source: '/townhall', destination: '/pulseiq', permanent: true },
      { source: '/townhall/:path*', destination: '/pulseiq/:path*', permanent: true },
    ]
  },
  async headers() {
    return [
      // Layer 1: baseline headers everywhere.
      { source: '/:path*', headers: baselineSecurityHeaders },
      // Layer 2: clickjacking protection only on authed dashboard/admin paths.
      // The root `/` is the marketing page — also no-frame.
      { source: '/', headers: noFrameHeaders },
      ...AUTHED_PATH_PREFIXES.map((prefix) => ({
        source: `/${prefix}/:path*`,
        headers: noFrameHeaders,
      })),
      ...AUTHED_PATH_PREFIXES.map((prefix) => ({
        source: `/${prefix}`,
        headers: noFrameHeaders,
      })),
    ]
  },
}

// Sentry build-time wrapper. Skipped in local dev (when no DSN is set) so the
// dev server starts fast — Sentry's webpack plugins add significant compile
// time on first start. In production/preview the DSN is set and the wrapper
// runs, enabling source-map upload (when SENTRY_AUTH_TOKEN is also set).
// Workflow DevKit wrap enables `"use workflow"` / `"use step"` directives and
// installs the internal `/.well-known/workflow/*` route handler used by the
// runtime. Must wrap before Sentry so Sentry sees the augmented config.
const withWdk = withWorkflow(nextConfig)

const sentryDsnSet = !!process.env.NEXT_PUBLIC_SENTRY_DSN
module.exports = sentryDsnSet
  ? withSentryConfig(withWdk, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      hideSourceMaps: true,
      // disableLogger was deprecated in @sentry/nextjs v10; the replacement
      // lives under webpack.treeshake.removeDebugLogging.
      webpack: {
        treeshake: { removeDebugLogging: true },
      },
    })
  : withWdk
