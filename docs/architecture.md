# RAI PACS Architecture

## Data boundaries

PostgreSQL stores structured and searchable metadata:

- organizations and memberships
- patients and demographics
- studies, series and instances
- assignments and reports
- audit events

The private `dicom-originals` object-storage bucket stores original DICOM
objects. PostgreSQL stores the immutable storage key, byte size, transfer
syntax and SHA-256 checksum.

## Object key convention

```text
{organization_id}/{study_instance_uid}/{series_instance_uid}/{sop_instance_uid}.dcm
```

The organization UUID is the first path segment so Storage RLS can enforce
tenant isolation without trusting browser input.

## Roles

### Admin

- manages members and roles
- creates and updates patients
- ingests DICOM objects
- assigns studies
- views organization audit records

### Doctor

- sees assigned studies
- sees patients related to assigned studies
- creates and finalizes reports

## Deployment

The current GitHub Pages site remains the public prototype. The Next.js
application should be deployed to Vercel after Supabase environment variables
are configured. Then `app.raipacs.com` can be moved from GitHub Pages to the
Vercel project without changing the application URL.
