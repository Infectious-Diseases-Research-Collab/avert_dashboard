-- Add Burkina Faso facilities 026-029 (names, district and region from
-- BF_Villages.xlsx). These mrc codes overlap Uganda's numbering (UG also has a
-- '027'), which is why every lookup has to key on (country, mrc).
-- transmission_zone intentionally left null, as for 014-025. Upsert on
-- (country, mrc) so the migration is safe to re-run.

insert into public.facilities (country, mrc, name, district, region, latitude, longitude) values
  ('BF','026','CM de Poura','Boromo','Bankui',11.5994722222,-2.7620277778),
  ('BF','027','CSPS de Poya','Karangasso-Vigué','Guriko',11.0730007,-3.794663),
  ('BF','028','CSPS de Diosso','Karangasso-Vigué','Guriko',10.77776656,-3.8946881),
  ('BF','029','CM de Fara','Boromo','Bankui',12.582006,-1.298862)
on conflict (country, mrc) do update
  set name = excluded.name,
      district = excluded.district,
      region = excluded.region,
      latitude = excluded.latitude,
      longitude = excluded.longitude;
