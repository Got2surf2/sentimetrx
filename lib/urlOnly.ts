// lib/urlOnly.ts
// "Is this text nothing but URLs?" — used to drop link-only rows from signal
// views and report context. The former regex `/^(\s*(https?:\/\/\S+)\s*)+$/i`
// had a nested quantifier (js/redos: exponential on `http://!!!!…`); this is
// a linear token walk with the same acceptance.
export function isUrlOnly(text: string): boolean {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return false
  return tokens.every(t => /^https?:\/\/\S+$/i.test(t))
}
