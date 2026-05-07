// next.config.js
const { execSync } = require('child_process')
const { withSentryConfig } = require('@sentry/nextjs')

// Build info: injected at build time as NEXT_PUBLIC_ env vars
const commitCount = (() => { try { return execSync('git rev-list --count HEAD').toString().trim() } catch { return '0' } })()
const buildDate = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
const buildYear = new Date().getFullYear().toString().slice(-2)

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
  },
  env: {
    NEXT_PUBLIC_BUILD_NUMBER: `${buildYear}.${commitCount}`,
    NEXT_PUBLIC_BUILD_DATE: buildDate,
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
