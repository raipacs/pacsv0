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
  'Qwen Vision',
  'qwen',
  'custom',
  'qwen-vl-max',
  false,
  false,
  true,
  'QWEN_API_KEY',
  '{
    "purpose": "vision-language-radiology-pre-report-draft",
    "family": "qwen-vl",
    "deployment": "alibaba-model-studio-openai-compatible",
    "defaultBaseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    "baseUrlEnv": "QWEN_BASE_URL",
    "modelEnv": "QWEN_MODEL",
    "modalities": ["DX", "CT", "MR", "US", "SR"],
    "availableModels": ["qwen-vl-max", "qwen-vl-plus"],
    "notes": "QWEN_API_KEY tanimlaninca manuel AI butonu veya RAI AI Orchestrator ile calistirilir."
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

update public.ai_service_providers
set settings = settings || '{"priority": ["rai-llm", "qwen", "openai", "gemini-google", "claude", "medgemma", "rai-mock"]}'::jsonb
where slug = 'rai-orchestrator';
