-- Correct the GPS coordinates for BF site 029 (CM de Fara), as confirmed by
-- Michael Compaore on 2026-11-05 ("BF sites_MC.xlsx", tab Sheet1). The previous
-- value (12.582006, -1.298862) placed the site about 198 km from CSPS de Fara.
update public.facilities
set latitude = 11.524722221,
    longitude = -2.7664722222
where country = 'BF'
  and mrc = '029';
