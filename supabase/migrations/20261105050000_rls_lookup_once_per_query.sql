-- Look up the signed-in user's country access once per query, not once per row.
-- Calling auth_can_see(country) directly re-ran that lookup for every row, up
-- to twice, which took about 800-1500 ms per 1,000 enrollee rows and could hit
-- the 8 s statement timeout. Wrapping it in (select ...) makes Postgres evaluate
-- it once; a page took about 10 ms in testing. The access rule itself is the
-- same as auth_can_see(): BOTH sees everything, otherwise only your own country.

alter policy audittrail_select on public.audittrail
  using ((select public.auth_country_access()) = 'BOTH' or (select public.auth_country_access()) = country);

alter policy blood_smear_select on public.blood_smear
  using ((select public.auth_country_access()) = 'BOTH' or (select public.auth_country_access()) = country);

alter policy dq_select on public.data_quality_issues
  using ((select public.auth_country_access()) = 'BOTH' or (select public.auth_country_access()) = country);

alter policy dq_audit_select on public.data_quality_status_audit
  using ((select public.auth_country_access()) = 'BOTH' or (select public.auth_country_access()) = country);

alter policy deployed_barcodes_select on public.deployed_barcodes
  using ((select public.auth_country_access()) = 'BOTH' or (select public.auth_country_access()) = country);

alter policy duplicate_records_select on public.duplicate_records
  using ((select public.auth_country_access()) = 'BOTH' or (select public.auth_country_access()) = country);

alter policy enrollee_select on public.enrollee
  using ((select public.auth_country_access()) = 'BOTH' or (select public.auth_country_access()) = country);

alter policy facilities_select on public.facilities
  using ((select public.auth_country_access()) = 'BOTH' or (select public.auth_country_access()) = country);

alter policy vaccination_status_select on public.vaccination_status
  using ((select public.auth_country_access()) = 'BOTH' or (select public.auth_country_access()) = country);

alter policy verification_audit_select on public.verification_status_audit
  using ((select public.auth_country_access()) = 'BOTH' or (select public.auth_country_access()) = country);

alter policy verification_waivers_select on public.verification_waivers
  using ((select public.auth_country_access()) = 'BOTH' or (select public.auth_country_access()) = country);
