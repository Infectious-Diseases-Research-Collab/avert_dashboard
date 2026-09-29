-- Add Burkina Faso facilities 014-025 (Guriko, Bankui and Oubri regions).
-- transmission_zone intentionally left null. Upsert on (country, mrc) so the
-- migration is safe to re-run.

insert into public.facilities (country, mrc, name, district, region, latitude, longitude) values
  ('BF','014','CM de Bama','Dandé','Guriko',11.371611,-4.392777),
  ('BF','015','CSPS de Dandé','Dandé','Guriko',11.576555,-4.558027),
  ('BF','016','CSPS Dougoumato 2','Houndé','Guriko',11.210545,-3.808607),
  ('BF','017','CSPS Secteur 02','Houndé','Guriko',11.500417,-3.533979),
  ('BF','018','CSPS de Klesso','Karangasso-Vigué','Guriko',10.941596,-3.983453),
  ('BF','019','CSPS de Dan','Karangasso-Vigué','Guriko',10.931399,-3.775501),
  ('BF','020','CSPS de Yéguéré','Karangasso-Vigué','Guriko',10.970460,-4.097681),
  ('BF','021','CM de Fara','Boromo','Bankui',12.582006,-1.298862),
  ('BF','022','CSPS de Pâ','Boromo','Bankui',11.546889,-3.261333),
  ('BF','023','CSPS Urbain de Zorgho','Zorgho','Oubri',12.249944,-0.615389),
  ('BF','024','CM de Mogtédo','Zorgho','Oubri',12.284487,-0.829294),
  ('BF','025','CSPS de Sapaga','Zorgho','Oubri',12.182806,-0.439917)
on conflict (country, mrc) do update
  set name = excluded.name,
      district = excluded.district,
      region = excluded.region,
      latitude = excluded.latitude,
      longitude = excluded.longitude;
