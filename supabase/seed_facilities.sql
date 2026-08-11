-- =====================================================================
-- Seed: study health facilities (from the BF/UG facility Excel lists).
-- mrc is stored as text; Uganda uses plain integers, Burkina uses
-- zero-padded 3-digit codes. Re-runnable (upsert on primary key).
-- =====================================================================

insert into public.facilities (country, mrc, name, district) values
  ('UG','027','Lalogi HCIV','Omoro'),
  ('UG','031','Namokora HCIV','Kitgum'),
  ('UG','032','Kitgum Matidi HCIII','Kitgum'),
  ('UG','036','Otwal HCIII','Oyam'),
  ('UG','056','Nawaikoke HCIII','Kaliro'),
  ('UG','62','Kigandalo HCIV','Mayuge'),
  ('UG','069','Orum HCIV','Otuke'),
  ('UG','071','Nadunget HCIII','Moroto'),
  ('UG','079','Rwenyawawa HCIII','Kikuube')
on conflict (country, mrc) do update
  set name = excluded.name, district = excluded.district;

insert into public.facilities (country, mrc, name, district, region, transmission_zone) values
  ('BF','001','Mankarga V3','Zorgho','Oubri','Modérée'),
  ('BF','002','Mankarga V6','Zorgho','Oubri','Modérée'),
  ('BF','012','Mankarga T','Zorgho','Oubri','Modérée'),
  ('BF','003','Béréba','Houndé','Hauts-Bassins','Modérée'),
  ('BF','004','Dohoun','Houndé','Hauts-Bassins','Modérée'),
  ('BF','005','Kari','Houndé','Hauts-Bassins','Modérée'),
  ('BF','006','Karangasso-Vigué','Karangasso-Vigué','Hauts-Bassins','Forte'),
  ('BF','007','Soumousso','Karangasso-Vigué','Hauts-Bassins','Forte'),
  ('BF','008','Wara','Karangasso-Vigué','Hauts-Bassins','Forte'),
  ('BF','009','Déguélin','Karangasso-Vigué','Hauts-Bassins','Forte'),
  ('BF','010','Boromo','Boromo','Boucle Mouhoun','Forte'),
  ('BF','011','Ouahabou','Boromo','Boucle Mouhoun','Forte')
on conflict (country, mrc) do update
  set name = excluded.name, district = excluded.district,
      region = excluded.region, transmission_zone = excluded.transmission_zone;

-- ---------------------------------------------------------------------
-- Site coordinates (Burkina Faso), from Coordonnées_Sites_etude_R21.xlsx.
-- Keyed on mrc, NOT on name: the source spreadsheet spells four sites
-- differently (Bereba / Karangasso Vigue / Deguelin / Boromo), so matching
-- by name would silently miss them. Uganda sites have no coordinates yet;
-- the map omits any site whose latitude/longitude is null.
-- ---------------------------------------------------------------------
update public.facilities as f
   set latitude = c.lat, longitude = c.lon
  from (values
    ('001', 12.113099,   -0.851065),
    ('002', 12.053639,   -0.834583),
    ('003', 11.62258333, -3.688138889),
    ('004', 11.5680194,  -3.621554),
    ('005', 11.380298,   -3.610899),
    ('006', 10.8803249,  -3.9356004),
    ('007', 11.0111421,  -4.0447422),
    ('008', 10.9185499,  -4.0547266),
    ('009', 11.0907365,  -3.937151),
    ('010', 11.743942,   -2.934045),
    ('011', 11.694677,   -3.098722),
    ('012', 12.040485,   -0.763302)
  ) as c(mrc, lat, lon)
 where f.country = 'BF' and f.mrc = c.mrc;
