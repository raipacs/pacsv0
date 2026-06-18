create extension if not exists pg_trgm;

create or replace function public.tr_search_normalize(input text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      lower(
        translate(
          coalesce(input, ''),
          'ÇĞİIÖŞÜçğıöşüÂâÊêÎîÔôÛû',
          'CGIIOSUcgiosuAaEeIiOoUu'
        )
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    ),
    ''
  );
$$;

alter table public.patients
add column if not exists search_text text generated always as (
  public.tr_search_normalize(
    concat_ws(' ', patient_number, first_name, last_name, phone, email)
  )
) stored;

alter table public.studies
add column if not exists search_text text generated always as (
  public.tr_search_normalize(
    concat_ws(
      ' ',
      accession_number,
      modality,
      body_part,
      description,
      referring_physician,
      source_ae_title
    )
  )
) stored;

create index if not exists patients_org_search_trgm_idx
  on public.patients using gin (search_text gin_trgm_ops);

create index if not exists studies_org_search_trgm_idx
  on public.studies using gin (search_text gin_trgm_ops);

comment on function public.tr_search_normalize(text)
is 'Normalizes Turkish text for accent-insensitive search, for example Çelik/Celik and I/İ/ı matching.';

comment on column public.patients.search_text
is 'Generated normalized search text for Turkish patient lookup.';

comment on column public.studies.search_text
is 'Generated normalized search text for Turkish study lookup.';
