create table if not exists public.ai_service_providers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  provider_type text not null check (provider_type in ('mock', 'openai', 'anthropic', 'google', 'custom')),
  default_model text,
  is_active boolean not null default false,
  is_default boolean not null default false,
  requires_credentials boolean not null default true,
  credential_reference text,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table if not exists public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  study_id uuid not null references public.studies(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  provider_id uuid references public.ai_service_providers(id) on delete set null,
  provider_slug text not null,
  model_name text,
  status text not null default 'queued' check (
    status in ('queued', 'running', 'draft_ready', 'waiting_credentials', 'failed', 'cancelled')
  ),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'urgent')),
  input_context jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_report_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  study_id uuid not null references public.studies(id) on delete cascade,
  job_id uuid not null references public.ai_jobs(id) on delete cascade,
  status text not null default 'ready' check (status in ('ready', 'reviewing', 'accepted', 'rejected')),
  findings text not null,
  impression text not null,
  recommendations text,
  confidence_score numeric(4, 3) check (confidence_score is null or confidence_score between 0 and 1),
  criticality text not null default 'none' check (criticality in ('none', 'low', 'medium', 'high')),
  source_summary jsonb not null default '{}'::jsonb,
  accepted_report_id uuid references public.reports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_service_providers_org_idx
  on public.ai_service_providers (organization_id, is_active, is_default);

create index if not exists ai_jobs_study_created_idx
  on public.ai_jobs (study_id, created_at desc);

create index if not exists ai_jobs_status_idx
  on public.ai_jobs (organization_id, status, created_at desc);

create index if not exists ai_report_drafts_study_created_idx
  on public.ai_report_drafts (study_id, created_at desc);

drop trigger if exists ai_service_providers_set_updated_at on public.ai_service_providers;
create trigger ai_service_providers_set_updated_at
before update on public.ai_service_providers
for each row execute function public.set_updated_at();

drop trigger if exists ai_jobs_set_updated_at on public.ai_jobs;
create trigger ai_jobs_set_updated_at
before update on public.ai_jobs
for each row execute function public.set_updated_at();

drop trigger if exists ai_report_drafts_set_updated_at on public.ai_report_drafts;
create trigger ai_report_drafts_set_updated_at
before update on public.ai_report_drafts
for each row execute function public.set_updated_at();

alter table public.ai_service_providers enable row level security;
alter table public.ai_jobs enable row level security;
alter table public.ai_report_drafts enable row level security;

drop policy if exists "Members view AI providers" on public.ai_service_providers;
create policy "Members view AI providers"
on public.ai_service_providers for select to authenticated
using (public.is_organization_member(organization_id));

drop policy if exists "Admins manage AI providers" on public.ai_service_providers;
create policy "Admins manage AI providers"
on public.ai_service_providers for all to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]))
with check (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

drop policy if exists "Members view AI jobs" on public.ai_jobs;
create policy "Members view AI jobs"
on public.ai_jobs for select to authenticated
using (public.is_organization_member(organization_id));

drop policy if exists "Authorized users create AI jobs" on public.ai_jobs;
create policy "Authorized users create AI jobs"
on public.ai_jobs for insert to authenticated
with check (
  requested_by = auth.uid()
  and public.is_organization_member(organization_id)
);

drop policy if exists "Admins update AI jobs" on public.ai_jobs;
create policy "Admins update AI jobs"
on public.ai_jobs for update to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]))
with check (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

drop policy if exists "Members view AI drafts" on public.ai_report_drafts;
create policy "Members view AI drafts"
on public.ai_report_drafts for select to authenticated
using (public.is_organization_member(organization_id));

drop policy if exists "Report writers create AI drafts" on public.ai_report_drafts;
create policy "Report writers create AI drafts"
on public.ai_report_drafts for insert to authenticated
with check (
  public.has_organization_role(organization_id, array['admin']::public.app_role[])
  or public.has_group_table_permission(organization_id, 'reports', 'insert')
);

drop policy if exists "Report writers update AI drafts" on public.ai_report_drafts;
create policy "Report writers update AI drafts"
on public.ai_report_drafts for update to authenticated
using (
  public.has_organization_role(organization_id, array['admin']::public.app_role[])
  or public.has_group_table_permission(organization_id, 'reports', 'update')
)
with check (
  public.has_organization_role(organization_id, array['admin']::public.app_role[])
  or public.has_group_table_permission(organization_id, 'reports', 'update')
);

insert into public.ai_service_providers (
  organization_id,
  name,
  slug,
  provider_type,
  default_model,
  is_active,
  is_default,
  requires_credentials,
  settings
)
select
  organizations.id,
  provider.name,
  provider.slug,
  provider.provider_type,
  provider.default_model,
  provider.is_active,
  provider.is_default,
  provider.requires_credentials,
  provider.settings
from public.organizations
cross join (
  values
    (
      'RAI Mock AI',
      'rai-mock',
      'mock',
      'rai-mock-radiology-v0',
      true,
      true,
      false,
      '{"purpose":"development","modalities":["DX","CT","MR","SR"]}'::jsonb
    ),
    (
      'OpenAI',
      'openai',
      'openai',
      'gpt-5.1',
      false,
      false,
      true,
      '{"purpose":"llm-report-draft"}'::jsonb
    ),
    (
      'Claude',
      'claude',
      'anthropic',
      'claude-opus-4.5',
      false,
      false,
      true,
      '{"purpose":"llm-report-draft"}'::jsonb
    ),
    (
      'Gemini',
      'gemini',
      'google',
      'gemini-3-pro',
      false,
      false,
      true,
      '{"purpose":"llm-report-draft"}'::jsonb
    )
) as provider(name, slug, provider_type, default_model, is_active, is_default, requires_credentials, settings)
on conflict (organization_id, slug) do update
set
  name = excluded.name,
  provider_type = excluded.provider_type,
  default_model = excluded.default_model,
  requires_credentials = excluded.requires_credentials,
  settings = excluded.settings;

insert into public.group_table_permissions (
  organization_id,
  group_id,
  table_name,
  can_select,
  can_insert,
  can_update,
  can_delete
)
select
  access_groups.organization_id,
  access_groups.id,
  table_name,
  true,
  access_groups.slug in ('admin', 'doctors', 'supervisors'),
  access_groups.slug in ('admin', 'doctors', 'supervisors'),
  access_groups.slug = 'admin'
from public.access_groups
cross join (
  values
    ('ai_service_providers'),
    ('ai_jobs'),
    ('ai_report_drafts')
) as permission_tables(table_name)
on conflict (group_id, table_name) do update
set
  can_select = excluded.can_select,
  can_insert = excluded.can_insert,
  can_update = excluded.can_update,
  can_delete = excluded.can_delete;
