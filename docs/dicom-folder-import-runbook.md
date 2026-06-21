# DICOM Folder Import Runbook

This runbook records the safe repeatable path for importing trusted DICOM
export folders into RAI PACS when the browser folder picker is not practical.

Do not store patient identifiers, passwords, access tokens or Supabase secret
keys in this repository.

## Current operating rule

- Keep the dedicated importer Auth account in Supabase.
- Keep its organization membership and access-group membership inactive while
  no import is running.
- Reactivate it only for a planned import window.
- Deactivate it immediately after the import finishes.
- Do not use the Supabase service-role key for routine imports.

The direct import script writes through Supabase Auth, Storage and PostgREST.
With the current RLS shape, the importer must be temporarily active with the
`admin` organization role. This is different from the browser upload flow,
which goes through application server actions.

## Reactivate importer

Run this in the Supabase SQL Editor before an import:

```sql
update public.organization_members
set role = 'admin',
    is_active = true
where user_id = (
    select id from auth.users where lower(email) = lower('IMPORTER_EMAIL')
  )
  and organization_id = (
    select id from public.organizations where slug = 'rai-klinik'
  );

update public.access_group_members
set is_active = true
where user_id = (
    select id from auth.users where lower(email) = lower('IMPORTER_EMAIL')
  )
  and organization_id = (
    select id from public.organizations where slug = 'rai-klinik'
  );
```

## Run import

Use the publishable key from Supabase Dashboard > Connect. Do not commit it to
the repository if copied into a shell.

```bash
RAI_PACS_SUPABASE_URL="https://api.raipacs.com" \
RAI_PACS_SUPABASE_PUBLISHABLE_KEY="SUPABASE_PUBLISHABLE_KEY" \
RAI_PACS_IMPORT_EMAIL="IMPORTER_EMAIL" \
RAI_PACS_IMPORT_PASSWORD="IMPORTER_PASSWORD" \
RAI_PACS_DICOM_DIR="/absolute/path/to/DICOMOBJ" \
npm run import:dicom-folder
```

The script:

- reads files in the provided folder, including extensionless DICOM files
- validates the `DICM` preamble
- extracts patient, study, series and instance metadata from DICOM headers
- creates or updates the patient by DICOM Patient ID
- stores original files in the private `dicom-originals` bucket
- writes metadata to `studies`, `series` and `instances`
- treats existing Storage objects as safe idempotent retries

Expected Storage key:

```text
{organization_id}/{study_instance_uid}/{series_instance_uid}/{sop_instance_uid}.dcm
```

## Deactivate importer

Run this immediately after the import:

```sql
update public.organization_members
set is_active = false
where user_id = (
    select id from auth.users where lower(email) = lower('IMPORTER_EMAIL')
  )
  and organization_id = (
    select id from public.organizations where slug = 'rai-klinik'
  );

update public.access_group_members
set is_active = false
where user_id = (
    select id from auth.users where lower(email) = lower('IMPORTER_EMAIL')
  )
  and organization_id = (
    select id from public.organizations where slug = 'rai-klinik'
  );

select u.email, m.role, m.is_active as member_active
from auth.users u
left join public.organization_members m on m.user_id = u.id
where lower(u.email) = lower('IMPORTER_EMAIL');
```

The final check should show `member_active = false`.

## Verification

After import, verify:

- Worklist shows the imported studies.
- Patient list shows the patient and study count.
- Patient detail shows the expected Storage instances.
- Each instance has a signed URL action.
- Supabase Storage contains objects under the organization UUID prefix.

## Follow-up hardening

Reduce the need for temporary admin by adding a server-side ingestion endpoint
or tightening the group RLS policies so the direct importer can run with the
Doctors group only.
