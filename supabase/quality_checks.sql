-- =====================================================================
-- Data-quality checks.
--
-- Ported from the study's actual post-hoc QA script ("01a Survey data
-- quality checks.R", A. Martin) and its governing SOP
-- (AVERT-DataMgmt-002). These are checks the Country Data Manager runs
-- AFTER collection to catch missing/inconsistent data for correction —
-- distinct from the survey app's own in-field LogicCheck validations,
-- which block data entry at collection time and can never fail here.
--
-- Field-name notes: the R script predates the current 216-field, two-
-- country instrument. It used `fpbarcode1_r21`/`fpbarcode2_r21` (now
-- `barcode`/`barcode2`), `uid`/`uid2` (retired, no replacement), `spray`
-- (now `structuresprayed`), a 2-site `mrc==096/110` prefix scheme (now
-- per-country prefixes `R21U-`/`R21B-` across 21 facilities), and
-- `vx_any >= N` for "how many doses" (now `vx_doses_received`, since
-- `vx_any` is a plain yes/no in the current instrument). Checks below
-- use the current field names/logic with the same intent.
--
-- NOT ported (missing a data source, not a bug):
--   * "barcode not on generated list" — needs the barcode-allocation
--     reference file (e.g. used_ids_r21.csv), which isn't part of this
--     pipeline yet. Add a reference table + loader step if wanted.
--   * "01b Smear Data Quality Checks" — that script wasn't provided.
--
-- refresh_quality_issues() recomputes the full set of currently-firing
-- issues and merges them into data_quality_issues so that:
--   * a new firing issue is inserted as `open`
--   * a previously-resolved issue that fires again is re-opened
--   * an `open` issue that no longer fires becomes `resolved`
--   (this also cleans up any issues left over from a previous version
--    of this function, since their check_code will simply stop firing)
-- Identity of an issue = (check_code, subjid, barcode, field).
--
-- Call it from the loader (service role) after each data upsert:
--   select public.refresh_quality_issues();
-- =====================================================================

create extension if not exists pg_trgm;

create index if not exists enrollee_name_trgm_idx
  on public.enrollee using gin ((upper(raw->>'participantsname')) gin_trgm_ops);

create or replace function public.refresh_quality_issues()
returns integer            -- number of currently-firing issues
language plpgsql
security definer
set search_path = public
as $$
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
         e.subjid, e.barcode, e.mrc, 'barcode'::text as field,
         'Enrolled participant is missing a study barcode.'::text as description,
         'Le participant inclus n''a pas de code-barres d''étude.'::text as description_fr
  from enrolled e
  where e.barcode is null or e.barcode = ''

  union all
  -- 2. Missing core demographics
  select e.country, 'missing_demographics', 'warning',
         e.subjid, e.barcode, e.mrc, 'agemonths_calculated/gender/village',
         'Missing age, sex, or village for an enrolled participant.',
         'Âge, sexe ou village manquant pour un participant inclus.'
  from enrolled e
  where e.agemonths_calculated is null or e.gender is null
     or e.village is null or e.village = ''

  union all
  -- 3. Missing malaria diagnostic result
  select e.country, 'missing_diagnostic', 'warning',
         e.subjid, e.barcode, e.mrc, 'diagnostic',
         'Missing malaria diagnostic type for an enrolled participant.',
         'Type de diagnostic du paludisme manquant pour un participant inclus.'
  from enrolled e
  where nullif(e.raw->>'diagnostic','') is null

  union all
  -- 4. Missing vaccine-card status
  select e.country, 'missing_vx_card', 'warning',
         e.subjid, e.barcode, e.mrc, 'vx_card',
         'Missing vaccine-card status for an enrolled participant.',
         'Statut de la carte de vaccination manquant pour un participant inclus.'
  from enrolled e
  where nullif(e.raw->>'vx_card','') is null

  union all
  -- 5. Missing "received any doses" (yes/no)
  select e.country, 'missing_vx_any', 'warning',
         e.subjid, e.barcode, e.mrc, 'vx_any',
         'Missing "received any vaccine doses" (yes/no) for an enrolled participant.',
         'Réponse manquante à "a reçu des doses de vaccin" pour un participant inclus.'
  from enrolled e
  where e.vx_any is null

  union all
  -- 6. vx_any = yes but the number of doses received is missing
  select e.country, 'missing_vx_doses_received', 'warning',
         e.subjid, e.barcode, e.mrc, 'vx_doses_received',
         'Participant received doses but the number of doses is missing.',
         'Le participant a reçu des doses mais le nombre de doses est manquant.'
  from enrolled e
  where e.vx_any = 1 and nullif(e.raw->>'vx_doses_received','') is null

  union all
  -- 7-10. Missing dose-detail fields (where/date/verification) for each
  -- reported dose, gated by the number of doses actually received.
  select e.country, 'missing_dose_info', 'warning',
         e.subjid, e.barcode, e.mrc, d.field,
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
  -- 11. Missing malaria risk-behavior fields
  select e.country, 'missing_malaria_risk', 'warning',
         e.subjid, e.barcode, e.mrc, 'timetobed/structuresprayed/bednetlastnight',
         'Missing malaria risk-behavior data (bedtime, spraying, or bednet use).',
         'Données sur les comportements à risque de paludisme manquantes (heure du coucher, pulvérisation ou moustiquaire).'
  from enrolled e
  where nullif(e.raw->>'timetobed','') is null
     or nullif(e.raw->>'structuresprayed','') is null
     or nullif(e.raw->>'bednetlastnight','') is null

  union all
  -- 12. Missing previous-diagnosis info
  select e.country, 'missing_prevdiag', 'warning',
         e.subjid, e.barcode, e.mrc, 'prevdiag',
         'Missing previous-diagnosis data (or missing date of a reported previous diagnosis).',
         'Données de diagnostic antérieur manquantes (ou date manquante pour un diagnostic antérieur signalé).'
  from enrolled e
  where nullif(e.raw->>'prevdiag','') is null
     or ((e.raw->>'prevdiag')::int = 1 and nullif(e.raw->>'prevdiag_when','') is null)

  union all
  -- 13. Barcode doesn't match the expected per-country prefix
  select e.country, 'barcode_country_mismatch', 'error',
         e.subjid, e.barcode, e.mrc, 'barcode',
         format('Barcode %s does not match the expected prefix for %s.', e.barcode, e.country),
         format('Le code-barres %s ne correspond pas au préfixe attendu pour %s.', e.barcode, e.country)
  from enrolled e
  where e.barcode is not null and e.barcode <> ''
    and ((e.country = 'UG' and e.barcode not like 'R21U-%')
      or (e.country = 'BF' and e.barcode not like 'R21B-%'))

  union all
  -- 14. Barcode re-entry mismatch (barcode vs barcode2)
  select e.country, 'barcode_reentry_mismatch', 'error',
         e.subjid, e.barcode, e.mrc, 'barcode2',
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
         e.subjid, e.barcode, e.mrc,
         case when e.country = 'UG' then 'age_at_apr2025' else 'age_at_sep2023' end,
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
         e.subjid, e.barcode, e.mrc, 'consent',
         'Main consent is not marked as provided for an enrolled participant.',
         'Le consentement principal n''est pas marqué comme fourni pour un participant inclus.'
  from enrolled e
  where nullif(e.raw->>'consent','') is not null and (e.raw->>'consent')::numeric <> 1

  union all
  -- 17. Sample/specimen consent not marked as provided
  select e.country, 'consent2_not_provided', 'error',
         e.subjid, e.barcode, e.mrc, 'consent2',
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
  select a.country, 'possible_duplicate_name', 'warning',
         a.subjid, a.barcode, a.mrc, 'participantsname',
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
         e.subjid, e.barcode, e.mrc, 'barcode',
         format('Barcode %s is not on the deployed barcode list for %s.', e.barcode, e.country),
         format('Le code-barres %s ne figure pas sur la liste des codes-barres déployés pour %s.', e.barcode, e.country)
  from enrolled e
  where e.barcode is not null and e.barcode <> ''
    and exists (select 1 from public.deployed_barcodes d where d.country = e.country)
    and not exists (
      select 1 from public.deployed_barcodes d
      where d.country = e.country and d.barcode = e.barcode
    );

  select count(*) into n_firing from _firing;

  -- Upsert firing issues: insert new, re-open previously resolved.
  insert into public.data_quality_issues
    (country, check_code, severity, subjid, barcode, mrc, field, description, description_fr, status, detected_at, resolved_at)
  select country, check_code, severity, subjid, barcode, mrc, field, description, description_fr, 'open', now(), null
  from _firing
  on conflict (check_code, coalesce(subjid,''), coalesce(barcode,''), coalesce(field,''))
  do update set
    country        = excluded.country,
    severity       = excluded.severity,
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
        and coalesce(f.subjid,'')  = coalesce(d.subjid,'')
        and coalesce(f.barcode,'') = coalesce(d.barcode,'')
        and coalesce(f.field,'')   = coalesce(d.field,'')
    );

  return n_firing;
end;
$$;

grant execute on function public.refresh_quality_issues() to service_role, authenticated;
