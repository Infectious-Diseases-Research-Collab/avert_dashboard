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
  primary key (country, mrc)
);

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
  status         text not null default 'open' check (status in ('open','resolved')),
  detected_at    timestamptz not null default now(),
  resolved_at    timestamptz
);
-- Stable identity so re-running the check pass reopens/resolves rather than duplicates.
create unique index if not exists dq_identity_idx on public.data_quality_issues (
  check_code, coalesce(subjid,''), coalesce(barcode,''), coalesce(field,'')
);
create index if not exists dq_status_idx on public.data_quality_issues (status);
create index if not exists dq_country_idx on public.data_quality_issues (country);

-- =====================================================================
-- Auth helpers
-- =====================================================================

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
-- Table-level grants. RLS filters rows, but the role still needs SELECT.
-- (Supabase grants these to authenticated by default; explicit here so the
-- schema is self-contained.)
-- ---------------------------------------------------------------------
grant usage on schema public to authenticated, anon;
grant select on
  public.allowed_users, public.facilities, public.enrollee,
  public.vaccination_status, public.audittrail, public.blood_smear,
  public.data_quality_issues, public.villages
to authenticated;
