# Supabase Setup

## 1. Create the project

Create a Supabase project in the region closest to the intended healthcare
organization. Do not enter real patient data until contractual, regulatory,
backup and residency requirements are reviewed.

## 2. Apply the migration

Run:

```text
supabase/migrations/202606180001_initial_pacs_schema.sql
```

## 3. Configure the application

Copy `.env.example` to `.env.local` and provide:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
```

The secret key must only be used by server-side administration flows. It must
never be exposed to the browser.

## 4. Bootstrap the first admin

Create the first user in Supabase Auth. The auth trigger creates its profile.
Then run the following in the SQL editor, replacing both placeholders:

```sql
insert into public.organizations (name, slug)
values ('RAI Klinik Goruntuleme', 'rai-klinik')
returning id;

insert into public.organization_members (organization_id, user_id, role)
values (
  'ORGANIZATION_UUID',
  'AUTH_USER_UUID',
  'admin'
);
```

## 5. Storage

The migration creates the private `dicom-originals` bucket. Object keys must
start with the organization UUID:

```text
{organization_id}/{study_uid}/{series_uid}/{sop_uid}.dcm
```

The MVP app uploads original DICOM objects directly from the browser to
Supabase Storage. Next/Vercel prepares the storage key and writes metadata
after the upload succeeds, so large DICOM files do not pass through the
application server.

PostgreSQL stores only study, series and instance metadata, including the
DICOM UIDs, object size, SHA-256 checksum, bucket name and immutable storage
key. The DICOM file bytes stay in Supabase Storage.
