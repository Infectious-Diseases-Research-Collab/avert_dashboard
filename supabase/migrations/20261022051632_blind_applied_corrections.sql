-- applied_corrections: hide the values of blinded fields.
--
-- A record restore rewrites every field the tablet cleared, including the
-- study outcome (result) and participant/guardian names, so the Corrections
-- table and its CSV showed them. The row stays (it records that the field was
-- restored); only the values are withheld. Keep this list in step with
-- BLINDED_DOWNLOAD_DENYLIST in src/lib/blinding.ts.
CREATE OR REPLACE VIEW public.applied_corrections
  WITH (security_invoker = true)
AS
SELECT a.id,
       a.country,
       a.uniqueid,
       e.subjid,
       coalesce(nullif(a.barcode, ''), e.barcode) AS barcode,
       e.mrc,
       a.fieldname,
       CASE WHEN b.blinded THEN '(blinded)' ELSE a.old_value END AS old_value,
       CASE WHEN b.blinded THEN '(blinded)' ELSE a.new_value END AS new_value,
       a.new_lastmod,
       a.new_sourcefile,
       a.correction_reason,
       a.correction_source_document,
       a.correction_verified_by
FROM public.audittrail a
LEFT JOIN public.enrollee e ON e.uniqueid = a.uniqueid
CROSS JOIN LATERAL (
  SELECT a.fieldname IN ('result', 'participantsname', 'phonenumber_ug',
                         'phonenumber_bf', 'caregiver_name') AS blinded
) b
WHERE a.new_sourcefile LIKE 'corrections/%';
