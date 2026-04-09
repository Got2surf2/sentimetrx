// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Raise the body size limit for API routes from the default 4 MB.
  // Dataset row batches can be large; this allows up to 10 MB per request.
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
}

module.exports = nextConfig
