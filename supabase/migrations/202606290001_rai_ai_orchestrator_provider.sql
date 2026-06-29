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
  'RAI AI Orchestrator',
  'rai-orchestrator',
  'custom',
  'rai-ai-orchestrator-v0',
  true,
  false,
  false,
  null,
  '{
    "purpose": "route-ai-pre-report-to-best-available-provider",
    "family": "rai-ai-orchestrator",
    "routerVersion": "v0",
    "fallbackPolicy": "first-active-runnable-provider",
    "priority": ["rai-llm", "openai", "gemini-google", "claude", "medgemma", "rai-mock"],
    "notes": "Manual AI button starts this provider; it routes to the first active provider with runnable credentials or endpoint."
  }'::jsonb
from public.organizations
on conflict (organization_id, slug) do update
set
  name = excluded.name,
  provider_type = excluded.provider_type,
  default_model = excluded.default_model,
  is_active = excluded.is_active,
  requires_credentials = excluded.requires_credentials,
  credential_reference = excluded.credential_reference,
  settings = public.ai_service_providers.settings || excluded.settings;
