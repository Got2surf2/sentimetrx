// Generates a URL-safe GUID for survey links
// Format: 3 groups of 8 hex chars, e.g. "a3f9c2d1-b72e4f81-c09d3a52"
export function generateStudyGuid(): string {
  const hex = () =>
    Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0')
  return `${hex()}-${hex()}-${hex()}`
}

// Build the full public survey URL from a guid
export function surveyUrl(guid: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://sentimetrx.ai'
  return `${base}/s/${guid}`
}
