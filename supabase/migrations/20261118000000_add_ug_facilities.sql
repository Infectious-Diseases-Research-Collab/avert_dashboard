-- Add nine Uganda facilities (Amuru, Agago, Kumi, Bukedea, Buyende, Kaliro,
-- Luuka, Busia). mrc is zero-padded to 3 digits to match enrollee.mrc -- an
-- unpadded '24' would be a different primary key from '024' and create a
-- duplicate row. Region / transmission_zone left null, as for the existing UG
-- sites. Upsert on (country, mrc) so the migration is safe to re-run.

insert into public.facilities (country, mrc, name, district, latitude, longitude) values
  ('UG','024','Amuru HCIII',     'Amuru',   2.811962971, 31.937942),
  ('UG','034','Lira-Kato HCIII', 'Agago',   2.869040966, 33.48807802),
  ('UG','049','Kamaca HCIII',    'Kumi',    1.332459,    33.894331),
  ('UG','052','Bukedea HCIV',    'Bukedea', 1.329067005, 34.04247503),
  ('UG','053','Kidera HCIV',     'Buyende', 1.33716,     32.9889),
  ('UG','054','Bugaya HCIV',     'Buyende', 1.095191,    33.244758),
  ('UG','055','Bumanya HCIV',    'Kaliro',  1.002057027, 33.49529802),
  ('UG','058','Ikumbya HCIII',   'Luuka',   0.98259,     33.32426),
  ('UG','063','Lumino HCIII',    'Busia',   0.3242,      33.9883)
on conflict (country, mrc) do update
  set name = excluded.name,
      district = excluded.district,
      latitude = excluded.latitude,
      longitude = excluded.longitude;
