/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ensures the survey page renders server-side
  // so study config is never exposed to the browser
  experimental: {
    serverComponentsExternalPackages: []
  }
}

module.exports = nextConfig
