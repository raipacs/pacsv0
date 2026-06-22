alter table public.patients
  add column if not exists source_system text,
  add column if not exists external_patient_id text,
  add column if not exists national_id text,
  add column if not exists passport_number text,
  add column if not exists mother_name text,
  add column if not exists father_name text,
  add column if not exists birth_place text,
  add column if not exists mobile_phone_e164 text,
  add column if not exists external_data jsonb not null default '{}'::jsonb,
  add column if not exists external_data_imported_at timestamptz;

create index if not exists patients_org_external_patient_idx
  on public.patients (organization_id, source_system, external_patient_id)
  where source_system is not null and external_patient_id is not null;

create index if not exists patients_org_national_id_idx
  on public.patients (organization_id, national_id)
  where national_id is not null;

create index if not exists patients_external_data_gin_idx
  on public.patients using gin (external_data);
