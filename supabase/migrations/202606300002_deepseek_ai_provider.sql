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
  'DeepSeek',
  'deepseek',
  'custom',
  'deepseek-v4-flash',
  false,
  false,
  true,
  'DEEPSEEK_API_KEY',
  '{
    "purpose": "radiology-report-reasoning-quality-control",
    "family": "deepseek",
    "deployment": "deepseek-openai-compatible",
    "defaultBaseUrl": "https://api.deepseek.com/chat/completions",
    "baseUrlEnv": "DEEPSEEK_BASE_URL",
    "modelEnv": "DEEPSEEK_MODEL",
    "modalities": ["SR", "DX", "CT", "MR", "US"],
    "availableModels": ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
    "notes": "DEEPSEEK_API_KEY tanimlaninca rapor metni/reasoning odakli AI provider olarak calistirilir."
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
set settings = settings || '{"priority": ["rai-llm", "qwen", "deepseek", "openai", "gemini-google", "claude", "medgemma", "rai-mock"]}'::jsonb
where slug = 'rai-orchestrator';
