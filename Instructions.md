# AVERT R21 Dashboard

- remove /supabase from gitignore after everything is set up

Bilingual (EN/FR), multi-country monitoring dashboard for the R21 test-negative
malaria-vaccine study (Uganda + Burkina Faso). Next.js (App Router, TypeScript) +
Supabase (Postgres, Auth, RLS), deployed on Vercel. Rebuild of the original
R-Shiny app with modern UI, access control, and new data-quality / vaccine-
verification features.

## Setup

### 1. Supabase

Create a Supabase project, then run the SQL files in `supabase/` **in order** in
the SQL editor:

1. `schema.sql` — tables, RLS policies, auth allowlist trigger, helper functions
2. `quality_checks.sql` — `refresh_quality_issues()` data-quality function
3. `seed_facilities.sql` — the 9 UG + 12 BF study facilities
4. `seed_allowed_users.sql` — **edit first** with your real users, then run

Auth: enable **Email** provider in Supabase Auth. Only emails present in
`allowed_users` can sign up (enforced by a trigger on `auth.users`).

### 2. App

```bash
cp .env.local.example .env.local   # fill in NEXT_PUBLIC_SUPABASE_URL + ANON_KEY
npm install
npm run dev
```

### 3. Deploy to Vercel

Requires the Vercel CLI (`npm i -g vercel`) and a Vercel account with access to
the team/project you want to deploy under.

**One-time setup, from the `avert_dashboard/` directory:**

```bash
vercel login                # opens a browser to authenticate
vercel link                 # creates .vercel/project.json — pick "Create new project"
                             # (or select an existing one) when prompted
```

`vercel link` asks for the project name, the team/scope, and confirms the
framework (Next.js is auto-detected — no `vercel.json` needed for this app).

**Add environment variables** — only the two public Supabase values ever go on
Vercel; the service-role key stays local to the loader script and must never be
added here:

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production

vercel env add NEXT_PUBLIC_SUPABASE_URL preview
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY preview

vercel env add NEXT_PUBLIC_SUPABASE_URL development
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY development
```

Each `add` prompts you to paste the value, then asks which environment(s) it
applies to (`environment` is a positional argument, not a flag — repeat once
per environment as above so preview/branch deployments also work). Use the
same values across all three unless you're pointing preview/dev at a separate
Supabase project. To pull them back down into `.env.local` on another machine:

```bash
vercel env pull .env.local
```

**Deploy:**

```bash
vercel                      # preview deployment — gets its own URL, safe to test
vercel --prod                # production deployment — promotes to your production domain
```

`vercel --prod` prints the deployment URL to stdout. Every `git push` also
triggers an automatic preview deployment if you connect the Vercel project to
your GitHub repo (Vercel dashboard → Project → Settings → Git) — pushes to
your default branch then deploy straight to production instead of preview.

**Custom domain** (optional):

```bash
vercel domains add dashboard.yourorg.org avert-dashboard   # project name from `vercel link`
```

Then point the domain's nameservers or a CNAME/A record at Vercel as
instructed by the command's output, and redeploy (`vercel --prod`) — the
domain is auto-assigned to the production deployment once DNS resolves.

**Verifying the deploy:**

- Visit the deployment URL — you should land on `/login` in the modern
  (non-Shiny) UI described above.
- Confirm `vercel env ls` shows exactly the two `NEXT_PUBLIC_*` variables per
  environment and nothing else (no service-role key).
- Check build logs in the Vercel dashboard (or `vercel logs <deployment-url>`)
  if the deploy fails — a missing/incorrect Supabase URL or anon key is the
  most common cause of a working local build failing at runtime on Vercel.

**Redeploying after code changes:** just re-run `vercel --prod` (or push to
your connected Git branch). Database schema/data changes go through Supabase
directly (SQL editor / the loader script) — Vercel only redeploys app code.

### 4. Getting new data onto the website

Data management happens entirely on your laptop, in a separate repo:
`/Users/glavoy/apps/idrc/avert_data`. Three scripts there run in sequence, each
producing the input the next one needs:

```
download_data.py  →  raw zip snapshots (data/burkina/*.zip, data/uganda/*.zip)
process_data.py   →  merged per-country CSVs (enrollee.csv, vaccination_status.csv, audittrail.csv)
upload_to_supabase.py → UPSERTs those CSVs into Supabase + refreshes data-quality issues
```

**One-time setup** (only needed once per laptop):

```bash
cd /Users/glavoy/apps/idrc/avert_data
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

`credentials.json` (SFTP host/login for Burkina, FTP host/login for Uganda) is
already in place in that folder — you don't need to recreate it, but treat it
as a secret: it's not meant to be committed or shared outside this machine.

**Every time you want fresh data on the website**, from that same folder
(activate the venv first if it's a new terminal session — `source venv/bin/activate`):

```bash
python download_data.py     # pulls any new zip snapshots from the BF/UG servers
python process_data.py      # merges zips into enrollee.csv / vaccination_status.csv / audittrail.csv
                             # (incremental — only processes zips it hasn't seen before)

export SUPABASE_URL=https://YOUR-REF.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   # from Supabase → Project Settings → API
python upload_to_supabase.py
```

Or run the first two as one step: `python run_pipeline.py`.

**What `upload_to_supabase.py` does:** UPSERTs `enrollee` (by `uniqueid`),
`vaccination_status` (by `barcode`), `audittrail`, and `blood_smear` (by
`barcode`) for both countries, then re-runs `refresh_quality_issues()` so the
Data Quality page reflects the new data immediately. It prints a per-country
row count when it finishes — that's your confirmation it worked. **Re-running
it is always safe**: same data in → same result out, nothing gets duplicated.
Missing or empty CSVs (e.g. `vaccination_status.csv` before any coverage
visits exist) are silently skipped, not an error.

**Where to find the two Supabase values:** in your Supabase project dashboard
→ **Project Settings → API** — `SUPABASE_URL` is the "Project URL", and the
service-role key is under "Project API keys" (**not** the `anon`/`public`
one — that's the one used by `.env.local`/Vercel; the service-role key is only
ever used here, from your laptop, never in the deployed app).

**Tip:** if you don't want to re-type/export the Supabase values every
session, add the two `export` lines to your shell profile (`~/.zshrc`) instead
of typing them each time — just don't commit them anywhere or share that file.

**Checking it landed:** open the Supabase dashboard → **Table Editor** →
`enrollee` (or `vaccination_status` / `data_quality_issues`) to see the rows
directly, or just reload the live dashboard — new data appears on next page
load (there's no caching layer to bust).

## Managing website users (the email allowlist)

Only emails present in the `allowed_users` Supabase table can create an
account or sign in — this is enforced by a database trigger (`schema.sql`), so
there's no way to bypass it from the app itself.

**Add a user** — easiest is the Supabase dashboard → **Table Editor** →
`allowed_users` → **Insert row**, with:

| column | value |
|---|---|
| `email` | their email, lowercase |
| `country_access` | `UG`, `BF`, or `BOTH` |
| `is_admin` | `true` only if they should also be able to read the `allowed_users` table itself (rarely needed) |
| `default_locale` | `en` or `fr` — their starting language; they can switch anytime in the app |
| `full_name` | optional, shown in the header |

Or via SQL (Supabase → **SQL Editor**), which is handier for adding several at
once — this is the same pattern as `supabase/seed_allowed_users.sql`:

```sql
insert into public.allowed_users (email, country_access, is_admin, default_locale, full_name) values
  ('newperson@example.org', 'UG', false, 'en', 'New Person')
on conflict (email) do update
  set country_access = excluded.country_access,
      is_admin       = excluded.is_admin,
      default_locale = excluded.default_locale,
      full_name      = excluded.full_name;
```

After adding a row, tell the person to go to the site and use **"Need an
account? Create one"** with that exact email — they choose their own password
at signup.

**Change someone's access** (e.g. move them from `UG` to `BOTH`, or fix their
default language): just update their row in `allowed_users` — no re-signup
needed. It takes effect on their very next page load.

**Remove a user:** delete their row from `allowed_users`. This immediately
blocks them two ways — the dashboard redirects them straight back to
`/login` (no profile found), and even if they had an active session, Row-Level
Security stops returning any data for a country-less user. If you also want to
kill an already-open browser session immediately rather than on next
navigation, go to Supabase → **Authentication → Users** and delete/ban their
auth account there too — usually not necessary, but available for a hard cutoff.

## Access model

- `allowed_users.country_access` ∈ `UG` | `BF` | `BOTH`. RLS restricts every data
  table to the user's country scope; `BOTH` sees everything.
- Default UI language: `fr` for BF users, `en` for UG/BOTH — switchable anytime.

## Notes

- Blood-smear (microscopy) data is optional; the Microscopy section shows an
  empty state and never errors when `blood_smear` is empty. When available it
  arrives as `blood_smear.csv` (per country) and is loaded by the same script.
- The follow-up vaccine-coverage visit is stored in the `vaccination_status`
  table, loaded from `vaccination_status.csv` and linked to `enrollee` by barcode.
- Data-quality checks (`supabase/quality_checks.sql`) are ported from the study's
  post-hoc QA script ("01a Survey data quality checks.R") and its SOP
  (AVERT-DataMgmt-002) — missing/inconsistent-data checks the Country Data
  Manager reviews after collection, not the survey app's own in-field
  LogicCheck validations (those block data entry at the point of collection and
  can never fail once data reaches Supabase, so they aren't re-checked here).
  Not yet ported: cross-checking against a barcode-allocation list (needs a new
  reference table/loader step) and the smear-specific QA script (not provided).
- The "vaccine-coverage verification" overdue count is its own dashboard
  section (not a generic data-quality issue), with per-facility breakdown and a
  downloadable CSV of the outstanding list for field follow-up.
