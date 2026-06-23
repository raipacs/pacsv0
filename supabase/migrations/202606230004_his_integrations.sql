do $$
begin
  if not exists (select 1 from pg_type where typname = 'his_integration_protocol') then
    create type public.his_integration_protocol as enum (
      'hl7_v2_mllp',
      'fhir_r4',
      'rest_api',
      'webhook',
      'file_drop'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'his_integration_direction') then
    create type public.his_integration_direction as enum (
      'inbound',
      'outbound',
      'bidirectional'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'his_integration_auth_type') then
    create type public.his_integration_auth_type as enum (
      'none',
      'basic',
      'bearer',
      'oauth2_client_credentials',
      'mutual_tls',
      'vpn'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'his_integration_status') then
    create type public.his_integration_status as enum (
      'draft',
      'active',
      'paused',
      'error'
    );
  end if;
end $$;

create table if not exists public.his_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  name text not null,
  vendor text,
  protocol public.his_integration_protocol not null,
  direction public.his_integration_direction not null default 'bidirectional',
  auth_type public.his_integration_auth_type not null default 'none',
  endpoint_url text,
  host text,
  port integer check (port is null or (port > 0 and port <= 65535)),
  sending_application text,
  sending_facility text,
  receiving_application text,
  receiving_facility text,
  enabled_message_types text[] not null default array[]::text[],
  patient_id_strategy text not null default 'patient_number',
  accession_strategy text not null default 'his_accession',
  timezone text not null default 'Europe/Istanbul',
  status public.his_integration_status not null default 'draft',
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  notes text,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.his_integration_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  integration_id uuid references public.his_integrations(id) on delete cascade,
  event_type text not null,
  direction public.his_integration_direction not null default 'inbound',
  message_type text,
  control_id text,
  patient_number text,
  accession_number text,
  status text not null default 'observed',
  message text not null,
  payload_ref text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists his_integrations_org_status_idx
  on public.his_integrations (organization_id, status, updated_at desc);

create index if not exists his_integrations_org_branch_idx
  on public.his_integrations (organization_id, branch_id, name);

create index if not exists his_integration_events_org_occurred_idx
  on public.his_integration_events (organization_id, occurred_at desc);

create index if not exists his_integration_events_integration_occurred_idx
  on public.his_integration_events (integration_id, occurred_at desc);

drop trigger if exists his_integrations_set_updated_at on public.his_integrations;
create trigger his_integrations_set_updated_at
before update on public.his_integrations
for each row execute function public.set_updated_at();

alter table public.his_integrations enable row level security;
alter table public.his_integration_events enable row level security;

drop policy if exists "Admins view HIS integrations" on public.his_integrations;
create policy "Admins view HIS integrations"
on public.his_integrations for select to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

drop policy if exists "Admins manage HIS integrations" on public.his_integrations;
create policy "Admins manage HIS integrations"
on public.his_integrations for all to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]))
with check (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

drop policy if exists "Admins view HIS integration events" on public.his_integration_events;
create policy "Admins view HIS integration events"
on public.his_integration_events for select to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

drop policy if exists "Admins manage HIS integration events" on public.his_integration_events;
create policy "Admins manage HIS integration events"
on public.his_integration_events for all to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]))
with check (public.has_organization_role(organization_id, array['admin']::public.app_role[]));
