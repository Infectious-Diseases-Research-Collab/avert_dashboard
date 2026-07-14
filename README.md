# AVERT R21 Dashboard

A monitoring dashboard for the **AVERT study** — a test-negative design study
of the R21 malaria vaccine's real-world effectiveness, running across study
sites in **Uganda** and **Burkina Faso**. It gives study staff a live view of
enrollment, demographics, vaccination coverage, and data quality, without
needing to run analysis scripts by hand.

Built with Next.js (App Router, TypeScript) and Supabase (Postgres, Auth,
Row-Level Security), deployed on Vercel.

## What it does

- **Enrollment overview** — screened/enrolled/case/control counts, weekly
  enrollment trends, enrollment by facility, and age distribution, for either
  country or both combined.
- **Case-control matching** — greedy 1:1 matching statistics (by facility,
  village, enrollment date, and age) used to sanity-check the study's
  test-negative design as data comes in.
- **Vaccine coverage** — doses received, vaccination coverage over time,
  age at vaccination, and time-between-doses distributions.
- **Microscopy** — RDT vs. microscopy concordance (sensitivity, specificity,
  PPV/NPV) once blood-smear reading results are available; shows a clean
  empty state before then rather than erroring.
- **Vaccine-coverage verification visits** — tracks participants who need a
  follow-up visit to verify their vaccine card against those who've completed
  one, per facility, with a downloadable list for field teams to act on.
- **Data quality** — an automatically refreshed, filterable list of data
  issues (missing fields, barcode mismatches, possible duplicate
  participants, and more), each tracked from when it's first detected to when
  it's resolved.
- **Data export** — download enrollment or vaccination-status data as CSV,
  scoped to whatever country access the signed-in user has.

## Access control

The dashboard is private to study staff. Sign-in is gated by a predefined
allowlist of email addresses, each associated with **Uganda**, **Burkina
Faso**, or **both** — a user only ever sees data for the country(ies) they're
assigned to, enforced at the database level (Row-Level Security), not just in
the UI.

## Languages

The interface is available in **English** and **French**, with a sensible
default per user (French for Burkina Faso staff, English for Uganda/both) and
a language switcher that works regardless of that default.

## Project structure

```
src/app/              Next.js routes: login, dashboard, CSV export endpoints
src/components/       Dashboard sections, charts, tables, auth UI
src/lib/              Supabase clients, metrics/statistics, i18n config
supabase/             Database schema, Row-Level Security, data-quality checks, seed data
messages/             English/French UI strings
```

## Development

```bash
npm install
npm run dev
```

Requires a `.env.local` with Supabase project credentials — see
`.env.local.example`.

---

Deployment, database setup, the data-loading pipeline, and user-management
instructions are kept in a separate, non-public operations doc (not part of
this repo).
