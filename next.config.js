// next.config.js
const { execSync } = require('child_process')

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
  },
  env: {
    NEXT_PUBLIC_BUILD_NUMBER: `${buildYear}.${commitCount}`,
    NEXT_PUBLIC_BUILD_DATE: buildDate,
  },
}

module.exports = nextConfig
