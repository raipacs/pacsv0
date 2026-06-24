create table if not exists public.external_study_shares (
  id text primary key,
  token text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  study_id uuid not null references public.studies(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists external_study_shares_active_idx
  on public.external_study_shares (id, organization_id, study_id, expires_at)
  where revoked_at is null;

create index if not exists external_study_shares_study_idx
  on public.external_study_shares (organization_id, study_id, created_at desc);

alter table public.external_study_shares enable row level security;

drop policy if exists "Members view external study shares" on public.external_study_shares;
create policy "Members view external study shares"
on public.external_study_shares for select to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = external_study_shares.organization_id
      and m.user_id = auth.uid()
      and m.is_active = true
  )
);

drop policy if exists "Members create external study shares" on public.external_study_shares;
create policy "Members create external study shares"
on public.external_study_shares for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.organization_members m
    where m.organization_id = external_study_shares.organization_id
      and m.user_id = auth.uid()
      and m.is_active = true
  )
);

drop policy if exists "Members revoke external study shares" on public.external_study_shares;
create policy "Members revoke external study shares"
on public.external_study_shares for update to authenticated
using (
  created_by = auth.uid()
  and exists (
    select 1
    from public.organization_members m
    where m.organization_id = external_study_shares.organization_id
      and m.user_id = auth.uid()
      and m.is_active = true
  )
)
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.organization_members m
    where m.organization_id = external_study_shares.organization_id
      and m.user_id = auth.uid()
      and m.is_active = true
  )
);
