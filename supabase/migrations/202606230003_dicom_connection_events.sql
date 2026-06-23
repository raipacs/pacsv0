do $$
begin
  if not exists (select 1 from pg_type where typname = 'dicom_connection_event_type') then
    create type public.dicom_connection_event_type as enum (
      'association',
      'echo',
      'store',
      'stable_study',
      'import_started',
      'import_completed',
      'import_failed',
      'warning'
    );
  end if;
end $$;

create table if not exists public.dicom_connection_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  event_type public.dicom_connection_event_type not null,
  source text not null default 'orthanc',
  source_ip inet,
  source_ae_title text,
  called_ae_title text,
  modality text,
  study_instance_uid text,
  accession_number text,
  patient_dicom_id text,
  orthanc_id text,
  message text not null,
  status text not null default 'observed',
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists dicom_connection_events_org_occurred_idx
  on public.dicom_connection_events (organization_id, occurred_at desc);

create index if not exists dicom_connection_events_org_branch_occurred_idx
  on public.dicom_connection_events (organization_id, branch_id, occurred_at desc);

create index if not exists dicom_connection_events_org_source_ae_idx
  on public.dicom_connection_events (organization_id, source_ae_title, occurred_at desc);

alter table public.dicom_connection_events enable row level security;

drop policy if exists "Admins view DICOM connection events" on public.dicom_connection_events;
create policy "Admins view DICOM connection events"
on public.dicom_connection_events for select to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

drop policy if exists "Admins manage DICOM connection events" on public.dicom_connection_events;
create policy "Admins manage DICOM connection events"
on public.dicom_connection_events for all to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]))
with check (public.has_organization_role(organization_id, array['admin']::public.app_role[]));
