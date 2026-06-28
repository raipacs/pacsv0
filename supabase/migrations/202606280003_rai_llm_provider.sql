insert into public.ai_service_providers (
  organization_id,
  name,
  slug,
  provider_type,
  default_model,
  is_active,
  is_default,
  requires_credentials,
  credential_reference,
  settings
)
select
  organizations.id,
  'RAI LLM',
  'rai-llm',
  'custom',
  'Qwen/Qwen2.5-VL-7B-Instruct',
  false,
  false,
  true,
  'RAI_LLM_ENDPOINT',
  '{
    "purpose": "rai-owned-medical-vlm-report-draft",
    "family": "rai-llm",
    "baseModel": "Qwen/Qwen2.5-VL-7B-Instruct",
    "baseLicense": "apache-2.0",
    "deployment": "self-hosted-openai-compatible-endpoint",
    "endpointEnv": "RAI_LLM_ENDPOINT",
    "apiKeyEnv": "RAI_LLM_API_KEY",
    "endpointModeEnv": "RAI_LLM_ENDPOINT_MODE",
    "supportedEndpointModes": ["openai-compatible", "rai-adapter"],
    "modalities": ["DX", "CT", "MR", "US", "SR"],
    "notes": "RAI-owned model line. Starts from an open multimodal base and can be fine-tuned with RAI curated radiology data."
  }'::jsonb
from public.organizations
on conflict (organization_id, slug) do update
set
  name = excluded.name,
  provider_type = excluded.provider_type,
  default_model = excluded.default_model,
  requires_credentials = excluded.requires_credentials,
  credential_reference = coalesce(public.ai_service_providers.credential_reference, excluded.credential_reference),
  settings = public.ai_service_providers.settings || excluded.settings;
