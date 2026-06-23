create type public.dicom_import_job_status as enum (
  'received',
  'importing',
  'completed',
  'failed',
  'retrying'
);

create table public.dicom_modalities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ae_title text not null,
  modality text not null default 'DICOM',
  description text,
  location text,
  vendor text,
  model text,
  ip_address inet,
  status text not null default 'observed',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_store_at timestamptz,
  last_study_instance_uid text,
  last_accession_number text,
  received_study_count integer not null default 0 check (received_study_count >= 0),
  received_instance_count integer not null default 0 check (received_instance_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, ae_title)
);

create table public.dicom_import_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_key text not null,
  status public.dicom_import_job_status not null default 'received',
  source text not null default 'orthanc',
  source_ae_title text,
  orthanc_study_id text,
  study_instance_uid text,
  accession_number text,
  patient_dicom_id text,
  modality text,
  expected_instances integer not null default 0 check (expected_instances >= 0),
  imported_instances integer not null default 0 check (imported_instances >= 0),
  skipped_instances integer not null default 0 check (skipped_instances >= 0),
  failed_instances integer not null default 0 check (failed_instances >= 0),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, job_key)
);

create index dicom_modalities_org_last_seen_idx
  on public.dicom_modalities (organization_id, last_seen_at desc nulls last);

create index dicom_import_jobs_org_status_seen_idx
  on public.dicom_import_jobs (organization_id, status, last_seen_at desc);

create index dicom_import_jobs_org_study_uid_idx
  on public.dicom_import_jobs (organization_id, study_instance_uid);

create trigger dicom_modalities_set_updated_at
before update on public.dicom_modalities
for each row execute function public.set_updated_at();

create trigger dicom_import_jobs_set_updated_at
before update on public.dicom_import_jobs
for each row execute function public.set_updated_at();

alter table public.dicom_modalities enable row level security;
alter table public.dicom_import_jobs enable row level security;

create policy "Admins view DICOM modalities"
on public.dicom_modalities for select to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

create policy "Admins manage DICOM modalities"
on public.dicom_modalities for all to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]))
with check (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

create policy "Admins view DICOM import jobs"
on public.dicom_import_jobs for select to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

create policy "Admins manage DICOM import jobs"
on public.dicom_import_jobs for all to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]))
with check (public.has_organization_role(organization_id, array['admin']::public.app_role[]));
