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
  ('BF','010','Boromo urbain 1','Boromo','Boucle Mouhoun','Forte'),
  ('BF','011','Ouahabou','Boromo','Boucle Mouhoun','Forte')
on conflict (country, mrc) do update
  set name = excluded.name, district = excluded.district,
      region = excluded.region, transmission_zone = excluded.transmission_zone;
