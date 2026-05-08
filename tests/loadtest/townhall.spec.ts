import { test, expect } from '@playwright/test'

// Real-browser load alongside the k6 API load. Each worker drives a full
// participant journey through the actual UI: scan-equivalent navigation to
// /th/[sessionId], chat input via the textarea, send via Enter.
//
// Run via tests/loadtest/playwright.config.ts (workers=BROWSERS env, default 5).

const SESSION = process.env.SESSION_ID
if (!SESSION) {
  throw new Error('Set SESSION_ID env var to a Town Hall session UUID or slug')
}

const BROWSERS = parseInt(process.env.BROWSERS || '5', 10)
const ITER = parseInt(process.env.ITERATIONS_PER_BROWSER || '5', 10)

const SAMPLE_MESSAGES = [
  "I think the new policy is great but I'm worried about how it will affect commute times.",
  "Honestly, I haven't had time to think about it much. Day to day stuff is taking priority.",
  "What I really want is more transparency on how decisions get made.",
  "The team has been so supportive lately, I feel really lucky.",
  "I'm not sure — there are good arguments on both sides.",
  "We need to focus on the basics first before we worry about the bigger stuff.",
  "I appreciate the question. My biggest concern is around equity.",
  "Honestly, I just want things to be a bit simpler.",
]

function pickMessage(): string {
  return SAMPLE_MESSAGES[Math.floor(Math.random() * SAMPLE_MESSAGES.length)]
}

for (let i = 1; i <= BROWSERS; i++) {
  test('participant ' + i + ' chats and submits', async ({ page }) => {
    test.setTimeout(5 * 60_000)

    await page.goto('/th/' + SESSION)

    // Chat textarea has placeholder="Message" (see TownHallChat.tsx)
    const input = page.getByPlaceholder('Message')
    await expect(input).toBeVisible({ timeout: 30_000 })

    for (let n = 0; n < ITER; n++) {
      await input.fill(pickMessage())
      await input.press('Enter')

      // Wait for the bot reply to render before sending the next message.
      // The send button is the up-arrow button next to the textarea —
      // it's disabled while loading=true. Wait until it's re-enabled.
      await page.waitForFunction(() => {
        const btn = document.querySelector('button[disabled]')
        return !btn || !btn.parentElement?.querySelector('textarea[placeholder="Message"]')
      }, { timeout: 30_000 }).catch(() => { /* fall through; soft check */ })

      // Realistic think time
      await page.waitForTimeout(2000 + Math.random() * 3000)
    }
  })
}
