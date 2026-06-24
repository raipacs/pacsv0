create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.ai_jobs(id) on delete set null,
  study_id uuid references public.studies(id) on delete set null,
  report_id uuid references public.reports(id) on delete set null,
  provider_slug text not null,
  model_name text,
  usage_type text not null default 'pre_report' check (
    usage_type in ('pre_report', 'report_edit', 'final_report', 'admin_test', 'other')
  ),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  total_tokens integer generated always as (input_tokens + output_tokens) stored,
  currency text not null default 'USD',
  input_cost numeric(12, 6) not null default 0,
  output_cost numeric(12, 6) not null default 0,
  total_cost numeric(12, 6) generated always as (input_cost + output_cost) stored,
  pricing_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_events_org_created_idx
  on public.ai_usage_events (organization_id, created_at desc);

create index if not exists ai_usage_events_provider_idx
  on public.ai_usage_events (organization_id, provider_slug, model_name, created_at desc);

create index if not exists ai_usage_events_study_idx
  on public.ai_usage_events (study_id, created_at desc);

alter table public.ai_usage_events enable row level security;

drop policy if exists "Admins view AI usage events" on public.ai_usage_events;
create policy "Admins view AI usage events"
on public.ai_usage_events for select to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

drop policy if exists "Members create AI usage events" on public.ai_usage_events;
create policy "Members create AI usage events"
on public.ai_usage_events for insert to authenticated
with check (
  created_by = auth.uid()
  and public.is_organization_member(organization_id)
);

drop policy if exists "Admins manage AI usage events" on public.ai_usage_events;
create policy "Admins manage AI usage events"
on public.ai_usage_events for update to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]))
with check (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

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
  'ai_usage_events',
  access_groups.slug = 'admin',
  access_groups.slug in ('admin', 'doctors', 'supervisors'),
  access_groups.slug = 'admin',
  access_groups.slug = 'admin'
from public.access_groups
on conflict (group_id, table_name) do update
set
  can_select = excluded.can_select,
  can_insert = excluded.can_insert,
  can_update = excluded.can_update,
  can_delete = excluded.can_delete;
