-- Read the two "no vaccine card" reasons from plain columns. Extracting them
-- from raw on every dashboard load decompresses each row's jsonb, which took
-- about 185 ms per 1,000 rows against about 2 ms for a plain column. Generated,
-- so raw stays the single source and the pipeline's upsert doesn't change.

alter table public.enrollee
  add column if not exists vx_card_no text
    generated always as (raw->>'vx_card_no') stored,
  add column if not exists vx_card_no_oth text
    generated always as (raw->>'vx_card_no_oth') stored;
