// instrumentation.ts
// Next.js entrypoint for server-side instrumentation (App Router 14.2+).
// Loads the appropriate Sentry config based on the runtime.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}
