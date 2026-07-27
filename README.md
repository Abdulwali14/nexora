# Nexora — deploy runbook

A microtask earning platform. Frontend: Vite + React. Backend: Supabase
(Postgres + Auth). Hosting: Vercel. All free tiers to start.

**How the security works (the important part):** money only ever moves through
one database function, `submit_answer()`. Browsers can read your own balance but
can never write it. The task answer key lives in a column that's never sent to
the browser. The kill switch and per-user pauses require an `operator` role that
is checked by the database itself — so even if someone edits the page in their
browser, they can't unlock the console or inflate a balance.

---

## What you need (make these free accounts first)
- **Node.js 18+** installed on your computer
- A **GitHub** account
- A **Supabase** account → https://supabase.com
- A **Vercel** account → https://vercel.com

---

## Step 1 — Get it running locally
```bash
npm install
cp .env.example .env      # you'll fill .env in Step 3
```

## Step 2 — Create the database
1. Supabase → **New project** (pick a name + strong DB password, any region).
2. Wait ~2 min for it to provision.
3. Left sidebar → **SQL Editor** → **New query**.
4. Open `supabase/schema.sql` from this project, paste the whole thing, click **Run**.
   You should see "Success". This creates every table, the security rules, the
   seed tasks, and the `submit_answer()` function.

## Step 3 — Connect the app to it
1. Supabase → **Project Settings → API**. Copy the **Project URL** and the
   **anon public** key.
2. Paste them into your `.env`:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
3. Supabase → **Authentication → URL Configuration**: set **Site URL** to
   `http://localhost:5173` for now, and add it under **Redirect URLs** too.
4. Run it:
   ```bash
   npm run dev
   ```
   Open http://localhost:5173, enter your email, and check your inbox for the
   magic link. Tap it — you're in.

## Step 4 — Make yourself the operator
After you've logged in once, Supabase → **SQL Editor**, run (use your email):
```sql
update public.profiles set role = 'operator' where email = 'you@example.com';
```
Refresh the app — the **Operator** tab now appears. Nobody else can see or use it.

## Step 5 — Put the code on GitHub
```bash
git init
git add .
git commit -m "Nexora"
```
Create an empty repo on GitHub, then:
```bash
git remote add origin https://github.com/YOU/nexora.git
git push -u origin main
```

## Step 6 — Go live on Vercel
1. Vercel → **Add New → Project** → import your GitHub repo.
2. Framework preset: **Vite** (auto-detected). 
3. **Environment Variables** → add the same two from your `.env`
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
4. **Deploy.** You get a live URL like `https://nexora.vercel.app`.
5. Back in Supabase → **Authentication → URL Configuration**: set **Site URL**
   to your Vercel URL and add it to **Redirect URLs** (so magic links work in
   production). Redeploy is not needed.

That's a live site people can sign up for and use. 🎉

---

## Later / optional
- **Real ID verification:** replace the demo KYC modal with **Stripe Identity**
  or **Persona**. Their webhook calls the `mark_verified()` function when a real
  check passes. Until then, `mark_verified()` runs on the demo button.
- **Real payouts:** wire **Stripe Connect** or **Wise** to the "Withdraw" button.
  This is also where US tax handling (W-9 / 1099) belongs — handled by the
  processor, never as a signup field.
- **AI feedback text:** deploy `supabase/functions/grade-task` and set the
  `ANTHROPIC_API_KEY` secret. Grading/awarding stays server-side either way.
- **Add tasks:** insert rows into `task_templates` (or build an operator form).
  `reference` kinds: `{"kind":"equals","value":"..."}`,
  `{"kind":"band","lo":1,"hi":2}`, `{"kind":"tags","tags":[...]}`.
