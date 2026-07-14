-- =====================================================================
-- Seed: allowlist of users permitted to sign up / sign in.
--
-- country_access: 'UG' | 'BF' | 'BOTH'
-- default_locale: 'fr' for BF, 'en' for UG/BOTH (users can switch anytime)
-- is_admin:       true grants read of the allowlist table
--
-- EDIT this list for your real users, then run it. Re-runnable (upsert).
-- =====================================================================

insert into public.allowed_users (email, country_access, is_admin, default_locale, full_name) values
  ('glavoy@proton.me',        'BOTH', true,  'en', 'Geoff Lavoy'),
  ('uganda.user@example.org', 'UG',   false, 'en', 'Uganda Coordinator'),
  ('burkina.user@example.org','BF',   false, 'fr', 'Coordinateur Burkina')
on conflict (email) do update
  set country_access = excluded.country_access,
      is_admin       = excluded.is_admin,
      default_locale = excluded.default_locale,
      full_name      = excluded.full_name;
