insert into public.branches (organization_id, name, slug, code, is_main, is_active)
select id, 'Dev', 'dev', 'DEV', false, true
from public.organizations
on conflict (organization_id, slug) do update
set name = excluded.name,
    code = excluded.code,
    is_active = true;

insert into public.branches (organization_id, name, slug, code, is_main, is_active)
select id, 'Kosova', 'kosova', 'KOSOVA', false, true
from public.organizations
on conflict (organization_id, slug) do update
set name = excluded.name,
    code = excluded.code,
    is_active = true;

create table if not exists public.organization_member_branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  is_active boolean not null default true,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, branch_id)
);

create index if not exists organization_member_branches_user_idx
  on public.organization_member_branches (organization_id, user_id, is_active);

create index if not exists organization_member_branches_branch_idx
  on public.organization_member_branches (organization_id, branch_id, is_active);

drop trigger if exists organization_member_branches_set_updated_at
on public.organization_member_branches;
create trigger organization_member_branches_set_updated_at
before update on public.organization_member_branches
for each row execute function public.set_updated_at();

alter table public.organization_member_branches enable row level security;

drop policy if exists "Members view branch authorizations"
on public.organization_member_branches;
create policy "Members view branch authorizations"
on public.organization_member_branches for select to authenticated
using (
  user_id = (select auth.uid())
  or public.has_organization_role(organization_id, array['admin']::public.app_role[])
);

drop policy if exists "Admins manage branch authorizations"
on public.organization_member_branches;
create policy "Admins manage branch authorizations"
on public.organization_member_branches for all to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]))
with check (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

create or replace function public.has_branch_access(
  target_organization_id uuid,
  target_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_branch_id is null
    or public.has_organization_role(target_organization_id, array['admin']::public.app_role[])
    or exists (
      select 1
      from public.organization_member_branches access
      where access.organization_id = target_organization_id
        and access.user_id = (select auth.uid())
        and access.branch_id = target_branch_id
        and access.is_active = true
    )
    or exists (
      select 1
      from public.organization_members member
      where member.organization_id = target_organization_id
        and member.user_id = (select auth.uid())
        and member.branch_id = target_branch_id
        and member.is_active = true
    );
$$;

drop policy if exists "Members view branches in their organization"
on public.branches;

drop policy if exists "Members view authorized branches"
on public.branches;
create policy "Members view authorized branches"
on public.branches for select to authenticated
using (public.has_branch_access(organization_id, id));

insert into public.organization_member_branches (
  organization_id,
  user_id,
  branch_id,
  is_active
)
select
  member.organization_id,
  member.user_id,
  member.branch_id,
  true
from public.organization_members member
where member.branch_id is not null
on conflict (organization_id, user_id, branch_id) do update
set is_active = true;

update public.organization_members member
set branch_id = branch.id
from public.branches branch
where member.organization_id = branch.organization_id
  and member.role = 'admin'
  and branch.slug = 'dev';

insert into public.organization_member_branches (
  organization_id,
  user_id,
  branch_id,
  is_active
)
select
  member.organization_id,
  member.user_id,
  branch.id,
  true
from public.organization_members member
join public.branches branch
  on branch.organization_id = member.organization_id
 and branch.slug = 'dev'
where member.role = 'admin'
on conflict (organization_id, user_id, branch_id) do update
set is_active = true;
