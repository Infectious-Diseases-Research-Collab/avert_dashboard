-- Align Burkina Faso facilities with BF_Villages.xlsx, the agreed source of
-- truth for site name, district and region. Only the rows that differed are
-- listed. Coordinates and transmission_zone aren't in that sheet: untouched.

update public.facilities as f
   set name = c.name, region = c.region
  from (values
    ('003', 'Béréba',           'Guriko'),
    ('004', 'Dohoun',           'Guriko'),
    ('005', 'Kari',             'Guriko'),
    ('006', 'Karangasso Vigue', 'Guriko'),
    ('007', 'Soumousso',        'Guriko'),
    ('008', 'Wara',             'Guriko'),
    ('009', 'Deguelin',         'Guriko'),
    ('010', 'Boromo',           'Bankui'),
    ('011', 'Ouahabou',         'Bankui'),
    ('013', 'Boromo Urbain 2',  'Bankui')
  ) as c(mrc, name, region)
 where f.country = 'BF' and f.mrc = c.mrc;
