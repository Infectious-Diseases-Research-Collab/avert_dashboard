-- Correct BF site 021 name: it is a CSPS, not a CM.
update public.facilities
  set name = 'CSPS de Fara'
  where country = 'BF' and mrc = '021';
