-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP EXTENSION pg_net;

CREATE EXTENSION pg_trgm WITH SCHEMA public;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE, INSERT, SELECT, UPDATE ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ROUTINES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE, INSERT, SELECT, UPDATE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ROUTINES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE, INSERT, SELECT, UPDATE ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ROUTINES TO service_role;

CREATE FUNCTION public.auth_can_see (
  row_country text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  AS $function$
  select public.auth_country_access() = 'BOTH'
      or public.auth_country_access() = row_country;
$function$;

GRANT ALL ON FUNCTION public.auth_can_see(text) TO anon;

GRANT ALL ON FUNCTION public.auth_can_see(text) TO authenticated;

GRANT ALL ON FUNCTION public.auth_can_see(text) TO service_role;

CREATE FUNCTION public.auth_country_access()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select coalesce(
    (select country_access from public.allowed_users where lower(email) = public.auth_email()),
    ''
  );
$function$;

GRANT ALL ON FUNCTION public.auth_country_access() TO anon;

GRANT ALL ON FUNCTION public.auth_country_access() TO authenticated;

GRANT ALL ON FUNCTION public.auth_country_access() TO service_role;

CREATE FUNCTION public.auth_email()
  RETURNS text
  LANGUAGE sql
  STABLE
  AS $function$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$function$;

GRANT ALL ON FUNCTION public.auth_email() TO anon;

GRANT ALL ON FUNCTION public.auth_email() TO authenticated;

GRANT ALL ON FUNCTION public.auth_email() TO service_role;

CREATE FUNCTION public.auth_is_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select coalesce(
    (select is_admin from public.allowed_users where lower(email) = public.auth_email()),
    false
  );
$function$;

GRANT ALL ON FUNCTION public.auth_is_admin() TO anon;

GRANT ALL ON FUNCTION public.auth_is_admin() TO authenticated;

GRANT ALL ON FUNCTION public.auth_is_admin() TO service_role;

CREATE FUNCTION public.enforce_allowlist()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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
$function$;

CREATE TRIGGER enforce_allowlist_trigger
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_allowlist();

GRANT ALL ON FUNCTION public.enforce_allowlist() TO anon;

GRANT ALL ON FUNCTION public.enforce_allowlist() TO authenticated;

GRANT ALL ON FUNCTION public.enforce_allowlist() TO service_role;

CREATE FUNCTION public.get_my_profile()
  RETURNS TABLE (
    email          text,
    country_access text,
    is_admin       boolean,
    default_locale text,
    full_name      text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select email, country_access, is_admin, default_locale, full_name
  from public.allowed_users
  where lower(email) = public.auth_email();
$function$;

GRANT ALL ON FUNCTION public.get_my_profile() TO anon;

GRANT ALL ON FUNCTION public.get_my_profile() TO authenticated;

GRANT ALL ON FUNCTION public.get_my_profile() TO service_role;

CREATE FUNCTION public.log_access_event (
  p_event   text,
  p_section text DEFAULT NULL::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if p_event not in ('page_view','section_view') then
    raise exception 'Invalid event %, expected page_view or section_view', p_event
      using errcode = 'check_violation';
  end if;
  insert into public.access_log (actor, event, section)
  values (public.auth_email(), p_event, p_section);
end;
$function$;

GRANT ALL ON FUNCTION public.log_access_event(text, text) TO anon;

GRANT ALL ON FUNCTION public.log_access_event(text, text) TO authenticated;

GRANT ALL ON FUNCTION public.log_access_event(text, text) TO service_role;

CREATE FUNCTION public.lookup_default_locale (
  p_email text
)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select default_locale from public.allowed_users where lower(email) = lower(p_email);
$function$;

GRANT ALL ON FUNCTION public.lookup_default_locale(text) TO anon;

GRANT ALL ON FUNCTION public.lookup_default_locale(text) TO authenticated;

GRANT ALL ON FUNCTION public.lookup_default_locale(text) TO service_role;

CREATE FUNCTION public.refresh_quality_issues()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  n_firing integer;
begin
  -- Guard against being called twice in a single transaction (the temp table
  -- would otherwise persist until commit).
  drop table if exists _firing;

  -- "enrolled" mirrors the R script's filter: age + malaria-test + consent
  -- eligible, and not excluded for another illness (ill_noteligible is 0 or
  -- unanswered). NOTE: this differs from the simpler "enrolled" used
  -- elsewhere in the dashboard (metrics.ts), which does not check
  -- ill_noteligible — flagged separately for a consistency decision.
  create temporary table _firing on commit drop as
  with enrolled as (
    select e.*
    from public.enrollee e
    where e.age_eligible = 1
      and e.mal_test_eligible = 1
      and e.consent_eligible = 1
      and (nullif(e.raw->>'ill_noteligible','')::int is null
           or (e.raw->>'ill_noteligible')::int = 0)
  )

  -- 1. Missing barcode
  select e.country, 'missing_barcode'::text as check_code, 'warning'::text as severity,
         e.uniqueid, e.subjid, e.barcode, e.mrc, 'barcode'::text as field, null::text as related_barcode,
         'Enrolled participant is missing a study barcode.'::text as description,
         'Le participant inclus n''a pas de code-barres d''étude.'::text as description_fr
  from enrolled e
  where e.barcode is null or e.barcode = ''

  union all
  -- 2. Missing core demographics
  select e.country, 'missing_demographics', 'warning',
         e.uniqueid, e.subjid, e.barcode, e.mrc, 'agemonths_calculated/gender/village', null,
         'Missing age, sex, or village for an enrolled participant.',
         'Âge, sexe ou village manquant pour un participant inclus.'
  from enrolled e
  where e.agemonths_calculated is null or e.gender is null
     or e.village is null or e.village = ''

  union all
  -- 3. Missing malaria diagnostic result
  select e.country, 'missing_diagnostic', 'warning',
         e.uniqueid, e.subjid, e.barcode, e.mrc, 'diagnostic', null,
         'Missing malaria diagnostic type for an enrolled participant.',
         'Type de diagnostic du paludisme manquant pour un participant inclus.'
  from enrolled e
  where nullif(e.raw->>'diagnostic','') is null

  union all
  -- 4. Missing vaccine-card status
  select e.country, 'missing_vx_card', 'warning',
         e.uniqueid, e.subjid, e.barcode, e.mrc, 'vx_card', null,
         'Missing vaccine-card status for an enrolled participant.',
         'Statut de la carte de vaccination manquant pour un participant inclus.'
  from enrolled e
  where nullif(e.raw->>'vx_card','') is null

  union all
  -- 5. Missing "received any doses" (yes/no). Skipped when
  -- vx_doses_received_rtss = 1 -- that means this section of the form was
  -- itself skipped by design, so a null vx_any here is expected, not missing.
  select e.country, 'missing_vx_any', 'warning',
         e.uniqueid, e.subjid, e.barcode, e.mrc, 'vx_any', null,
         'Missing "received any vaccine doses" (yes/no) for an enrolled participant.',
         'Réponse manquante à "a reçu des doses de vaccin" pour un participant inclus.'
  from enrolled e
  where e.vx_any is null
    and (nullif(e.raw->>'vx_doses_received_rtss','')::int is null
         or (e.raw->>'vx_doses_received_rtss')::int <> 1)

  union all
  -- 6. vx_any = yes but the number of doses received is missing
  select e.country, 'missing_vx_doses_received', 'warning',
         e.uniqueid, e.subjid, e.barcode, e.mrc, 'vx_doses_received', null,
         'Participant received doses but the number of doses is missing.',
         'Le participant a reçu des doses mais le nombre de doses est manquant.'
  from enrolled e
  where e.vx_any = 1 and nullif(e.raw->>'vx_doses_received','') is null

  union all
  -- 7-10. Missing dose-detail fields (where/date/verification) for each
  -- reported dose, gated by the number of doses actually received.
  select e.country, 'missing_dose_info', 'warning',
         e.uniqueid, e.subjid, e.barcode, e.mrc, d.field, null,
         format('Missing detail (date, location, or verification) for %s.', d.field),
         format('Détail manquant (date, lieu ou vérification) pour %s.', d.field)
  from enrolled e
  cross join lateral (values
    (1, 'vx_dose1_date', e.vx_dose1_date, e.raw->>'vx_dose1_date_ver', e.raw->>'vx_dose1_where'),
    (2, 'vx_dose2_date', e.vx_dose2_date, e.raw->>'vx_dose2_date_ver', e.raw->>'vx_dose2_where'),
    (3, 'vx_dose3_date', e.vx_dose3_date, e.raw->>'vx_dose3_date_ver', e.raw->>'vx_dose3_where'),
    (4, 'vx_dose4_date', e.vx_dose4_date, e.raw->>'vx_dose4_date_ver', e.raw->>'vx_dose4_where')
  ) as d(dose_num, field, dose_date, date_ver, dose_where)
  where coalesce(e.vx_doses_received, 0) >= d.dose_num
    and (d.dose_date is null or nullif(d.date_ver,'') is null or nullif(d.dose_where,'') is null)

  union all
  -- 11. Missing malaria risk-behavior fields. Skipped when
  -- vx_doses_received_rtss = 1 -- that means this section of the form was
  -- itself skipped by design, so nulls here are expected, not missing.
  select e.country, 'missing_malaria_risk', 'warning',
         e.uniqueid, e.subjid, e.barcode, e.mrc, 'timetobed/structuresprayed/bednetlastnight', null,
         'Missing malaria risk-behavior data (bedtime, spraying, or bednet use).',
         'Données sur les comportements à risque de paludisme manquantes (heure du coucher, pulvérisation ou moustiquaire).'
  from enrolled e
  where (nullif(e.raw->>'timetobed','') is null
     or nullif(e.raw->>'structuresprayed','') is null
     or nullif(e.raw->>'bednetlastnight','') is null)
    and (nullif(e.raw->>'vx_doses_received_rtss','')::int is null
         or (e.raw->>'vx_doses_received_rtss')::int <> 1)

  union all
  -- 12. Missing previous-diagnosis info. Skipped when
  -- vx_doses_received_rtss = 1 -- that means this section of the form was
  -- itself skipped by design, so nulls here are expected, not missing.
  select e.country, 'missing_prevdiag', 'warning',
         e.uniqueid, e.subjid, e.barcode, e.mrc, 'prevdiag', null,
         'Missing previous-diagnosis data (or missing date of a reported previous diagnosis).',
         'Données de diagnostic antérieur manquantes (ou date manquante pour un diagnostic antérieur signalé).'
  from enrolled e
  where (nullif(e.raw->>'prevdiag','') is null
     or ((e.raw->>'prevdiag')::int = 1 and nullif(e.raw->>'prevdiag_when','') is null))
    and (nullif(e.raw->>'vx_doses_received_rtss','')::int is null
         or (e.raw->>'vx_doses_received_rtss')::int <> 1)

  union all
  -- 13. Barcode doesn't match the expected per-country prefix
  select e.country, 'barcode_country_mismatch', 'error',
         e.uniqueid, e.subjid, e.barcode, e.mrc, 'barcode', null,
         format('Barcode %s does not match the expected prefix for %s.', e.barcode, e.country),
         format('Le code-barres %s ne correspond pas au préfixe attendu pour %s.', e.barcode, e.country)
  from enrolled e
  where e.barcode is not null and e.barcode <> ''
    and ((e.country = 'UG' and e.barcode not like 'R21U-%')
      or (e.country = 'BF' and e.barcode not like 'R21B-%'))

  union all
  -- 14. Barcode re-entry mismatch (barcode vs barcode2)
  select e.country, 'barcode_reentry_mismatch', 'error',
         e.uniqueid, e.subjid, e.barcode, e.mrc, 'barcode2', null,
         'Barcode and re-entered barcode (barcode2) do not match.',
         'Le code-barres et le code-barres ressaisi (barcode2) ne correspondent pas.'
  from enrolled e
  where nullif(e.barcode,'') is not null and nullif(e.raw->>'barcode2','') is not null
    and e.barcode <> (e.raw->>'barcode2')

  union all
  -- 15. Age outside the program's original catchment reference date
  -- (UG: age_at_apr2025, BF: age_at_sep2023, in months; threshold from
  -- the source QA script — flags records that may predate/postdate the
  -- protocol's original enrollment window).
  select e.country, 'age_ineligible_reference_date', 'error',
         e.uniqueid, e.subjid, e.barcode, e.mrc,
         case when e.country = 'UG' then 'age_at_apr2025' else 'age_at_sep2023' end, null,
         format('Age at program reference date (%s months) exceeds the eligibility threshold.',
                case when e.country = 'UG' then e.raw->>'age_at_apr2025' else e.raw->>'age_at_sep2023' end),
         format('L''âge à la date de référence du programme (%s mois) dépasse le seuil d''éligibilité.',
                case when e.country = 'UG' then e.raw->>'age_at_apr2025' else e.raw->>'age_at_sep2023' end)
  from enrolled e
  where (e.country = 'UG' and nullif(e.raw->>'age_at_apr2025','') is not null and (e.raw->>'age_at_apr2025')::numeric > 12)
     or (e.country = 'BF' and nullif(e.raw->>'age_at_sep2023','') is not null and (e.raw->>'age_at_sep2023')::numeric > 12)

  union all
  -- 16. Main consent not marked as provided
  select e.country, 'consent_not_provided', 'error',
         e.uniqueid, e.subjid, e.barcode, e.mrc, 'consent', null,
         'Main consent is not marked as provided for an enrolled participant.',
         'Le consentement principal n''est pas marqué comme fourni pour un participant inclus.'
  from enrolled e
  where nullif(e.raw->>'consent','') is not null and (e.raw->>'consent')::numeric <> 1

  union all
  -- 17. Sample/specimen consent not marked as provided
  select e.country, 'consent2_not_provided', 'error',
         e.uniqueid, e.subjid, e.barcode, e.mrc, 'consent2', null,
         'Sample/specimen consent is not marked as provided for an enrolled participant.',
         'Le consentement pour l''échantillon n''est pas marqué comme fourni pour un participant inclus.'
  from enrolled e
  where nullif(e.raw->>'consent2','') is not null and (e.raw->>'consent2')::numeric <> 1

  union all
  -- 18. Possible duplicate participant: SAME date of birth AND a near-identical
  -- name, within the same country + facility. Tightened from the earlier
  -- similarity>0.45 (too noisy): now requires an exact DOB match plus a name
  -- trigram distance (1 - pg_trgm similarity) <= 0.075, i.e. similarity >= 0.925
  -- (all but identical). a.barcode < b.barcode makes each pair fire once.
  -- related_barcode (b.barcode) carries the specific match so a participant
  -- matching two or more others produces one row per match instead of
  -- colliding on (check_code, uniqueid, barcode, field) alone.
  select a.country, 'possible_duplicate_name', 'warning',
         a.uniqueid, a.subjid, a.barcode, a.mrc, 'participantsname', b.barcode,
         format('Participant has the same date of birth and a near-identical name to barcode %s at the same facility (name distance %s).',
                b.barcode, round((1 - similarity(upper(a.raw->>'participantsname'), upper(b.raw->>'participantsname')))::numeric, 3)),
         format('Le participant a la même date de naissance et un nom quasi identique au code-barres %s dans la même formation sanitaire (distance du nom %s).',
                b.barcode, round((1 - similarity(upper(a.raw->>'participantsname'), upper(b.raw->>'participantsname')))::numeric, 3))
  from enrolled a
  join enrolled b
    on a.country = b.country and a.mrc = b.mrc and a.barcode < b.barcode
  where a.dob is not null and a.dob = b.dob
    and nullif(a.raw->>'participantsname','') is not null
    and nullif(b.raw->>'participantsname','') is not null
    and (1 - similarity(upper(a.raw->>'participantsname'), upper(b.raw->>'participantsname'))) <= 0.075

  union all
  -- 19. Enrollee barcode not on the deployed/allocated list for its country.
  -- Only evaluated for a country that actually has a deployed list loaded, so
  -- an empty or not-yet-populated deployed_barcodes table never floods issues.
  select e.country, 'barcode_not_deployed', 'error',
         e.uniqueid, e.subjid, e.barcode, e.mrc, 'barcode', null,
         format('Barcode %s is not on the deployed barcode list for %s.', e.barcode, e.country),
         format('Le code-barres %s ne figure pas sur la liste des codes-barres déployés pour %s.', e.barcode, e.country)
  from enrolled e
  where e.barcode is not null and e.barcode <> ''
    and exists (select 1 from public.deployed_barcodes d where d.country = e.country)
    and not exists (
      select 1 from public.deployed_barcodes d
      where d.country = e.country and d.barcode = e.barcode
    )

  union all
  -- 20. The same barcode on more than one record. Barcode is the key clinic
  -- and lab data are joined on, so a collision attaches one child's sample
  -- results to another child's record. Checked over every record rather than
  -- only enrolled ones: a screened-out record still consumed that barcode.
  -- Grouped, so a barcode used by three records raises one issue, not three.
  select e.country, 'duplicate_barcode', 'error',
         min(e.uniqueid), min(e.subjid), e.barcode, min(e.mrc), 'barcode', null,
         format('Barcode %s is recorded on %s different records (subject IDs %s).',
                e.barcode, count(*), string_agg(distinct e.subjid, ', ')),
         format('Le code-barres %s figure sur %s enregistrements differents (identifiants %s).',
                e.barcode, count(*), string_agg(distinct e.subjid, ', '))
  from public.enrollee e
  where nullif(e.barcode, '') is not null
  group by e.country, e.barcode
  having count(*) > 1

  union all
  -- 21. The same subject ID on more than one record. A warning, not an error:
  -- subject ID is not what clinic and lab data are joined on. It happens when
  -- a device loses its database -- uninstalling the app does this -- because
  -- the counter is derived from the device's own table and restarts, reissuing
  -- IDs already given out. It still needs correcting: anything analysed by
  -- subject ID would silently merge two children.
  --
  -- This is the check the loader relies on: upload_to_supabase.py uploads a
  -- still-colliding pair as collected rather than aborting the whole pipeline,
  -- because this raises it here. Resolve it by adding the pair to
  -- corrections/subjid_corrections.csv via make_corrections.py in avert_data.
  select e.country, 'duplicate_subjid', 'warning',
         min(e.uniqueid), e.subjid, min(e.barcode), min(e.mrc), 'subjid', null,
         format('Subject ID %s is used by %s different participants (barcodes %s).',
                e.subjid, count(*), string_agg(e.barcode, ', ' order by e.barcode)),
         format('L''identifiant %s est utilise par %s participants differents (codes-barres %s).',
                e.subjid, count(*), string_agg(e.barcode, ', ' order by e.barcode))
  from public.enrollee e
  where nullif(e.subjid, '') is not null
  group by e.country, e.subjid
  having count(*) > 1;

  select count(*) into n_firing from _firing;

  -- Upsert firing issues: insert new, re-open previously resolved.
  insert into public.data_quality_issues
    (country, check_code, severity, uniqueid, subjid, barcode, mrc, field, related_barcode, description, description_fr, status, detected_at, resolved_at)
  select country, check_code, severity, uniqueid, subjid, barcode, mrc, field, related_barcode, description, description_fr, 'open', now(), null
  from _firing
  on conflict (check_code, coalesce(uniqueid,''), coalesce(barcode,''), coalesce(field,''), coalesce(related_barcode,''))
  do update set
    country        = excluded.country,
    severity       = excluded.severity,
    subjid         = excluded.subjid,
    mrc            = excluded.mrc,
    description    = excluded.description,
    description_fr = excluded.description_fr,
    status         = 'open',
    detected_at    = case when data_quality_issues.status = 'resolved'
                          then now() else data_quality_issues.detected_at end,
    resolved_at    = null
  -- Never disturb a manually dismissed issue: a user reviewed it and marked it
  -- "not a problem", so even if it keeps firing it stays out of the open list.
  where data_quality_issues.status <> 'dismissed';

  -- Resolve open issues that no longer fire.
  update public.data_quality_issues d
  set status = 'resolved', resolved_at = now()
  where d.status = 'open'
    and not exists (
      select 1 from _firing f
      where f.check_code = d.check_code
        and coalesce(f.uniqueid,'')        = coalesce(d.uniqueid,'')
        and coalesce(f.barcode,'')         = coalesce(d.barcode,'')
        and coalesce(f.field,'')           = coalesce(d.field,'')
        and coalesce(f.related_barcode,'') = coalesce(d.related_barcode,'')
    );

  return n_firing;
end;
$function$;

GRANT ALL ON FUNCTION public.refresh_quality_issues() TO anon;

GRANT ALL ON FUNCTION public.refresh_quality_issues() TO authenticated;

GRANT ALL ON FUNCTION public.refresh_quality_issues() TO service_role;

CREATE FUNCTION public.rls_auto_enable()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog'
  AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

GRANT ALL ON FUNCTION public.rls_auto_enable() TO anon;

GRANT ALL ON FUNCTION public.rls_auto_enable() TO authenticated;

GRANT ALL ON FUNCTION public.rls_auto_enable() TO service_role;

CREATE FUNCTION public.set_issue_status (
  p_id     bigint,
  p_status text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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
$function$;

GRANT ALL ON FUNCTION public.set_issue_status(bigint, text) TO anon;

GRANT ALL ON FUNCTION public.set_issue_status(bigint, text) TO authenticated;

GRANT ALL ON FUNCTION public.set_issue_status(bigint, text) TO service_role;

CREATE FUNCTION public.set_verification_required (
  p_uniqueid text,
  p_required boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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
$function$;

GRANT ALL ON FUNCTION public.set_verification_required(text, boolean) TO anon;

GRANT ALL ON FUNCTION public.set_verification_required(text, boolean) TO authenticated;

GRANT ALL ON FUNCTION public.set_verification_required(text, boolean) TO service_role;

CREATE FUNCTION public.sync_duplicate_barcode_issues (
  p_check_code text,
  p_table      text,
  p_issues     jsonb
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  n integer;
begin
  insert into public.data_quality_issues
    (country, check_code, severity, barcode, description, description_fr, status, detected_at, resolved_at)
  select i->>'country', p_check_code, 'warning', i->>'barcode', i->>'description', i->>'description_fr',
         'open', now(), null
  from jsonb_array_elements(p_issues) as i
  on conflict (check_code, coalesce(uniqueid,''), coalesce(barcode,''), coalesce(field,''), coalesce(related_barcode,''))
  do update set
    country        = excluded.country,
    description    = excluded.description,
    description_fr = excluded.description_fr,
    status         = 'open',
    detected_at    = case when data_quality_issues.status = 'resolved'
                          then now() else data_quality_issues.detected_at end,
    resolved_at    = null
  where data_quality_issues.status <> 'dismissed';

  get diagnostics n = row_count;

  -- Resolve a previously reported collision for this check that isn't
  -- firing this run -- e.g. the source data was corrected (a device
  -- re-upload with a fixed barcode) so there's nothing left to collapse.
  update public.data_quality_issues d
  set status = 'resolved', resolved_at = now()
  where d.status = 'open'
    and d.check_code = p_check_code
    and not exists (
      select 1 from jsonb_array_elements(p_issues) as i where (i->>'barcode') = d.barcode
    );

  -- Record every dropped row so a user can inspect what got collapsed.
  -- Append-only: never deleted, even once the issue above resolves.
  insert into public.duplicate_records
    (country, source_table, barcode, dropped_uniqueid, kept_uniqueid, raw, lastmod)
  select
    i->>'country', p_table, i->>'barcode',
    d->>'uniqueid', i->>'kept_uniqueid', (d->'raw'), nullif(d->>'lastmod','')::timestamptz
  from jsonb_array_elements(p_issues) as i
  cross join jsonb_array_elements(i->'dropped') as d
  on conflict (source_table, dropped_uniqueid) do update set
    barcode       = excluded.barcode,
    kept_uniqueid = excluded.kept_uniqueid,
    raw           = excluded.raw,
    lastmod       = excluded.lastmod,
    country       = excluded.country;

  return n;
end;
$function$;

GRANT ALL ON FUNCTION public.sync_duplicate_barcode_issues(text, text, jsonb) TO anon;

GRANT ALL ON FUNCTION public.sync_duplicate_barcode_issues(text, text, jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.sync_duplicate_barcode_issues(text, text, jsonb) TO service_role;

CREATE TABLE public.access_log (
  id          bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  actor       text                     NOT NULL,
  event       text                     NOT NULL,
  section     text,
  occurred_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.access_log
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.access_log
  ADD CONSTRAINT access_log_event_check CHECK (event = ANY (ARRAY['page_view'::text, 'section_view'::text]));

ALTER TABLE public.access_log
  ADD CONSTRAINT access_log_pkey PRIMARY KEY (id);

GRANT ALL ON public.access_log TO anon;

GRANT ALL ON public.access_log TO authenticated;

GRANT ALL ON public.access_log TO service_role;

CREATE INDEX access_log_occurred_idx ON public.access_log (occurred_at DESC);

CREATE INDEX access_log_actor_idx ON public.access_log (actor);

CREATE POLICY access_log_select ON public.access_log
  FOR SELECT
  TO authenticated
  USING (public.auth_is_admin());

CREATE TABLE public.allowed_users (
  email          text                     NOT NULL,
  country_access text                     NOT NULL,
  is_admin       boolean                  DEFAULT false NOT NULL,
  default_locale text                     DEFAULT 'en'::text NOT NULL,
  full_name      text,
  created_at     timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.allowed_users
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.allowed_users
  ADD CONSTRAINT allowed_users_country_access_check CHECK (country_access = ANY (ARRAY['UG'::text, 'BF'::text, 'BOTH'::text]));

ALTER TABLE public.allowed_users
  ADD CONSTRAINT allowed_users_default_locale_check CHECK (default_locale = ANY (ARRAY['en'::text, 'fr'::text]));

ALTER TABLE public.allowed_users
  ADD CONSTRAINT allowed_users_pkey PRIMARY KEY (email);

GRANT ALL ON public.allowed_users TO anon;

GRANT ALL ON public.allowed_users TO authenticated;

GRANT ALL ON public.allowed_users TO service_role;

CREATE POLICY allowed_users_select ON public.allowed_users
  FOR SELECT
  TO authenticated
  USING (((lower(email) = public.auth_email()) OR public.auth_is_admin()));

CREATE TABLE public.audittrail (
  id                bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  country           text   NOT NULL,
  "table"           text,
  uniqueid          text,
  barcode           text,
  fieldname         text,
  old_value         text,
  new_value         text,
  old_lastmod       text,
  new_lastmod       text,
  old_sourcefile    text,
  new_sourcefile    text,
  audit_recorded_at text,
  startdate         text
);

ALTER TABLE public.audittrail
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.audittrail
  ADD CONSTRAINT audittrail_country_check CHECK (country = ANY (ARRAY['UG'::text, 'BF'::text]));

ALTER TABLE public.audittrail
  ADD CONSTRAINT audittrail_pkey PRIMARY KEY (id);

GRANT ALL ON public.audittrail TO anon;

GRANT ALL ON public.audittrail TO authenticated;

GRANT ALL ON public.audittrail TO service_role;

CREATE INDEX audittrail_country_idx ON public.audittrail (country);

CREATE UNIQUE INDEX audittrail_identity_idx ON public.audittrail (uniqueid, fieldname, new_lastmod);

CREATE POLICY audittrail_select ON public.audittrail
  FOR SELECT
  TO authenticated
  USING (public.auth_can_see(country));

CREATE TABLE public.blood_smear (
  barcode         text                     NOT NULL,
  country         text                     NOT NULL,
  parasitedensity numeric,
  slidequality    integer,
  gametocytes     integer,
  readingcomments text,
  mic_positive    integer,
  raw             jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  updated_at      timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.blood_smear
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.blood_smear
  ADD CONSTRAINT blood_smear_country_check CHECK (country = ANY (ARRAY['UG'::text, 'BF'::text]));

ALTER TABLE public.blood_smear
  ADD CONSTRAINT blood_smear_pkey PRIMARY KEY (barcode);

GRANT ALL ON public.blood_smear TO anon;

GRANT ALL ON public.blood_smear TO authenticated;

GRANT ALL ON public.blood_smear TO service_role;

CREATE INDEX blood_smear_country_idx ON public.blood_smear (country);

CREATE POLICY blood_smear_select ON public.blood_smear
  FOR SELECT
  TO authenticated
  USING (public.auth_can_see(country));

CREATE TABLE public.data_quality_issues (
  id              bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  country         text                     NOT NULL,
  check_code      text                     NOT NULL,
  severity        text                     DEFAULT 'warning'::text NOT NULL,
  subjid          text,
  barcode         text,
  mrc             text,
  field           text,
  description     text                     NOT NULL,
  description_fr  text                     NOT NULL,
  status          text                     DEFAULT 'open'::text NOT NULL,
  detected_at     timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at     timestamp with time zone,
  dismissed_at    timestamp with time zone,
  dismissed_by    text,
  related_barcode text,
  uniqueid        text
);

ALTER TABLE public.data_quality_issues
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.data_quality_issues
  ADD CONSTRAINT data_quality_issues_country_check CHECK (country = ANY (ARRAY['UG'::text, 'BF'::text]));

ALTER TABLE public.data_quality_issues
  ADD CONSTRAINT data_quality_issues_pkey PRIMARY KEY (id);

ALTER TABLE public.data_quality_issues
  ADD CONSTRAINT data_quality_issues_severity_check CHECK (severity = ANY (ARRAY['error'::text, 'warning'::text, 'info'::text]));

ALTER TABLE public.data_quality_issues
  ADD CONSTRAINT data_quality_issues_status_check CHECK (status = ANY (ARRAY['open'::text, 'resolved'::text, 'dismissed'::text]));

GRANT ALL ON public.data_quality_issues TO anon;

GRANT ALL ON public.data_quality_issues TO authenticated;

GRANT ALL ON public.data_quality_issues TO service_role;

CREATE UNIQUE INDEX dq_identity_idx
  ON public.data_quality_issues (check_code, COALESCE(uniqueid, ''::text), COALESCE(barcode, ''::text), COALESCE(field, ''::text), COALESCE(related_barcode, ''::text));

CREATE INDEX dq_country_idx ON public.data_quality_issues (country);

CREATE INDEX dq_status_idx ON public.data_quality_issues (status);

CREATE POLICY dq_select ON public.data_quality_issues
  FOR SELECT
  TO authenticated
  USING (public.auth_can_see(country));

CREATE TABLE public.data_quality_status_audit (
  id         bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  issue_id   bigint                   NOT NULL,
  country    text                     NOT NULL,
  check_code text                     NOT NULL,
  subjid     text,
  barcode    text,
  mrc        text,
  action     text                     NOT NULL,
  actor      text                     NOT NULL,
  acted_at   timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.data_quality_status_audit
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.data_quality_status_audit
  ADD CONSTRAINT data_quality_status_audit_action_check CHECK (action = ANY (ARRAY['dismissed'::text, 'reopened'::text]));

ALTER TABLE public.data_quality_status_audit
  ADD CONSTRAINT data_quality_status_audit_country_check CHECK (country = ANY (ARRAY['UG'::text, 'BF'::text]));

ALTER TABLE public.data_quality_status_audit
  ADD CONSTRAINT data_quality_status_audit_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.data_quality_issues(id) ON DELETE CASCADE;

ALTER TABLE public.data_quality_status_audit
  ADD CONSTRAINT data_quality_status_audit_pkey PRIMARY KEY (id);

GRANT ALL ON public.data_quality_status_audit TO anon;

GRANT ALL ON public.data_quality_status_audit TO authenticated;

GRANT ALL ON public.data_quality_status_audit TO service_role;

CREATE INDEX dq_audit_issue_idx ON public.data_quality_status_audit (issue_id);

CREATE INDEX dq_audit_country_idx ON public.data_quality_status_audit (country);

CREATE POLICY dq_audit_select ON public.data_quality_status_audit
  FOR SELECT
  TO authenticated
  USING (public.auth_can_see(country));

CREATE TABLE public.deployed_barcodes (
  barcode text NOT NULL,
  country text NOT NULL
);

ALTER TABLE public.deployed_barcodes
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.deployed_barcodes
  ADD CONSTRAINT deployed_barcodes_country_check CHECK (country = ANY (ARRAY['UG'::text, 'BF'::text]));

ALTER TABLE public.deployed_barcodes
  ADD CONSTRAINT deployed_barcodes_pkey PRIMARY KEY (barcode);

GRANT ALL ON public.deployed_barcodes TO anon;

GRANT ALL ON public.deployed_barcodes TO authenticated;

GRANT ALL ON public.deployed_barcodes TO service_role;

CREATE INDEX deployed_barcodes_country_idx ON public.deployed_barcodes (country);

CREATE POLICY deployed_barcodes_select ON public.deployed_barcodes
  FOR SELECT
  TO authenticated
  USING (public.auth_can_see(country));

CREATE TABLE public.duplicate_records (
  id               bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  country          text                     NOT NULL,
  source_table     text                     NOT NULL,
  barcode          text                     NOT NULL,
  dropped_uniqueid text,
  kept_uniqueid    text,
  raw              jsonb                    NOT NULL,
  lastmod          timestamp with time zone,
  recorded_at      timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.duplicate_records
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.duplicate_records
  ADD CONSTRAINT duplicate_records_country_check CHECK (country = ANY (ARRAY['UG'::text, 'BF'::text]));

ALTER TABLE public.duplicate_records
  ADD CONSTRAINT duplicate_records_pkey PRIMARY KEY (id);

GRANT ALL ON public.duplicate_records TO anon;

GRANT ALL ON public.duplicate_records TO authenticated;

GRANT ALL ON public.duplicate_records TO service_role;

CREATE UNIQUE INDEX duplicate_records_identity_idx ON public.duplicate_records (source_table, dropped_uniqueid);

CREATE INDEX duplicate_records_country_idx ON public.duplicate_records (country);

CREATE INDEX duplicate_records_barcode_idx ON public.duplicate_records (source_table, barcode);

CREATE POLICY duplicate_records_select ON public.duplicate_records
  FOR SELECT
  TO authenticated
  USING (public.auth_can_see(country));

CREATE TABLE public.enrollee (
  uniqueid             text                     NOT NULL,
  country              text                     NOT NULL,
  subjid               text,
  barcode              text,
  mrc                  text,
  district             text,
  subcounty            text,
  parish               text,
  village              text,
  startdate            date,
  enrollment_week      date,
  dob                  date,
  agemonths_calculated integer,
  age_eligible         integer,
  mal_test_eligible    integer,
  consent_eligible     integer,
  gender               integer,
  sex                  integer,
  diagnostic           integer,
  result               integer,
  vx_card              integer,
  need_vac_cov         integer,
  vx_any               integer,
  vx_doses_received    integer,
  vx_dose1_date        date,
  vx_dose2_date        date,
  vx_dose3_date        date,
  vx_dose4_date        date,
  lastmod              timestamp with time zone,
  raw                  jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  updated_at           timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.enrollee
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.enrollee
  ADD CONSTRAINT enrollee_country_check CHECK (country = ANY (ARRAY['UG'::text, 'BF'::text]));

ALTER TABLE public.enrollee
  ADD CONSTRAINT enrollee_pkey PRIMARY KEY (uniqueid);

GRANT ALL ON public.enrollee TO anon;

GRANT ALL ON public.enrollee TO authenticated;

GRANT ALL ON public.enrollee TO service_role;

CREATE INDEX enrollee_country_idx ON public.enrollee (country);

CREATE INDEX enrollee_name_trgm_idx ON public.enrollee USING gin (upper(raw ->> 'participantsname'::text) public.gin_trgm_ops);

CREATE INDEX enrollee_barcode_idx ON public.enrollee (barcode);

CREATE INDEX enrollee_mrc_idx ON public.enrollee (country, mrc);

CREATE POLICY enrollee_select ON public.enrollee
  FOR SELECT
  TO authenticated
  USING (public.auth_can_see(country));

CREATE TABLE public.facilities (
  country           text             NOT NULL,
  mrc               text             NOT NULL,
  name              text             NOT NULL,
  district          text,
  region            text,
  transmission_zone text,
  latitude          double precision,
  longitude         double precision
);

ALTER TABLE public.facilities
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.facilities
  ADD CONSTRAINT facilities_country_check CHECK (country = ANY (ARRAY['UG'::text, 'BF'::text]));

ALTER TABLE public.facilities
  ADD CONSTRAINT facilities_pkey PRIMARY KEY (country, mrc);

GRANT ALL ON public.facilities TO anon;

GRANT ALL ON public.facilities TO authenticated;

GRANT ALL ON public.facilities TO service_role;

CREATE POLICY facilities_select ON public.facilities
  FOR SELECT
  TO authenticated
  USING (public.auth_can_see(country));

CREATE TABLE public.full_dataset_exports (
  id            bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  requested_by  text                     NOT NULL,
  storage_paths jsonb                    NOT NULL,
  row_counts    jsonb                    NOT NULL,
  expires_at    timestamp with time zone NOT NULL,
  created_at    timestamp with time zone DEFAULT now() NOT NULL,
  revoked_at    timestamp with time zone
);

ALTER TABLE public.full_dataset_exports
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.full_dataset_exports
  ADD CONSTRAINT full_dataset_exports_pkey PRIMARY KEY (id);

GRANT ALL ON public.full_dataset_exports TO anon;

GRANT ALL ON public.full_dataset_exports TO authenticated;

GRANT ALL ON public.full_dataset_exports TO service_role;

CREATE INDEX full_dataset_exports_created_idx ON public.full_dataset_exports (created_at DESC);

CREATE POLICY full_dataset_exports_insert ON public.full_dataset_exports
  FOR INSERT
  TO authenticated
  WITH CHECK ((public.auth_is_admin() AND (requested_by = public.auth_email())));

CREATE POLICY full_dataset_exports_select ON public.full_dataset_exports
  FOR SELECT
  TO authenticated
  USING (public.auth_is_admin());

CREATE POLICY full_dataset_exports_update ON public.full_dataset_exports
  FOR UPDATE
  TO authenticated
  USING (public.auth_is_admin())
  WITH CHECK (public.auth_is_admin());

CREATE TABLE public.pipeline_runs (
  id          bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  finished_at timestamp with time zone DEFAULT now() NOT NULL,
  n_enrollee  integer,
  note        text
);

ALTER TABLE public.pipeline_runs
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pipeline_runs
  ADD CONSTRAINT pipeline_runs_pkey PRIMARY KEY (id);

GRANT ALL ON public.pipeline_runs TO anon;

GRANT ALL ON public.pipeline_runs TO authenticated;

GRANT ALL ON public.pipeline_runs TO service_role;

CREATE POLICY pipeline_runs_select ON public.pipeline_runs
  FOR SELECT
  TO authenticated
  USING (true);

CREATE TABLE public.vaccination_status (
  barcode           text                     NOT NULL,
  country           text                     NOT NULL,
  startdate         date,
  vx_card           integer,
  vx_doses_received integer,
  vx_dose1_date     date,
  vx_dose2_date     date,
  vx_dose3_date     date,
  vx_dose4_date     date,
  vx_doses_miss     integer,
  vx_dose_off_sched integer,
  lastmod           timestamp with time zone,
  raw               jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  updated_at        timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.vaccination_status
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vaccination_status
  ADD CONSTRAINT vaccination_status_country_check CHECK (country = ANY (ARRAY['UG'::text, 'BF'::text]));

ALTER TABLE public.vaccination_status
  ADD CONSTRAINT vaccination_status_pkey PRIMARY KEY (barcode);

GRANT ALL ON public.vaccination_status TO anon;

GRANT ALL ON public.vaccination_status TO authenticated;

GRANT ALL ON public.vaccination_status TO service_role;

CREATE INDEX vaccination_status_country_idx ON public.vaccination_status (country);

CREATE POLICY vaccination_status_select ON public.vaccination_status
  FOR SELECT
  TO authenticated
  USING (public.auth_can_see(country));

CREATE TABLE public.verification_status_audit (
  id       bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  uniqueid text                     NOT NULL,
  country  text                     NOT NULL,
  subjid   text,
  barcode  text,
  mrc      text,
  action   text                     NOT NULL,
  actor    text                     NOT NULL,
  acted_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.verification_status_audit
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.verification_status_audit
  ADD CONSTRAINT verification_status_audit_action_check CHECK (action = ANY (ARRAY['waived'::text, 'reinstated'::text]));

ALTER TABLE public.verification_status_audit
  ADD CONSTRAINT verification_status_audit_country_check CHECK (country = ANY (ARRAY['UG'::text, 'BF'::text]));

ALTER TABLE public.verification_status_audit
  ADD CONSTRAINT verification_status_audit_pkey PRIMARY KEY (id);

GRANT ALL ON public.verification_status_audit TO anon;

GRANT ALL ON public.verification_status_audit TO authenticated;

GRANT ALL ON public.verification_status_audit TO service_role;

CREATE INDEX verification_audit_country_idx ON public.verification_status_audit (country);

CREATE INDEX verification_audit_uniqueid_idx ON public.verification_status_audit (uniqueid);

CREATE POLICY verification_audit_select ON public.verification_status_audit
  FOR SELECT
  TO authenticated
  USING (public.auth_can_see(country));

CREATE TABLE public.verification_waivers (
  uniqueid text                     NOT NULL,
  country  text                     NOT NULL,
  required boolean                  DEFAULT true NOT NULL,
  set_by   text                     NOT NULL,
  set_at   timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.verification_waivers
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.verification_waivers
  ADD CONSTRAINT verification_waivers_country_check CHECK (country = ANY (ARRAY['UG'::text, 'BF'::text]));

ALTER TABLE public.verification_waivers
  ADD CONSTRAINT verification_waivers_pkey PRIMARY KEY (uniqueid);

ALTER TABLE public.verification_waivers
  ADD CONSTRAINT verification_waivers_uniqueid_fkey FOREIGN KEY (uniqueid) REFERENCES public.enrollee(uniqueid) ON DELETE CASCADE;

GRANT ALL ON public.verification_waivers TO anon;

GRANT ALL ON public.verification_waivers TO authenticated;

GRANT ALL ON public.verification_waivers TO service_role;

CREATE INDEX verification_waivers_country_idx ON public.verification_waivers (country);

CREATE POLICY verification_waivers_select ON public.verification_waivers
  FOR SELECT
  TO authenticated
  USING (public.auth_can_see(country));

CREATE TABLE public.villages (
  countryid   bigint,
  country     text,
  districtid  bigint,
  district    text,
  subcountyid bigint,
  subcounty   text,
  parishid    bigint,
  parish      text,
  villageid   bigint,
  village     text,
  mrcid       bigint,
  mrc         text
);

ALTER TABLE public.villages
  ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.villages TO anon;

GRANT ALL ON public.villages TO authenticated;

GRANT ALL ON public.villages TO service_role;

CREATE POLICY villages_select ON public.villages
  FOR SELECT
  TO authenticated
  USING (true);

CREATE EVENT TRIGGER ensure_rls
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();
