// lib/jsonSafe.ts
// JSON.stringify with unpaired-UTF-16-surrogate scrubbing. Truncating user
// text by .slice() can cut an emoji in half, leaving a lone surrogate;
// JSON.stringify emits it as a bare \udXXX escape, which upstream APIs
// (Anthropic: "no low surrogate in string") reject as invalid — a 500 for a
// whole request because one review ended in half an emoji (owner-hit 9/02 on
// an emoji-rich dataset). Scrubs every string value at stringify time.

const LONE_HIGH = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g
const LONE_LOW = /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

export function scrubLoneSurrogates(s: string): string {
  return s.replace(LONE_HIGH, '').replace(LONE_LOW, '')
}

/** Drop-in JSON.stringify that scrubs lone surrogates from all string values. */
export function jsonStringifySafe(value: unknown): string {
  return JSON.stringify(value, function(_k, v) {
    return typeof v === 'string' ? scrubLoneSurrogates(v) : v
  })
}
