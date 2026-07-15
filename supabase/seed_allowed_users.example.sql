-- =====================================================================
-- Seed: allowlist of users permitted to sign up / sign in.
--
-- country_access: 'UG' | 'BF' | 'BOTH'
-- default_locale: 'fr' for BF, 'en' for UG/BOTH (users can switch anytime)
-- is_admin:       true grants read of the allowlist table
--
-- Copy this file to seed_allowed_users.sql (gitignored — keeps real staff
-- emails out of the public repo), fill in your real users, then run it in
-- the Supabase SQL editor. Re-runnable (upsert).
-- =====================================================================

insert into public.allowed_users (email, country_access, is_admin, default_locale, full_name) values
  ('admin@example.org',       'BOTH', true,  'en', 'Admin Name'),
  ('uganda.user@example.org', 'UG',   false, 'en', 'Uganda Coordinator'),
  ('burkina.user@example.org','BF',   false, 'fr', 'Coordinateur Burkina')
on conflict (email) do update
  set country_access = excluded.country_access,
      is_admin       = excluded.is_admin,
      default_locale = excluded.default_locale,
      full_name      = excluded.full_name;
