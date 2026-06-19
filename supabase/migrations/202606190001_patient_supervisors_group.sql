create table if not exists public.access_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table if not exists public.access_group_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  group_id uuid not null references public.access_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  is_active boolean not null default true,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create table if not exists public.group_table_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  group_id uuid not null references public.access_groups(id) on delete cascade,
  table_name text not null,
  can_select boolean not null default false,
  can_insert boolean not null default false,
  can_update boolean not null default false,
  can_delete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, table_name)
);

create index if not exists access_groups_org_slug_idx
  on public.access_groups (organization_id, slug);

create index if not exists access_group_members_user_idx
  on public.access_group_members (user_id, organization_id)
  where is_active = true;

create index if not exists group_table_permissions_lookup_idx
  on public.group_table_permissions (organization_id, table_name, group_id);

drop trigger if exists access_groups_set_updated_at on public.access_groups;
create trigger access_groups_set_updated_at
before update on public.access_groups
for each row execute function public.set_updated_at();

drop trigger if exists group_table_permissions_set_updated_at on public.group_table_permissions;
create trigger group_table_permissions_set_updated_at
before update on public.group_table_permissions
for each row execute function public.set_updated_at();

create or replace function public.has_group_table_permission(
  target_organization_id uuid,
  target_table_name text,
  requested_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_group_members gm
    join public.access_groups g
      on g.id = gm.group_id
     and g.organization_id = gm.organization_id
     and g.is_active = true
    join public.group_table_permissions p
      on p.group_id = g.id
     and p.organization_id = g.organization_id
    where gm.organization_id = target_organization_id
      and gm.user_id = (select auth.uid())
      and gm.is_active = true
      and p.table_name = target_table_name
      and case requested_action
        when 'select' then p.can_select
        when 'insert' then p.can_insert
        when 'update' then p.can_update
        when 'delete' then p.can_delete
        else false
      end
  );
$$;

alter table public.access_groups enable row level security;
alter table public.access_group_members enable row level security;
alter table public.group_table_permissions enable row level security;

drop policy if exists "Members view access groups" on public.access_groups;
create policy "Members view access groups"
on public.access_groups for select to authenticated
using (public.is_organization_member(organization_id));

drop policy if exists "Admins manage access groups" on public.access_groups;
create policy "Admins manage access groups"
on public.access_groups for all to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]))
with check (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

drop policy if exists "Members view access group memberships" on public.access_group_members;
create policy "Members view access group memberships"
on public.access_group_members for select to authenticated
using (public.is_organization_member(organization_id));

drop policy if exists "Admins manage access group memberships" on public.access_group_members;
create policy "Admins manage access group memberships"
on public.access_group_members for all to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]))
with check (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

drop policy if exists "Members view group table permissions" on public.group_table_permissions;
create policy "Members view group table permissions"
on public.group_table_permissions for select to authenticated
using (public.is_organization_member(organization_id));

drop policy if exists "Admins manage group table permissions" on public.group_table_permissions;
create policy "Admins manage group table permissions"
on public.group_table_permissions for all to authenticated
using (public.has_organization_role(organization_id, array['admin']::public.app_role[]))
with check (public.has_organization_role(organization_id, array['admin']::public.app_role[]));

drop policy if exists "Groups create patients" on public.patients;
create policy "Groups create patients"
on public.patients for insert to authenticated
with check (public.has_group_table_permission(organization_id, 'patients', 'insert'));

drop policy if exists "Groups update patients" on public.patients;
create policy "Groups update patients"
on public.patients for update to authenticated
using (public.has_group_table_permission(organization_id, 'patients', 'update'))
with check (public.has_group_table_permission(organization_id, 'patients', 'update'));

drop policy if exists "Groups delete patients" on public.patients;
create policy "Groups delete patients"
on public.patients for delete to authenticated
using (public.has_group_table_permission(organization_id, 'patients', 'delete'));

insert into public.access_groups (organization_id, name, slug, description)
select id, 'Supervisors', 'supervisors', 'Hasta tablosunda yetkili kullanıcı grubu.'
from public.organizations
where slug = 'rai-klinik'
on conflict (organization_id, slug) do update
set name = excluded.name,
    description = excluded.description,
    is_active = true;

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
  g.organization_id,
  g.id,
  'patients',
  true,
  true,
  true,
  false
from public.access_groups g
where g.slug = 'supervisors'
on conflict (group_id, table_name) do update
set can_select = excluded.can_select,
    can_insert = excluded.can_insert,
    can_update = excluded.can_update,
    can_delete = excluded.can_delete;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  supervisor_group_id uuid;
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update
  set full_name = excluded.full_name;

  if lower(new.email) = 'supervisor@raipacs.com' then
    select id
      into target_organization_id
    from public.organizations
    where slug = 'rai-klinik'
    limit 1;

    if target_organization_id is not null then
      insert into public.organization_members (organization_id, user_id, role, is_active)
      values (target_organization_id, new.id, 'doctor', true)
      on conflict (organization_id, user_id) do update
      set role = excluded.role,
          is_active = true;

      select id
        into supervisor_group_id
      from public.access_groups
      where organization_id = target_organization_id
        and slug = 'supervisors'
      limit 1;

      if supervisor_group_id is not null then
        insert into public.access_group_members (organization_id, group_id, user_id, is_active)
        values (target_organization_id, supervisor_group_id, new.id, true)
        on conflict (group_id, user_id) do update
        set is_active = true;
      end if;
    end if;
  end if;

  return new;
end;
$$;

do $$
declare
  supervisor_user_id uuid;
  target_organization_id uuid;
  supervisor_group_id uuid;
begin
  select id
    into supervisor_user_id
  from auth.users
  where lower(email) = 'supervisor@raipacs.com'
  limit 1;

  select id
    into target_organization_id
  from public.organizations
  where slug = 'rai-klinik'
  limit 1;

  select id
    into supervisor_group_id
  from public.access_groups
  where organization_id = target_organization_id
    and slug = 'supervisors'
  limit 1;

  if supervisor_user_id is not null and target_organization_id is not null then
    insert into public.profiles (id, full_name)
    values (supervisor_user_id, 'supervisor')
    on conflict (id) do update
    set full_name = excluded.full_name;

    insert into public.organization_members (organization_id, user_id, role, is_active)
    values (target_organization_id, supervisor_user_id, 'doctor', true)
    on conflict (organization_id, user_id) do update
    set role = excluded.role,
        is_active = true;

    if supervisor_group_id is not null then
      insert into public.access_group_members (organization_id, group_id, user_id, is_active)
      values (target_organization_id, supervisor_group_id, supervisor_user_id, true)
      on conflict (group_id, user_id) do update
      set is_active = true;
    end if;
  end if;
end $$;
