update public.ai_service_providers
set
  default_model = 'qwen-vl-max',
  settings = settings || jsonb_build_object(
    'availableModels',
    jsonb_build_array('qwen-vl-max', 'qwen-vl-plus')
  )
where slug = 'qwen'
  and default_model in ('qwen-vl-max-latest', 'qwen-vl-plus-latest');
