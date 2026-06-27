update public.ai_service_providers
set
  credential_reference = coalesce(nullif(credential_reference, ''), 'RAI_MEDGEMMA_ENDPOINT'),
  settings = settings || '{
    "adapter": "medgemma-endpoint",
    "endpointEnv": "RAI_MEDGEMMA_ENDPOINT",
    "apiKeyEnv": "RAI_MEDGEMMA_API_KEY",
    "endpointModeEnv": "RAI_MEDGEMMA_ENDPOINT_MODE",
    "supportedEndpointModes": ["rai-adapter", "openai-compatible"],
    "dicomReferenceTtlSeconds": 900,
    "maxDicomReferencesPerJob": 8
  }'::jsonb
where slug = 'medgemma';
