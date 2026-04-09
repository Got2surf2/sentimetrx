import { randomUUID } from 'crypto'

// Generates a cryptographically secure GUID for survey links
export function generateStudyGuid(): string {
  return randomUUID()
}

// Build the full public survey URL from a guid
export function surveyUrl(guid: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL
  if (!base && process.env.NODE_ENV !== 'production') {
    console.warn('NEXT_PUBLIC_BASE_URL is not set — falling back to https://sentimetrx.ai')
  }
  return `${base || 'https://sentimetrx.ai'}/s/${guid}`
}
