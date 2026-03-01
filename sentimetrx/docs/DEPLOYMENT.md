# Sentimetrx — Phase 1 Deployment Guide
## Complete Step-by-Step Instructions

**Reading time: 20 minutes**
**Setup time: 60–90 minutes**
**Technical skill required: None — every step is point-and-click**

By the end of this guide you will have:
- A live survey at `sentimetrx.ai/s/test-charity-001`
- A login-protected dashboard at `sentimetrx.ai/dashboard`
- All survey responses saving to a secure database
- Everything running on professional infrastructure at no initial cost

---

## What You're Setting Up

You need three free accounts:

| Service | What it does | Cost |
|---------|-------------|------|
| **GitHub** | Stores your code securely | Free |
| **Supabase** | Your database and user login system | Free tier |
| **Vercel** | Hosts your website | Free tier |

You also need access to your domain registrar (wherever `sentimetrx.ai` is registered) to point it at Vercel.

---

## PART 1 — GitHub (Code Storage)
*Time: 10 minutes*

GitHub stores your code and connects to Vercel so that every time you make a change, your website updates automatically.

### Step 1 — Create a GitHub account

1. Go to **github.com**
2. Click **Sign up**
3. Enter your email, create a password, choose a username
4. Verify your email address
5. On the plan page, choose **Free**

### Step 2 — Create a new repository

1. Once logged in, click the **+** icon in the top-right corner
2. Click **New repository**
3. Fill in:
   - **Repository name:** `sentimetrx`
   - **Description:** `Sentimetrx survey platform`
   - **Visibility:** Choose **Private** (keeps your code invisible to others)
4. Check **✓ Add a README file**
5. Click **Create repository**

### Step 3 — Upload the project files

1. On your new repository page, click **uploading an existing file** (in the "Quick setup" section, or click **Add file → Upload files**)
2. Upload all the files from the `sentimetrx` folder you received, maintaining the folder structure:
   - Drag the entire `sentimetrx` folder contents into the upload area
   - Make sure these folders are present: `app/`, `components/`, `lib/`, `sql/`, `docs/`
3. At the bottom, type a commit message: `Initial Phase 1 deployment`
4. Click **Commit changes**

> **Important:** Do NOT upload the `.env.local` file (it contains secret keys). The `.gitignore` file in the project already excludes it. Upload `.env.example` instead — it's just a template with placeholder values.

---

## PART 2 — Supabase (Database)
*Time: 20 minutes*

Supabase is your database. It stores all your survey studies and every response collected.

### Step 4 — Create a Supabase account

1. Go to **supabase.com**
2. Click **Start your project**
3. Sign up with your GitHub account (click **Continue with GitHub**) — this links them together conveniently
4. You'll be taken to your Supabase dashboard

### Step 5 — Create a new project

1. Click **New project**
2. Fill in:
   - **Organization:** Your name or company name
   - **Project name:** `sentimetrx`
   - **Database Password:** Create a strong password (save this somewhere safe — you'll need it)
   - **Region:** Choose the one closest to your users (e.g., `US East (N. Virginia)` for Florida)
3. Click **Create new project**
4. Wait 1–2 minutes for the project to finish setting up (you'll see a progress bar)

### Step 6 — Run the database schema

This creates all the tables your application needs.

1. In the left sidebar, click **SQL Editor** (it looks like `</>`)
2. Click **New query**
3. Open the file `sql/001_schema.sql` from the project files
4. Copy the entire contents of that file
5. Paste it into the SQL editor
6. Click **Run** (or press Ctrl+Enter / Cmd+Enter)
7. You should see `Success. No rows returned` — this is correct

### Step 7 — Create your admin account

1. In the left sidebar, click **Authentication** (the person icon)
2. Click **Users** in the top tab bar
3. Click **Add user → Create new user**
4. Enter:
   - **Email:** your email address
   - **Password:** a strong password (this is your login for the dashboard)
5. Click **Create user**
6. You'll see your new user appear in the list — **copy the UUID** in the first column (it looks like `a3f9c2d1-b72e-4f81-c09d-3a524e8b1c70`)

### Step 8 — Link your admin account to the database

1. Go back to **SQL Editor** and click **New query**
2. Open the file `sql/002_seed.sql` from the project files
3. Copy the entire contents
4. Paste it into the SQL editor
5. **Before running**, make two replacements:
   - Replace `YOUR_ADMIN_AUTH_UID` with the UUID you copied in Step 7
   - Replace `your@email.com` with your actual email address
6. Click **Run**
7. You should see a table appear showing your test study — this confirms everything is working

### Step 9 — Get your API keys

1. In the left sidebar, click **Project Settings** (the gear icon at the bottom)
2. Click **API** in the settings menu
3. You'll see three values — **keep this page open**, you'll need them in the next part:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon public** key — a very long string of letters and numbers
   - **service_role** key — another very long string (marked "secret")

---

## PART 3 — Vercel (Website Hosting)
*Time: 20 minutes*

Vercel hosts your Next.js application and makes it available at your domain.

### Step 10 — Create a Vercel account

1. Go to **vercel.com**
2. Click **Sign Up**
3. Choose **Continue with GitHub** — this links them so Vercel can access your code
4. Authorize the connection when prompted
5. Choose the **Hobby** plan (free)

### Step 11 — Import your project

1. On your Vercel dashboard, click **Add New → Project**
2. You'll see your GitHub repositories — find `sentimetrx` and click **Import**
3. On the configuration screen:
   - **Framework Preset** should auto-detect as `Next.js` — if not, select it manually
   - **Root Directory** should be `.` (the default) — leave it
   - Do NOT click Deploy yet — you need to add your environment variables first

### Step 12 — Add environment variables

This is where you give Vercel the secret keys to connect to your database.

1. On the same configuration screen, scroll down to **Environment Variables**
2. Add each of the following, one at a time (click **Add** after each):

   **Variable 1:**
   - Name: `NEXT_PUBLIC_SUPABASE_URL`
   - Value: paste your **Project URL** from Step 9 (e.g. `https://abcdefgh.supabase.co`)

   **Variable 2:**
   - Name: `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Value: paste your **anon public** key from Step 9

   **Variable 3:**
   - Name: `SUPABASE_SERVICE_ROLE_KEY`
   - Value: paste your **service_role** key from Step 9

   **Variable 4:**
   - Name: `NEXT_PUBLIC_BASE_URL`
   - Value: `https://sentimetrx.ai`

3. After adding all four, click **Deploy**
4. Wait 2–3 minutes for the build to complete
5. You'll see a success screen with a Vercel URL like `sentimetrx-abc123.vercel.app`
6. Click **Visit** to confirm your site is live (it'll show the dashboard login page)

### Step 13 — Add your custom domain

1. On your project page in Vercel, click **Settings** in the top menu
2. Click **Domains** in the left sidebar
3. Type `sentimetrx.ai` and click **Add**
4. Also add `www.sentimetrx.ai` and click **Add**
5. Vercel will show you DNS records to add — **keep this page open**

### Step 14 — Update your DNS records

This tells the internet that `sentimetrx.ai` should point to Vercel.

1. Log in to wherever you registered `sentimetrx.ai` (GoDaddy, Namecheap, Google Domains, Cloudflare, etc.)
2. Find the **DNS Management** or **DNS Records** section
3. Add the records Vercel showed you in Step 13. They'll look something like:

   | Type | Name | Value |
   |------|------|-------|
   | A | @ | 76.76.21.21 |
   | CNAME | www | cname.vercel-dns.com |

4. Save the changes
5. DNS changes can take 5 minutes to 48 hours to fully propagate — usually under 30 minutes

### Step 15 — Verify your domain is live

1. Go back to Vercel → Settings → Domains
2. Wait until both `sentimetrx.ai` and `www.sentimetrx.ai` show a green ✓ checkmark
3. Visit `https://sentimetrx.ai` — you should see the login page

---

## PART 4 — Tell Supabase Your Domain
*Time: 5 minutes*

Supabase needs to know your final domain for authentication to work correctly.

### Step 16 — Add your domain to Supabase Auth

1. Go back to your Supabase project
2. Click **Authentication** in the left sidebar
3. Click **URL Configuration** (under the Settings section)
4. Set **Site URL** to: `https://sentimetrx.ai`
5. Under **Redirect URLs**, click **Add URL** and add:
   - `https://sentimetrx.ai/**`
   - `https://www.sentimetrx.ai/**`
6. Click **Save**

---

## PART 5 — Test Everything
*Time: 10 minutes*

### Step 17 — Test the survey

1. Open a new browser tab
2. Go to: `https://sentimetrx.ai/s/test-charity-001`
3. You should see the Charity bot survey
4. Complete the full survey (takes 2–3 minutes)
5. After submitting, go to Supabase → **Table Editor** → click the `responses` table
6. You should see your response appear as a new row — **this confirms data is flowing end-to-end**

### Step 18 — Test the dashboard login

1. Go to: `https://sentimetrx.ai/dashboard`
2. You'll be redirected to the login page
3. Enter the email and password you created in Step 7
4. You should land on the dashboard showing the test study

### Step 19 — Test the survey link from the dashboard

1. On the dashboard, find the `test-charity-001` study
2. Click **Open survey →**
3. Confirm the survey opens correctly

---

## ✅ Phase 1 Complete

You now have a fully working production system:

| What works | How to access |
|-----------|--------------|
| Live survey | `sentimetrx.ai/s/[any-study-guid]` |
| All responses saved | Supabase → Table Editor → responses |
| Dashboard login | `sentimetrx.ai/dashboard` |
| Secure database | All data in Supabase, access-controlled |

---

## Creating New Studies (Before Phase 2 UI)

Until Phase 2 is built, you create new studies directly in Supabase:

1. Go to Supabase → **Table Editor** → click `studies`
2. Click **Insert row**
3. Fill in:
   - `guid`: a unique ID like `client-name-study-001` (this becomes part of the survey URL)
   - `client_id`: copy from the `clients` table
   - `name`: the study name
   - `bot_name`: the bot's name
   - `bot_emoji`: a single emoji
   - `status`: `active`
   - `config`: paste a JSON config (use the template from `sql/002_seed.sql` as a starting point)
4. The survey is immediately live at `sentimetrx.ai/s/[your-guid]`

---

## Viewing Responses

1. Go to Supabase → **Table Editor** → click `responses`
2. You can filter by:
   - `study_guid` — to see responses for a specific study
   - `sentiment` — `promoter`, `passive`, or `detractor`
   - `experience_score` — 1 to 5
3. Click any row to see the full `payload` JSON with all open-ended answers

---

## Troubleshooting

**Survey shows "Study not found"**
→ Check that the study's `status` column is set to `active` in Supabase

**Login doesn't work**
→ Make sure you've completed Step 16 (Supabase URL Configuration)
→ Double-check your email and password in Supabase Auth → Users

**Build fails in Vercel**
→ Check that all four environment variables were added correctly in Step 12
→ Make sure there are no spaces at the beginning or end of the values

**Domain not resolving**
→ DNS changes can take up to 48 hours — check back later
→ Verify the DNS records in your registrar exactly match what Vercel showed you

**Responses not saving**
→ Check that `SUPABASE_SERVICE_ROLE_KEY` is set correctly in Vercel
→ In Vercel → your project → Functions tab, check for any error logs

---

## What's Coming in Phase 2

Phase 2 will add the full point-and-click study creator so you can:
- Create new studies without touching Supabase
- Choose bot name, emoji, colors, and prompts through a visual form
- Get a survey link and QR code automatically generated
- View and filter all responses through the dashboard
- Export responses to CSV

No code changes will be needed on your end — Phase 2 deploys as an update to the same Vercel project.
