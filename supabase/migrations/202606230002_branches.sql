create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  code text,
  is_main boolean not null default false,
  is_active boolean not null default true,
  address jsonb not null default '{}'::jsonb,
  phone text,
  email text,
  timezone text not null default 'Europe/Istanbul',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug),
  unique (organization_id, code)
);

create unique index if not exists branches_one_main_per_org_idx
  on public.branches (organization_id)
  where is_main = true;

create index if not exists branches_org_active_idx
  on public.branches (organization_id, is_active, name);

drop trigger if exists branches_set_updated_at on public.branches;
create trigger branches_set_updated_at
before update on public.branches
for each row execute function public.set_updated_at();

alter table public.branches enable row level security;

drop policy if exists "Members view branches in their organization" on public.branches;
create policy "Members view branches in their organization"
on public.branches for select to authenticated
using (public.is_organization_member(organization_id));

drop policy if exists "Admins manage branches" on public.branches;
create policy "Admins manage branches"
on public.branches for all to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]))
with check (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

insert into public.branches (organization_id, name, slug, code, is_main)
select id, 'Merkez', 'merkez', 'MERKEZ', true
from public.organizations
on conflict (organization_id, slug) do update
set name = excluded.name,
    code = excluded.code,
    is_main = true,
    is_active = true;

alter table public.organization_members
  add column if not exists branch_id uuid references public.branches(id) on delete set null;

alter table public.patients
  add column if not exists branch_id uuid references public.branches(id) on delete restrict;

alter table public.studies
  add column if not exists branch_id uuid references public.branches(id) on delete restrict;

alter table public.dicom_modalities
  add column if not exists branch_id uuid references public.branches(id) on delete set null;

alter table public.dicom_import_jobs
  add column if not exists branch_id uuid references public.branches(id) on delete set null;

update public.organization_members member
set branch_id = branch.id
from public.branches branch
where member.organization_id = branch.organization_id
  and branch.is_main = true
  and member.branch_id is null;

update public.patients patient
set branch_id = branch.id
from public.branches branch
where patient.organization_id = branch.organization_id
  and branch.is_main = true
  and patient.branch_id is null;

update public.studies study
set branch_id = branch.id
from public.branches branch
where study.organization_id = branch.organization_id
  and branch.is_main = true
  and study.branch_id is null;

update public.dicom_modalities modality
set branch_id = branch.id
from public.branches branch
where modality.organization_id = branch.organization_id
  and branch.is_main = true
  and modality.branch_id is null;

update public.dicom_import_jobs job
set branch_id = branch.id
from public.branches branch
where job.organization_id = branch.organization_id
  and branch.is_main = true
  and job.branch_id is null;

create index if not exists organization_members_branch_idx
  on public.organization_members (organization_id, branch_id);

create index if not exists patients_org_branch_idx
  on public.patients (organization_id, branch_id, last_name, first_name);

create index if not exists studies_org_branch_status_date_idx
  on public.studies (organization_id, branch_id, status, study_at desc);

create index if not exists dicom_modalities_org_branch_seen_idx
  on public.dicom_modalities (organization_id, branch_id, last_seen_at desc nulls last);

create index if not exists dicom_import_jobs_org_branch_seen_idx
  on public.dicom_import_jobs (organization_id, branch_id, last_seen_at desc);
