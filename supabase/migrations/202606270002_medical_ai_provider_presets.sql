insert into public.ai_service_providers (
  organization_id,
  name,
  slug,
  provider_type,
  default_model,
  is_active,
  is_default,
  requires_credentials,
  settings
)
select
  organizations.id,
  provider.name,
  provider.slug,
  provider.provider_type,
  provider.default_model,
  provider.is_active,
  provider.is_default,
  provider.requires_credentials,
  provider.settings
from public.organizations
cross join (
  values
    (
      'MedGemma',
      'medgemma',
      'custom',
      'medgemma-4b-it',
      false,
      false,
      true,
      '{
        "purpose": "medical-vlm-report-draft",
        "family": "medgemma",
        "provider": "google",
        "deployment": "custom-endpoint",
        "modalities": ["DX", "CT", "MR", "US", "SR"],
        "availableModels": ["medgemma-4b-it", "medgemma-27b-text-it"],
        "notes": "Endpoint/credential baglaninca manuel AI butonu ile calistirilacak."
      }'::jsonb
    ),
    (
      'RaDialog',
      'radialog',
      'custom',
      'radialog-v1',
      false,
      false,
      true,
      '{
        "purpose": "radiology-dialog-report-draft",
        "family": "radialog",
        "deployment": "custom-endpoint",
        "modalities": ["DX", "CT", "MR", "US"],
        "availableModels": ["radialog-v1"],
        "notes": "Radyoloji odakli ozel model endpointi baglaninca aktif edilecek."
      }'::jsonb
    )
) as provider(name, slug, provider_type, default_model, is_active, is_default, requires_credentials, settings)
on conflict (organization_id, slug) do update
set
  name = excluded.name,
  provider_type = excluded.provider_type,
  default_model = excluded.default_model,
  requires_credentials = excluded.requires_credentials,
  settings = excluded.settings;
