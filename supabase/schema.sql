-- =====================================================================
-- AVERT R21 Dashboard — Supabase schema, RLS, auth allowlist, helpers
-- Apply in the Supabase SQL editor (or `supabase db push`).
-- Idempotent-ish: safe to re-run (uses IF NOT EXISTS / CREATE OR REPLACE).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Reference / access-control tables
-- ---------------------------------------------------------------------

-- Predefined allowlist. Only emails present here may sign up / sign in.
create table if not exists public.allowed_users (
  email          text primary key,
  country_access text not null check (country_access in ('UG','BF','BOTH')),
  is_admin       boolean not null default false,
  default_locale text not null default 'en' check (default_locale in ('en','fr')),
  full_name      text,
  created_at     timestamptz not null default now()
);

-- Study health facilities (sites), keyed by country + mrc site code.
create table if not exists public.facilities (
  country           text not null check (country in ('UG','BF')),
  mrc               text not null,
  name              text not null,
  district          text,
  region            text,          -- BF only
  transmission_zone text,          -- BF only
  latitude          double precision,
  longitude         double precision,
  primary key (country, mrc)
);

-- Idempotent migration for existing databases (`create table if not exists`
-- above is a no-op once the table exists). Coordinates live here rather than
-- in their own table: they're a 1:1 attribute of a facility, and this table is
-- already fetched wholesale and RLS-scoped by country. Null until seeded, and
-- the map simply omits sites without coordinates.
alter table public.facilities
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

-- ---------------------------------------------------------------------
-- Data tables (one row per source record; typed cols + full raw jsonb)
-- ---------------------------------------------------------------------

create table if not exists public.enrollee (
  uniqueid              text primary key,
  country               text not null check (country in ('UG','BF')),
  subjid                text,
  barcode               text,
  mrc                   text,
  district              text,
  subcounty             text,
  parish                text,
  village               text,
  startdate             date,
  enrollment_week       date,
  dob                   date,
  agemonths_calculated  integer,
  age_eligible          integer,
  mal_test_eligible     integer,
  consent_eligible      integer,
  gender                integer,      -- raw survey code (1=male, 2=female)
  sex                   integer,      -- recoded (1=male, 0=female, null otherwise)
  diagnostic            integer,
  result                integer,      -- RDT result 0/1
  vx_card               integer,
  need_vac_cov          integer,
  vx_any                integer,
  vx_doses_received     integer,
  vx_dose1_date         date,
  vx_dose2_date         date,
  vx_dose3_date         date,
  vx_dose4_date         date,
  lastmod               timestamptz,
  raw                   jsonb not null default '{}'::jsonb,
  updated_at            timestamptz not null default now()
);
create index if not exists enrollee_country_idx on public.enrollee (country);
create index if not exists enrollee_barcode_idx on public.enrollee (barcode);
create index if not exists enrollee_mrc_idx on public.enrollee (country, mrc);

create table if not exists public.vaccination_status (
  barcode            text primary key,   -- links to enrollee.barcode
  country            text not null check (country in ('UG','BF')),
  startdate          date,
  vx_card            integer,
  vx_doses_received  integer,
  vx_dose1_date      date,
  vx_dose2_date      date,
  vx_dose3_date      date,
  vx_dose4_date      date,
  vx_doses_miss      integer,
  vx_dose_off_sched  integer,
  lastmod            timestamptz,
  raw                jsonb not null default '{}'::jsonb,
  updated_at         timestamptz not null default now()
);
create index if not exists vaccination_status_country_idx on public.vaccination_status (country);

create table if not exists public.audittrail (
  id                bigint generated always as identity primary key,
  country           text not null check (country in ('UG','BF')),
  "table"           text,
  uniqueid          text,
  subjid            text,
  barcode           text,
  fieldname         text,
  old_value         text,
  new_value         text,
  old_startdate     text,
  new_startdate     text,
  old_lastmod       text,
  new_lastmod       text,
  old_sourcefile    text,
  new_sourcefile    text,
  audit_recorded_at text
);
-- Composite identity for idempotent upsert of audit rows.
create unique index if not exists audittrail_identity_idx
  on public.audittrail (uniqueid, fieldname, new_lastmod);
create index if not exists audittrail_country_idx on public.audittrail (country);

-- Blood-smear (microscopy) reading data. Loaded from blood_smear.csv when
-- available; the dashboard's microscopy section stays empty until then.
create table if not exists public.blood_smear (
  barcode         text primary key,
  country         text not null check (country in ('UG','BF')),
  parasitedensity numeric,
  slidequality    integer,
  gametocytes     integer,
  readingcomments text,
  mic_positive    integer,   -- 1 if parasitedensity > 0 else 0
  raw             jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);
create index if not exists blood_smear_country_idx on public.blood_smear (country);

-- =====================================================================
-- Auth helpers
-- =====================================================================
-- Moved here, right after allowed_users (the one table these depend on),
-- because data_quality_status_audit's RLS policy below calls auth_can_see()
-- — a forward reference to a function that didn't exist yet on a fresh
-- database. A live Supabase project never hit this (auth_can_see already
-- existed from an earlier deploy), but loading this file top-to-bottom into
-- an empty database failed here until schema.sql was run a second time.

-- Email of the currently authenticated user (from the JWT).
create or replace function public.auth_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- Country scope of the current user: 'UG' | 'BF' | 'BOTH' | '' (none).
create or replace function public.auth_country_access()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select country_access from public.allowed_users where lower(email) = public.auth_email()),
    ''
  );
$$;

create or replace function public.auth_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.allowed_users where lower(email) = public.auth_email()),
    false
  );
$$;

-- True if the current user may see rows for the given country.
create or replace function public.auth_can_see(row_country text)
returns boolean
language sql
stable
as $$
  select public.auth_country_access() = 'BOTH'
      or public.auth_country_access() = row_country;
$$;

-- Look up an email's default UI language, callable by anyone (including
-- signed-out visitors on the login page) so the sign-up confirmation message
-- can render in the right language before the account is even confirmed.
-- Deliberately narrow: returns only default_locale, never country_access,
-- is_admin, or full_name. It does confirm/deny whether an email is on the
-- allowlist (returns null vs. a locale) — an acceptable trade-off for this
-- small, private study allowlist; do not widen this function's return shape.
create or replace function public.lookup_default_locale(p_email text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select default_locale from public.allowed_users where lower(email) = lower(p_email);
$$;

grant execute on function public.lookup_default_locale(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Data-quality issue log
-- ---------------------------------------------------------------------

create table if not exists public.data_quality_issues (
  id             bigint generated always as identity primary key,
  country        text not null check (country in ('UG','BF')),
  check_code     text not null,
  severity       text not null default 'warning' check (severity in ('error','warning','info')),
  subjid         text,
  barcode        text,
  mrc            text,
  field          text,
  description    text not null,
  description_fr text not null,
  -- 'open'/'resolved' are machine-driven by refresh_quality_issues(); 'dismissed'
  -- is a manual "reviewed, not a real problem" state set via set_issue_status()
  -- and preserved across refreshes (the refresh never overwrites a dismissed row).
  status         text not null default 'open' check (status in ('open','resolved','dismissed')),
  detected_at    timestamptz not null default now(),
  resolved_at    timestamptz,
  dismissed_at   timestamptz,
  dismissed_by   text,
  -- The specific other barcode a possible_duplicate_name match is against.
  -- Null for every other check. Without this, a participant who closely
  -- matches two or more others at the same facility produces two rows with
  -- an otherwise-identical identity, and refresh_quality_issues()'s
  -- ON CONFLICT upsert fails with "cannot affect row a second time".
  related_barcode text,
  -- The enrollee's uniqueid, which is what an issue's identity is keyed on.
  -- subjid above is a display value only: subject IDs get reissued by a
  -- device that lost its database and then corrected on the way in, so an
  -- issue keyed on subjid would lose its history the moment the value it was
  -- filed under changed. uniqueid never changes.
  uniqueid text
);
-- Stable identity so re-running the check pass reopens/resolves rather than duplicates.
create unique index if not exists dq_identity_idx on public.data_quality_issues (
  check_code, coalesce(uniqueid,''), coalesce(barcode,''), coalesce(field,''), coalesce(related_barcode,'')
);
create index if not exists dq_status_idx on public.data_quality_issues (status);
create index if not exists dq_country_idx on public.data_quality_issues (country);

-- Idempotent migration for existing databases: `create table if not exists`
-- above is a no-op once the table exists, so evolve the shape explicitly.
alter table public.data_quality_issues
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_by text;
alter table public.data_quality_issues
  drop constraint if exists data_quality_issues_status_check;
alter table public.data_quality_issues
  add constraint data_quality_issues_status_check check (status in ('open','resolved','dismissed'));

alter table public.data_quality_issues
  add column if not exists related_barcode text;
alter table public.data_quality_issues
  add column if not exists uniqueid text;
-- `create index if not exists` above is a no-op if dq_identity_idx already
-- exists under an earlier definition (4-column, or 5-column keyed on subjid),
-- so restate it explicitly. Re-keying identity from subjid to uniqueid is
-- widening in practice, never narrowing, so it cannot fail on existing rows.
drop index if exists public.dq_identity_idx;
create unique index dq_identity_idx on public.data_quality_issues (
  check_code, coalesce(uniqueid,''), coalesce(barcode,''), coalesce(field,''), coalesce(related_barcode,'')
);

-- Full history of manual dismiss/reopen actions on data_quality_issues (who,
-- what, when). One row per action — unlike dismissed_at/dismissed_by on the
-- issue itself, which only reflect the current state, this is append-only so
-- earlier dismiss/reopen cycles on the same issue aren't lost. Written only
-- by set_issue_status(); denormalizes country/check_code/subjid/barcode at
-- the time of the action so the row (and any CSV export of it) is
-- self-contained even if the parent issue is later deleted or changes.
create table if not exists public.data_quality_status_audit (
  id         bigint generated always as identity primary key,
  issue_id   bigint not null references public.data_quality_issues(id) on delete cascade,
  country    text not null check (country in ('UG','BF')),
  check_code text not null,
  subjid     text,
  barcode    text,
  mrc        text,
  action     text not null check (action in ('dismissed','reopened')),
  actor      text not null,
  acted_at   timestamptz not null default now()
);
create index if not exists dq_audit_issue_idx on public.data_quality_status_audit (issue_id);
create index if not exists dq_audit_country_idx on public.data_quality_status_audit (country);

alter table public.data_quality_status_audit enable row level security;

drop policy if exists dq_audit_select on public.data_quality_status_audit;
create policy dq_audit_select on public.data_quality_status_audit
  for select to authenticated using (public.auth_can_see(country));

-- Return the signed-in caller's own allowlist profile, matched case-
-- insensitively (allowed_users.email may be stored with mixed case, e.g.
-- 'Isabel.Rodriguez@ucsf.edu'). No email argument — always the caller's own
-- row via auth_email(), so there's no way to look up anyone else's profile.
-- The app's previous profile lookup did a case-SENSITIVE match, which
-- silently failed for any signed-in, allowlisted user whose stored email
-- had different casing than what they typed at signup — sending them into
-- a login/dashboard redirect loop despite being a legitimate, authorized
-- user the whole time. Row-Level Security itself was never affected (it
-- already compared case-insensitively), so no data was ever exposed by
-- this bug — it only broke the sign-in UX for mixed-case emails.
create or replace function public.get_my_profile()
returns table (
  email          text,
  country_access text,
  is_admin       boolean,
  default_locale text,
  full_name      text
)
language sql
stable
security definer
set search_path = public
as $$
  select email, country_access, is_admin, default_locale, full_name
  from public.allowed_users
  where lower(email) = public.auth_email();
$$;

grant execute on function public.get_my_profile() to authenticated;

-- Set the status of a data-quality issue (dismiss a reviewed non-issue, or
-- reopen one). security definer because the issues table is otherwise
-- read-only to authenticated users (writes go through the service-role loader);
-- this narrow function is the only authenticated write path. It only touches a
-- row the caller is allowed to see (auth_can_see on the row's country) and only
-- allows the two manual states — it can never set 'resolved' (machine-only).
-- 'dismissed' survives pipeline refreshes (refresh_quality_issues skips it).
-- Every successful call also appends a row to data_quality_status_audit, so
-- there's a full who/what/when history, not just the issue's current state.
create or replace function public.set_issue_status(p_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country text;
  v_check_code text;
  v_subjid text;
  v_barcode text;
  v_mrc text;
begin
  if p_status not in ('open','dismissed') then
    raise exception 'Invalid status %, expected open or dismissed', p_status
      using errcode = 'check_violation';
  end if;

  update public.data_quality_issues d
  set status       = p_status,
      dismissed_at = case when p_status = 'dismissed' then now() else null end,
      dismissed_by = case when p_status = 'dismissed' then public.auth_email() else null end
  where d.id = p_id
    and public.auth_can_see(d.country)
  returning d.country, d.check_code, d.subjid, d.barcode, d.mrc
  into v_country, v_check_code, v_subjid, v_barcode, v_mrc;

  -- Only log when the update actually matched a (visible) row — an unknown id
  -- or a row outside the caller's country access is a silent no-op, same as
  -- before, and shouldn't produce an audit entry.
  if found then
    insert into public.data_quality_status_audit
      (issue_id, country, check_code, subjid, barcode, mrc, action, actor)
    values
      (p_id, v_country, v_check_code, v_subjid, v_barcode, v_mrc,
       case when p_status = 'dismissed' then 'dismissed' else 'reopened' end,
       public.auth_email());
  end if;
end;
$$;

grant execute on function public.set_issue_status(bigint, text) to authenticated;

-- =====================================================================
-- Dashboard access log
-- =====================================================================

-- Who opened the dashboard and which tab they viewed, for study-team usage
-- visibility. 'page_view' fires once per dashboard load; 'section_view' fires
-- on each tab switch (filter/date changes are not logged). Admin-only select —
-- this is staff usage data, not participant data, so it doesn't follow the
-- country-scoped auth_can_see() pattern used elsewhere. No UI reads this
-- table; query it directly in the Supabase SQL editor.
create table if not exists public.access_log (
  id          bigint generated always as identity primary key,
  actor       text not null,
  event       text not null check (event in ('page_view','section_view')),
  section     text,
  occurred_at timestamptz not null default now()
);
create index if not exists access_log_actor_idx on public.access_log (actor);
create index if not exists access_log_occurred_idx on public.access_log (occurred_at desc);

alter table public.access_log enable row level security;

drop policy if exists access_log_select on public.access_log;
create policy access_log_select on public.access_log
  for select to authenticated using (public.auth_is_admin());

-- Sole write path, same shape as set_issue_status: security definer so the
-- actor always comes from the caller's own JWT, never a client-supplied value.
create or replace function public.log_access_event(p_event text, p_section text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event not in ('page_view','section_view') then
    raise exception 'Invalid event %, expected page_view or section_view', p_event
      using errcode = 'check_violation';
  end if;
  insert into public.access_log (actor, event, section)
  values (public.auth_email(), p_event, p_section);
end;
$$;

grant execute on function public.log_access_event(text, text) to authenticated;

-- =====================================================================
-- Vaccine-coverage verification waivers
--
-- The survey app triggers a verification visit whenever the reason a
-- participant had no vaccine card is "Other" (vx_card_no = 96). Whether one is
-- genuinely needed depends on what the free text actually says, which is a
-- clinical judgement the app can't make -- so clinic staff turn it off here.
-- Only "Other" can be turned off: every other reason ("left at home" and the
-- rest) describes a card that exists and really does need verifying.
-- =====================================================================

-- Current state, one row per participant a decision has been made about.
-- Absent = still required, which is why need_vac_cov alone is enough to build
-- the list and this table only ever subtracts from it.
create table if not exists public.verification_waivers (
  uniqueid  text primary key references public.enrollee(uniqueid) on delete cascade,
  country   text not null check (country in ('UG','BF')),
  required  boolean not null default true,
  set_by    text not null,
  set_at    timestamptz not null default now()
);
create index if not exists verification_waivers_country_idx
  on public.verification_waivers (country);

alter table public.verification_waivers enable row level security;

drop policy if exists verification_waivers_select on public.verification_waivers;
create policy verification_waivers_select on public.verification_waivers
  for select to authenticated using (public.auth_can_see(country));

-- Append-only history of those decisions, mirroring data_quality_status_audit:
-- the state table above only shows where a participant landed, this shows every
-- turn-off/turn-back-on and who did it. subjid/barcode/mrc are denormalised at
-- action time so a row (and any CSV of it) stands alone even if the enrollee
-- record later changes.
create table if not exists public.verification_status_audit (
  id       bigint generated always as identity primary key,
  uniqueid text not null,
  country  text not null check (country in ('UG','BF')),
  subjid   text,
  barcode  text,
  mrc      text,
  action   text not null check (action in ('waived','reinstated')),
  actor    text not null,
  acted_at timestamptz not null default now()
);
create index if not exists verification_audit_uniqueid_idx
  on public.verification_status_audit (uniqueid);
create index if not exists verification_audit_country_idx
  on public.verification_status_audit (country);

alter table public.verification_status_audit enable row level security;

drop policy if exists verification_audit_select on public.verification_status_audit;
create policy verification_audit_select on public.verification_status_audit
  for select to authenticated using (public.auth_can_see(country));

-- Turn a vaccine-coverage visit off (p_required = false) or back on.
-- security definer for the same reason as set_issue_status: the tables are
-- otherwise read-only to authenticated users, and this is the one narrow write
-- path. It only touches a participant the caller is allowed to see, and it
-- rejects anything that isn't an "Other" case -- the dashboard hides the button
-- for other reasons, but that is cosmetic and this is the actual guarantee.
create or replace function public.set_verification_required(
  p_uniqueid text, p_required boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country text;
  v_subjid text;
  v_barcode text;
  v_mrc text;
  v_reason text;
begin
  select e.country, e.subjid, e.barcode, e.mrc, e.raw->>'vx_card_no'
    into v_country, v_subjid, v_barcode, v_mrc, v_reason
  from public.enrollee e
  where e.uniqueid = p_uniqueid
    and public.auth_can_see(e.country);

  -- An unknown id, or one outside the caller's country access, is a silent
  -- no-op -- same contract as set_issue_status, which deliberately doesn't
  -- reveal whether a row it won't show you exists.
  if not found then
    return;
  end if;

  if v_reason is distinct from '96' then
    raise exception
      'Verification can only be turned off for an "Other" reason (vx_card_no = 96); % has %',
      p_uniqueid, coalesce(v_reason, 'no reason recorded')
      using errcode = 'check_violation';
  end if;

  insert into public.verification_waivers (uniqueid, country, required, set_by, set_at)
  values (p_uniqueid, v_country, p_required, public.auth_email(), now())
  on conflict (uniqueid) do update set
    required = excluded.required,
    set_by   = excluded.set_by,
    set_at   = excluded.set_at;

  insert into public.verification_status_audit
    (uniqueid, country, subjid, barcode, mrc, action, actor)
  values
    (p_uniqueid, v_country, v_subjid, v_barcode, v_mrc,
     case when p_required then 'reinstated' else 'waived' end,
     public.auth_email());
end;
$$;

grant execute on function public.set_verification_required(text, boolean) to authenticated;

-- =====================================================================
-- Signup allowlist gate
-- Reject creation of an auth user whose email is not in allowed_users.
-- =====================================================================

create or replace function public.enforce_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.allowed_users
    where lower(email) = lower(new.email)
  ) then
    raise exception 'Email % is not authorized to access this application.', new.email
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_allowlist_trigger on auth.users;
create trigger enforce_allowlist_trigger
  before insert on auth.users
  for each row execute function public.enforce_allowlist();

-- =====================================================================
-- Row-Level Security
-- =====================================================================

alter table public.allowed_users        enable row level security;
alter table public.facilities           enable row level security;
alter table public.enrollee             enable row level security;
alter table public.vaccination_status   enable row level security;
alter table public.audittrail           enable row level security;
alter table public.blood_smear          enable row level security;
alter table public.data_quality_issues  enable row level security;

-- allowed_users: a user can read their own row; admins read all.
drop policy if exists allowed_users_select on public.allowed_users;
create policy allowed_users_select on public.allowed_users
  for select to authenticated
  using (lower(email) = public.auth_email() or public.auth_is_admin());

-- facilities: any authenticated user may read facilities for countries they can see.
drop policy if exists facilities_select on public.facilities;
create policy facilities_select on public.facilities
  for select to authenticated
  using (public.auth_can_see(country));

-- Data tables: read-only, scoped by country access. Writes happen only via
-- the service-role loader (which bypasses RLS), so no insert/update policies.
drop policy if exists enrollee_select on public.enrollee;
create policy enrollee_select on public.enrollee
  for select to authenticated using (public.auth_can_see(country));

drop policy if exists vaccination_status_select on public.vaccination_status;
create policy vaccination_status_select on public.vaccination_status
  for select to authenticated using (public.auth_can_see(country));

drop policy if exists audittrail_select on public.audittrail;
create policy audittrail_select on public.audittrail
  for select to authenticated using (public.auth_can_see(country));

drop policy if exists blood_smear_select on public.blood_smear;
create policy blood_smear_select on public.blood_smear
  for select to authenticated using (public.auth_can_see(country));

drop policy if exists dq_select on public.data_quality_issues;
create policy dq_select on public.data_quality_issues
  for select to authenticated using (public.auth_can_see(country));

-- ---------------------------------------------------------------------
-- villages: reference lookup mapping the enrollee geo hierarchy
-- (countryid 1=UG/2=BF + district/subcounty/parish/village ids) to a village
-- name. Loaded separately (DataDictionary/villages.csv). Names are not
-- country-restricted participant data, so any authenticated user may read all
-- rows — a user only ever joins to their own country's enrollees anyway.
-- ---------------------------------------------------------------------
create table if not exists public.villages (
  countryid    bigint,
  country      text,
  districtid   bigint,
  district     text,
  subcountyid  bigint,
  subcounty    text,
  parishid     bigint,
  parish       text,
  villageid    bigint,
  village      text,
  mrcid        bigint,
  mrc          text
);

alter table public.villages enable row level security;

drop policy if exists villages_select on public.villages;
create policy villages_select on public.villages
  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- pipeline_runs: one row appended by the loader at the end of each successful
-- pipeline run, so the dashboard can show a "last data pull" freshness time.
-- (updated_at defaults only fire on INSERT and never advance on re-upsert, so
-- they can't serve as a run timestamp.) Not country-restricted — it's only a
-- clock — so any authenticated user may read all rows.
-- ---------------------------------------------------------------------
create table if not exists public.pipeline_runs (
  id          bigint generated always as identity primary key,
  finished_at timestamptz not null default now(),
  n_enrollee  integer,
  note        text
);

alter table public.pipeline_runs enable row level security;

drop policy if exists pipeline_runs_select on public.pipeline_runs;
create policy pipeline_runs_select on public.pipeline_runs
  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- deployed_barcodes: the pre-defined per-country list of barcodes issued to
-- the field. Populated separately (uploaded by the study team). Used by the
-- 'barcode_not_deployed' quality check to flag enrollee barcodes that aren't
-- on the allocated list. Read scoped by country access.
-- ---------------------------------------------------------------------
create table if not exists public.deployed_barcodes (
  barcode text primary key,
  country text not null check (country in ('UG','BF'))
);
create index if not exists deployed_barcodes_country_idx on public.deployed_barcodes (country);

alter table public.deployed_barcodes enable row level security;

drop policy if exists deployed_barcodes_select on public.deployed_barcodes;
create policy deployed_barcodes_select on public.deployed_barcodes
  for select to authenticated using (public.auth_can_see(country));

-- =====================================================================
-- Full (unblinded) dataset export — admin-only, time-limited link
-- =====================================================================
-- Deliberately does NOT use the service-role key (that key is local-loader
-- only — see Instructions.md — and must never enter the deployed app).
-- The export route instead runs as the requesting admin's own authenticated
-- session: RLS already scopes them to the countries they can see (same as
-- every other query in the app), and the two policies below grant that same
-- session just enough storage access to upload the generated CSVs and sign
-- a URL for them. An admin whose country_access isn't 'BOTH' therefore gets
-- an export scoped to what they could already see — not a limitation
-- specific to this feature, just RLS applying consistently.
--
-- Private bucket: never made public, so the only way to read an object is a
-- signed URL, which expires on its own. There is no plain SELECT policy for
-- authenticated/anon, so a bare API call against the bucket (without a
-- valid signed token) returns nothing for anyone, admin or not — the two
-- policies below grant signing/upload rights, not read rights.
insert into storage.buckets (id, name, public)
values ('exports', 'exports', false)
on conflict (id) do nothing;

drop policy if exists exports_admin_insert on storage.objects;
create policy exports_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'exports' and public.auth_is_admin());

-- Required to call createSignedUrl(): Supabase authorizes signing the same
-- way it authorizes a direct read, via this policy — it is not itself a
-- public read grant, since only a possessor of the resulting signed token
-- (not this policy) can fetch the object.
drop policy if exists exports_admin_select on storage.objects;
create policy exports_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'exports' and public.auth_is_admin());

-- Audit trail of every full-dataset export generated, independent of the
-- storage bucket's own signed-URL expiry — this is the durable "who
-- generated the unblinded dataset and when" record for the study team,
-- and outlives the files themselves (which a lifecycle rule may delete
-- after they expire).
create table if not exists public.full_dataset_exports (
  id            bigint generated always as identity primary key,
  requested_by  text not null,
  storage_paths jsonb not null,   -- {"enrollee": "...", "vaccination_status": "...", "blood_smear": "..."}
  row_counts    jsonb not null,   -- {"enrollee": 1169, "vaccination_status": 42, "blood_smear": 0}
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);
create index if not exists full_dataset_exports_created_idx on public.full_dataset_exports (created_at desc);

alter table public.full_dataset_exports enable row level security;

drop policy if exists full_dataset_exports_select on public.full_dataset_exports;
create policy full_dataset_exports_select on public.full_dataset_exports
  for select to authenticated using (public.auth_is_admin());

-- requested_by must match the caller's own JWT, same principle as
-- log_access_event's actor column — an admin can log an export as
-- themselves, never on another user's behalf.
drop policy if exists full_dataset_exports_insert on public.full_dataset_exports;
create policy full_dataset_exports_insert on public.full_dataset_exports
  for insert to authenticated
  with check (public.auth_is_admin() and requested_by = public.auth_email());

grant select, insert on public.full_dataset_exports to authenticated;

-- ---------------------------------------------------------------------
-- Table-level grants. RLS filters rows, but the role still needs SELECT.
-- (Supabase grants these to authenticated by default; explicit here so the
-- schema is self-contained.)
-- ---------------------------------------------------------------------
grant usage on schema public to authenticated, anon;
grant select on
  public.allowed_users, public.facilities, public.enrollee,
  public.vaccination_status, public.audittrail, public.blood_smear,
  public.data_quality_issues, public.villages,
  public.pipeline_runs, public.deployed_barcodes, public.data_quality_status_audit,
  public.access_log
to authenticated;
