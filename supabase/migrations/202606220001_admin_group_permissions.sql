insert into public.access_groups (
  organization_id,
  name,
  slug,
  description,
  is_active
)
select
  o.id,
  'Admin',
  'admin',
  'Kurum yoneticileri icin tam yonetim grubu.',
  true
from public.organizations o
on conflict (organization_id, slug) do update
set name = excluded.name,
    description = excluded.description,
    is_active = true;

insert into public.access_group_members (
  organization_id,
  group_id,
  user_id,
  is_active
)
select
  m.organization_id,
  g.id,
  m.user_id,
  true
from public.organization_members m
join public.access_groups g
  on g.organization_id = m.organization_id
 and g.slug = 'admin'
where m.role = 'admin'
  and m.is_active = true
on conflict (group_id, user_id) do update
set is_active = true;

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
  true,
  true,
  true
from public.access_groups g
cross join (
  values
    ('patients'),
    ('studies'),
    ('series'),
    ('instances'),
    ('study_assignments'),
    ('reports'),
    ('access_groups'),
    ('access_group_members'),
    ('group_table_permissions'),
    ('organization_members'),
    ('audit_logs')
) as permission(table_name)
where g.slug = 'admin'
on conflict (group_id, table_name) do update
set can_select = true,
    can_insert = true,
    can_update = true,
    can_delete = true;
