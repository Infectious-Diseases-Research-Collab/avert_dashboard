-- =====================================================================
-- Seed: study health facilities (from the BF/UG facility Excel lists).
-- mrc is stored as text, zero-padded to 3 digits for both countries --
-- matches what enrollee.mrc actually carries (confirmed against live
-- data). Re-runnable (upsert on primary key (country, mrc)), which is
-- exactly why a wrong-width code here is dangerous: '62' unpadded is a
-- DIFFERENT primary key from '062', so upserting it doesn't correct the
-- real row, it silently creates a permanent duplicate next to it -- as
-- happened with Kigandalo HCIV below prior to this fix.
-- =====================================================================

insert into public.facilities (country, mrc, name, district) values
  ('UG','027','Lalogi HCIV','Omoro'),
  ('UG','031','Namokora HCIV','Kitgum'),
  ('UG','032','Kitgum Matidi HCIII','Kitgum'),
  ('UG','036','Otwal HCIII','Oyam'),
  ('UG','056','Nawaikoke HCIII','Kaliro'),
  ('UG','062','Kigandalo HCIV','Mayuge'),
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
  ('BF','011','Ouahabou','Boromo','Boucle Mouhoun','Forte'),
  ('BF','013','Boromo Urbain 2','Boromo','Boucle Mouhoun','Forte')
on conflict (country, mrc) do update
  set name = excluded.name, district = excluded.district,
      region = excluded.region, transmission_zone = excluded.transmission_zone;

-- ---------------------------------------------------------------------
-- Site coordinates (Burkina Faso), from Coordonnées_Sites_etude_R21.xlsx.
-- Keyed on mrc, NOT on name: the source spreadsheet spells four sites
-- differently (Bereba / Karangasso Vigue / Deguelin / Boromo), so matching
-- by name would silently miss them. The map omits any site whose
-- latitude/longitude is null.
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
    ('012', 12.040485,   -0.763302),
    ('013', 11.75151,    -2.93383)
  ) as c(mrc, lat, lon)
 where f.country = 'BF' and f.mrc = c.mrc;

-- ---------------------------------------------------------------------
-- Site coordinates (Uganda), from site_coordinates.csv.
-- Keyed on mrc, NOT on name: the source spreadsheet drops the level suffix
-- on two sites (Nadunget / Rwenyawawa vs "... HCIII" here), so matching by
-- name would silently miss them. The join normalises zero-padding because
-- the UG codes are stored inconsistently — eight are 3-digit ('027') but
-- Kigandalo is plain '62', and a padded literal would match no row at all.
-- ---------------------------------------------------------------------
update public.facilities as f
   set latitude = c.lat, longitude = c.lon
  from (values
    ('27', 2.632554,    32.567273),    -- Lalogi HCIV,         Omoro
    ('31', 3.348567,    33.339557),    -- Namokora HCIV,       Kitgum
    ('32', 3.267942,    33.050091),    -- Kitgum Matidi HCIII, Kitgum
    ('36', 2.500970,    32.712690),    -- Otwal HCIII,         Oyam
    ('56', 1.090051001, 33.40622496),  -- Nawaikoke HCIII,     Kaliro
    ('62', 0.38951,     33.62165),     -- Kigandalo HCIV,      Mayuge
    ('69', 2.401264,    33.34869),     -- Orum HCIV,           Otuke
    ('71', 2.512685,    34.581312),    -- Nadunget HCIII,      Moroto
    ('79', 1.160350023, 30.72830304)   -- Rwenyawawa HCIII,    Kikuube
  ) as c(mrc, lat, lon)
 where f.country = 'UG'
   and lpad(f.mrc, 3, '0') = lpad(c.mrc, 3, '0');
