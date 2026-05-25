// next.config.js
const { execSync } = require('child_process')
const { withSentryConfig } = require('@sentry/nextjs')

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
  // Disable browser features we don't use; keeps malicious embedded content
  // from prompting the user for camera/mic/location.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
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
  'invite', 'login', 'settings', 'social', 'studies', 'townhall',
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Raise the body size limit for API routes from the default 4 MB.
  // Dataset row batches can be large; this allows up to 10 MB per request.
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    // Required for Sentry's instrumentation.ts hook on Next.js 14.2.x.
    instrumentationHook: true,
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
    },
  },
  env: {
    NEXT_PUBLIC_BUILD_NUMBER: `${buildYear}.${commitCount}`,
    NEXT_PUBLIC_BUILD_DATE: buildDate,
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
const sentryDsnSet = !!process.env.NEXT_PUBLIC_SENTRY_DSN
module.exports = sentryDsnSet
  ? withSentryConfig(nextConfig, {
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
  : nextConfig
