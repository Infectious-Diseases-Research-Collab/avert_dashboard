-- Add PAGWA WILELA (village 19) to Ibakara parish, Kitgum Matidi subcounty,
-- Kitgum, under Namokora HCIV -- the next free code after 1-18 in that parish.
-- Guarded so re-running it doesn't add a second copy (the table has no
-- primary key).

insert into public.villages
  (countryid, country, districtid, district, subcountyid, subcounty, parishid, parish, villageid, village, mrcid, mrc)
select 1, 'Uganda', 161, 'KITGUM', 3, 'KITGUM MATIDI', 1, 'IBAKARA', 19, 'PAGWA WILELA', 31, 'Namokora HCIV'
where not exists (
  select 1 from public.villages
   where countryid = 1 and districtid = 161 and subcountyid = 3 and parishid = 1 and villageid = 19
);
