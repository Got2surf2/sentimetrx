// Mint admin-session stamps with the SAME key the local dev server (scripts/dev.sh test)
// resolves: AI_KEY_ENC_SECRET if set, else the TEST project's service-role key.
// Prints only the stamps — never the key.
import { config as loadDotenv } from 'dotenv'
loadDotenv({ path: '.env.local', override: false })
if (!process.env.AI_KEY_ENC_SECRET && process.env.SUPABASE_TEST_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
}
async function main() {
  const { encodeStamp } = await import('../lib/auth/adminSession')
  const now = Date.now(), h = 3_600_000, m = 60_000
  console.log('EXPIRED_IDLE=' + encodeStamp(now - 3 * h, now - 40 * m))   // seen 40 min ago
  console.log('EXPIRED_MAX=' + encodeStamp(now - 25 * h, now - 1 * m))     // active a minute ago, 25 h old session
  console.log('FRESH=' + encodeStamp(now - 10 * m, now - 1 * m))
  console.log('KEYSRC=' + (process.env.AI_KEY_ENC_SECRET ? 'AI_KEY_ENC_SECRET' : 'SUPABASE_SERVICE_ROLE_KEY(test)'))
}
void main()
