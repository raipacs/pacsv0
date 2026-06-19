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

create or replace function public.can_group_access_study(
  target_study_id uuid,
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
    from public.studies s
    where s.id = target_study_id
      and public.has_group_table_permission(
        s.organization_id,
        'studies',
        requested_action
      )
  );
$$;

create or replace function public.doctor_can_access_study(target_study_id uuid)
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
        or public.has_group_table_permission(s.organization_id, 'studies', 'select')
        or exists (
          select 1
          from public.study_assignments a
          where a.study_id = s.id
            and a.doctor_id = (select auth.uid())
        )
      )
  );
$$;

drop policy if exists "Groups create studies" on public.studies;
create policy "Groups create studies"
on public.studies for insert to authenticated
with check (public.has_group_table_permission(organization_id, 'studies', 'insert'));

drop policy if exists "Groups update studies" on public.studies;
create policy "Groups update studies"
on public.studies for update to authenticated
using (public.has_group_table_permission(organization_id, 'studies', 'update'))
with check (public.has_group_table_permission(organization_id, 'studies', 'update'));

drop policy if exists "Groups delete studies" on public.studies;
create policy "Groups delete studies"
on public.studies for delete to authenticated
using (public.has_group_table_permission(organization_id, 'studies', 'delete'));

drop policy if exists "Groups create series" on public.series;
create policy "Groups create series"
on public.series for insert to authenticated
with check (public.has_group_table_permission(organization_id, 'series', 'insert'));

drop policy if exists "Groups update series" on public.series;
create policy "Groups update series"
on public.series for update to authenticated
using (public.has_group_table_permission(organization_id, 'series', 'update'))
with check (public.has_group_table_permission(organization_id, 'series', 'update'));

drop policy if exists "Groups delete series" on public.series;
create policy "Groups delete series"
on public.series for delete to authenticated
using (public.has_group_table_permission(organization_id, 'series', 'delete'));

drop policy if exists "Groups create instances" on public.instances;
create policy "Groups create instances"
on public.instances for insert to authenticated
with check (public.has_group_table_permission(organization_id, 'instances', 'insert'));

drop policy if exists "Groups update instances" on public.instances;
create policy "Groups update instances"
on public.instances for update to authenticated
using (public.has_group_table_permission(organization_id, 'instances', 'update'))
with check (public.has_group_table_permission(organization_id, 'instances', 'update'));

drop policy if exists "Groups delete instances" on public.instances;
create policy "Groups delete instances"
on public.instances for delete to authenticated
using (public.has_group_table_permission(organization_id, 'instances', 'delete'));

drop policy if exists "Groups create assignments" on public.study_assignments;
create policy "Groups create assignments"
on public.study_assignments for insert to authenticated
with check (public.has_group_table_permission(organization_id, 'study_assignments', 'insert'));

drop policy if exists "Groups update assignments" on public.study_assignments;
create policy "Groups update assignments"
on public.study_assignments for update to authenticated
using (public.has_group_table_permission(organization_id, 'study_assignments', 'update'))
with check (public.has_group_table_permission(organization_id, 'study_assignments', 'update'));

drop policy if exists "Groups delete assignments" on public.study_assignments;
create policy "Groups delete assignments"
on public.study_assignments for delete to authenticated
using (public.has_group_table_permission(organization_id, 'study_assignments', 'delete'));

drop policy if exists "Groups create reports" on public.reports;
create policy "Groups create reports"
on public.reports for insert to authenticated
with check (public.has_group_table_permission(organization_id, 'reports', 'insert'));

drop policy if exists "Groups update reports" on public.reports;
create policy "Groups update reports"
on public.reports for update to authenticated
using (public.has_group_table_permission(organization_id, 'reports', 'update'))
with check (public.has_group_table_permission(organization_id, 'reports', 'update'));

drop policy if exists "Groups delete reports" on public.reports;
create policy "Groups delete reports"
on public.reports for delete to authenticated
using (public.has_group_table_permission(organization_id, 'reports', 'delete'));

drop policy if exists "Groups view audit logs" on public.audit_logs;
create policy "Groups view audit logs"
on public.audit_logs for select to authenticated
using (public.has_group_table_permission(organization_id, 'audit_logs', 'select'));

drop policy if exists "Groups upload DICOM objects" on storage.objects;
create policy "Groups upload DICOM objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'dicom-originals'
  and public.has_group_table_permission(
    ((storage.foldername(name))[1])::uuid,
    'instances',
    'insert'
  )
);

drop policy if exists "Groups update DICOM objects" on storage.objects;
create policy "Groups update DICOM objects"
on storage.objects for update to authenticated
using (
  bucket_id = 'dicom-originals'
  and public.has_group_table_permission(
    ((storage.foldername(name))[1])::uuid,
    'instances',
    'update'
  )
)
with check (
  bucket_id = 'dicom-originals'
  and public.has_group_table_permission(
    ((storage.foldername(name))[1])::uuid,
    'instances',
    'update'
  )
);

insert into public.access_groups (organization_id, name, slug, description)
select id, 'Doctors', 'doctors', 'Klinik veri tablolarinda silme haric admin yetkilerine yakin doktor grubu.'
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
  permission.table_name,
  true,
  permission.can_insert,
  permission.can_update,
  false
from public.access_groups g
cross join (
  values
    ('patients', true, true),
    ('studies', true, true),
    ('series', true, true),
    ('instances', true, true),
    ('study_assignments', true, true),
    ('reports', true, true),
    ('audit_logs', false, false)
) as permission(table_name, can_insert, can_update)
where g.slug = 'doctors'
on conflict (group_id, table_name) do update
set can_select = excluded.can_select,
    can_insert = excluded.can_insert,
    can_update = excluded.can_update,
    can_delete = false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_group_slug text;
  target_group_id uuid;
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update
  set full_name = excluded.full_name;

  target_group_slug := case lower(new.email)
    when 'supervisor@raipacs.com' then 'supervisors'
    when 'doctor@raipacs.com' then 'doctors'
    else null
  end;

  if target_group_slug is not null then
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
        into target_group_id
      from public.access_groups
      where organization_id = target_organization_id
        and slug = target_group_slug
      limit 1;

      if target_group_id is not null then
        insert into public.access_group_members (organization_id, group_id, user_id, is_active)
        values (target_organization_id, target_group_id, new.id, true)
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
  target_organization_id uuid;
  account record;
  target_group_id uuid;
begin
  select id
    into target_organization_id
  from public.organizations
  where slug = 'rai-klinik'
  limit 1;

  if target_organization_id is null then
    return;
  end if;

  for account in
    select *
    from (
      values
        ('supervisor@raipacs.com', 'supervisor', 'supervisors'),
        ('doctor@raipacs.com', 'doctor', 'doctors')
    ) as account(email, full_name, group_slug)
  loop
    select id
      into target_group_id
    from public.access_groups
    where organization_id = target_organization_id
      and slug = account.group_slug
    limit 1;

    insert into public.profiles (id, full_name)
    select u.id, account.full_name
    from auth.users u
    where lower(u.email) = account.email
    on conflict (id) do update
    set full_name = excluded.full_name;

    insert into public.organization_members (organization_id, user_id, role, is_active)
    select target_organization_id, u.id, 'doctor', true
    from auth.users u
    where lower(u.email) = account.email
    on conflict (organization_id, user_id) do update
    set role = excluded.role,
        is_active = true;

    if target_group_id is not null then
      insert into public.access_group_members (organization_id, group_id, user_id, is_active)
      select target_organization_id, target_group_id, u.id, true
      from auth.users u
      where lower(u.email) = account.email
      on conflict (group_id, user_id) do update
      set is_active = true;
    end if;
  end loop;
end $$;
