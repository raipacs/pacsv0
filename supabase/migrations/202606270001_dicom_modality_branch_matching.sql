alter table public.dicom_modalities
  add column if not exists called_ae_title text;

create index if not exists dicom_modalities_org_branch_match_idx
  on public.dicom_modalities (
    organization_id,
    branch_id,
    ae_title,
    called_ae_title,
    ip_address
  );

update public.dicom_modalities
set ae_title = upper(regexp_replace(trim(ae_title), '\s+', '_', 'g'))
where ae_title <> upper(regexp_replace(trim(ae_title), '\s+', '_', 'g'));

update public.dicom_modalities
set called_ae_title = 'RAIPACS'
where called_ae_title is null;
