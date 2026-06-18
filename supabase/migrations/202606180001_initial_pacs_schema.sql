create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'doctor');
create type public.patient_sex as enum ('F', 'M', 'O', 'U');
create type public.study_priority as enum ('stat', 'urgent', 'routine', 'follow_up');
create type public.study_status as enum (
  'received',
  'ready',
  'assigned',
  'reporting',
  'final',
  'cancelled'
);
create type public.report_status as enum ('draft', 'preliminary', 'final', 'amended');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  patient_number text not null,
  first_name text not null,
  last_name text not null,
  birth_date date,
  sex public.patient_sex not null default 'U',
  national_id_ciphertext bytea,
  phone text,
  email text,
  address jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, patient_number)
);

create table public.studies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  study_instance_uid text not null,
  accession_number text not null,
  modality text not null,
  body_part text,
  description text,
  referring_physician text,
  study_at timestamptz,
  priority public.study_priority not null default 'routine',
  status public.study_status not null default 'received',
  source_ae_title text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, study_instance_uid),
  unique (organization_id, accession_number)
);

create table public.series (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  study_id uuid not null references public.studies(id) on delete cascade,
  series_instance_uid text not null,
  series_number integer,
  modality text not null,
  description text,
  instance_count integer not null default 0 check (instance_count >= 0),
  created_at timestamptz not null default now(),
  unique (organization_id, series_instance_uid)
);

create table public.instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  study_id uuid not null references public.studies(id) on delete cascade,
  series_id uuid not null references public.series(id) on delete cascade,
  sop_instance_uid text not null,
  sop_class_uid text,
  transfer_syntax_uid text,
  instance_number integer,
  storage_bucket text not null default 'dicom-originals',
  storage_key text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, sop_instance_uid),
  unique (storage_bucket, storage_key)
);

create table public.study_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  study_id uuid not null references public.studies(id) on delete cascade,
  doctor_id uuid not null references auth.users(id) on delete restrict,
  assigned_by uuid references auth.users(id),
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (study_id, doctor_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  study_id uuid not null references public.studies(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  status public.report_status not null default 'draft',
  findings text,
  impression text,
  version integer not null default 1 check (version > 0),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index patients_org_name_idx
  on public.patients (organization_id, last_name, first_name);
create index studies_org_status_date_idx
  on public.studies (organization_id, status, study_at desc);
create index studies_patient_date_idx
  on public.studies (patient_id, study_at desc);
create index series_study_idx on public.series (study_id, series_number);
create index instances_series_idx on public.instances (series_id, instance_number);
create index assignments_doctor_idx
  on public.study_assignments (doctor_id, completed_at, assigned_at desc);
create index reports_study_version_idx
  on public.reports (study_id, version desc);
create index audit_org_created_idx
  on public.audit_logs (organization_id, created_at desc);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger patients_set_updated_at
before update on public.patients
for each row execute function public.set_updated_at();

create trigger studies_set_updated_at
before update on public.studies
for each row execute function public.set_updated_at();

create trigger reports_set_updated_at
before update on public.reports
for each row execute function public.set_updated_at();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = target_organization_id
      and user_id = (select auth.uid())
      and is_active = true
  );
$$;

create function public.has_organization_role(
  target_organization_id uuid,
  allowed_roles public.app_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = target_organization_id
      and user_id = (select auth.uid())
      and role = any(allowed_roles)
      and is_active = true
  );
$$;

create function public.doctor_can_access_study(target_study_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.studies s
    join public.organization_members m
      on m.organization_id = s.organization_id
     and m.user_id = (select auth.uid())
     and m.is_active = true
    where s.id = target_study_id
      and (
        m.role = 'admin'
        or exists (
          select 1
          from public.study_assignments a
          where a.study_id = s.id
            and a.doctor_id = (select auth.uid())
        )
      )
  );
$$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.patients enable row level security;
alter table public.studies enable row level security;
alter table public.series enable row level security;
alter table public.instances enable row level security;
alter table public.study_assignments enable row level security;
alter table public.reports enable row level security;
alter table public.audit_logs enable row level security;

create policy "Members can view their organizations"
on public.organizations for select to authenticated
using (public.is_organization_member(id));

create policy "Users can view own profile"
on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy "Users can update own profile"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "Members can view memberships in their organization"
on public.organization_members for select to authenticated
using (public.is_organization_member(organization_id));

create policy "Admins manage organization memberships"
on public.organization_members for all to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]))
with check (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

create policy "Members view patients in their organization"
on public.patients for select to authenticated
using (public.is_organization_member(organization_id));

create policy "Admins manage patients"
on public.patients for all to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]))
with check (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

create policy "Doctors update assigned patient records"
on public.patients for update to authenticated
using (
  public.has_organization_role(organization_id, array['doctor']::public.app_role[])
  and exists (
    select 1
    from public.studies s
    join public.study_assignments a on a.study_id = s.id
    where s.patient_id = patients.id
      and a.doctor_id = (select auth.uid())
  )
)
with check (public.is_organization_member(organization_id));

create policy "Authorized users view studies"
on public.studies for select to authenticated
using (public.doctor_can_access_study(id));

create policy "Admins manage studies"
on public.studies for all to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]))
with check (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

create policy "Authorized users view series"
on public.series for select to authenticated
using (public.doctor_can_access_study(study_id));

create policy "Admins manage series"
on public.series for all to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]))
with check (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

create policy "Authorized users view instances"
on public.instances for select to authenticated
using (public.doctor_can_access_study(study_id));

create policy "Admins manage instances"
on public.instances for all to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]))
with check (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

create policy "Members view assignments"
on public.study_assignments for select to authenticated
using (
  public.has_organization_role(organization_id, array['admin']::public.app_role[])
  or doctor_id = (select auth.uid())
);

create policy "Admins manage assignments"
on public.study_assignments for all to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]))
with check (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

create policy "Authorized users view reports"
on public.reports for select to authenticated
using (public.doctor_can_access_study(study_id));

create policy "Doctors create reports for assigned studies"
on public.reports for insert to authenticated
with check (
  author_id = (select auth.uid())
  and public.doctor_can_access_study(study_id)
);

create policy "Authors update draft reports"
on public.reports for update to authenticated
using (
  author_id = (select auth.uid())
  and status in ('draft', 'preliminary')
)
with check (
  author_id = (select auth.uid())
  and public.doctor_can_access_study(study_id)
);

create policy "Admins view audit logs"
on public.audit_logs for select to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

insert into storage.buckets (id, name, public, file_size_limit)
values ('dicom-originals', 'dicom-originals', false, 5368709120)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

create policy "Authorized users read DICOM objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'dicom-originals'
  and public.is_organization_member(((storage.foldername(name))[1])::uuid)
);

create policy "Admins upload DICOM objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'dicom-originals'
  and public.has_organization_role(
    ((storage.foldername(name))[1])::uuid,
    array['admin']::public.app_role[]
  )
);

create policy "Admins update DICOM objects"
on storage.objects for update to authenticated
using (
  bucket_id = 'dicom-originals'
  and public.has_organization_role(
    ((storage.foldername(name))[1])::uuid,
    array['admin']::public.app_role[]
  )
)
with check (
  bucket_id = 'dicom-originals'
  and public.has_organization_role(
    ((storage.foldername(name))[1])::uuid,
    array['admin']::public.app_role[]
  )
);

create policy "Admins delete DICOM objects"
on storage.objects for delete to authenticated
using (
  bucket_id = 'dicom-originals'
  and public.has_organization_role(
    ((storage.foldername(name))[1])::uuid,
    array['admin']::public.app_role[]
  )
);
