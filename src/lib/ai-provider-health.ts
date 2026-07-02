import { createServiceClient, isSupabaseServiceConfigured } from "@/lib/supabase/service"

export type AiProviderHealthStatus = "ok" | "failed" | "skipped"

export type AiProviderHealthResult = {
  checkedAt: string
  elapsedMs: number
  message: string
  model: string | null
  name: string
  providerId?: string
  providerType: string
  slug: string
  status: AiProviderHealthStatus
}

export type AiProviderHealthSummary = {
  checkedAt: string
  failedCount: number
  okCount: number
  results: AiProviderHealthResult[]
  skippedCount: number
  source: string
  totalCount: number
}

type AiProviderHealthRow = {
  credential_reference: string | null
  default_model: string | null
  id: string
  is_active: boolean | null
  name: string
  organization_id: string
  provider_type: string
  requires_credentials: boolean | null
  slug: string
}

type ProviderTestConfig = {
  apiKey?: string
  baseUrl?: string
  credentialReference?: string | null
  model?: string | null
  providerType: string
  slug: string
}

const healthCheckPrompt =
  'RAI PACS AI provider health check. Return only JSON: {"status":"ok","message":"provider reachable"}'

export async function runAiProviderHealthCheck({
  includeInactive = false,
  source = "manual",
}: {
  includeInactive?: boolean
  source?: string
} = {}): Promise<AiProviderHealthSummary> {
  const checkedAt = new Date().toISOString()

  if (!isSupabaseServiceConfigured()) {
    return buildSummary({
      checkedAt,
      results: [
        {
          checkedAt,
          elapsedMs: 0,
          message: "Supabase service key tanımlı değil; AI provider listesi okunamadı.",
          model: null,
          name: "Supabase",
          providerType: "database",
          slug: "supabase",
          status: "failed",
        },
      ],
      source,
    })
  }

  const supabase = createServiceClient()
  const query = supabase
    .from("ai_service_providers")
    .select(
      "id, organization_id, name, slug, provider_type, default_model, is_active, requires_credentials, credential_reference"
    )
    .order("name", { ascending: true })

  if (!includeInactive) query.eq("is_active", true)

  const { data, error } = await query

  if (error) {
    return buildSummary({
      checkedAt,
      results: [
        {
          checkedAt,
          elapsedMs: 0,
          message: `AI provider listesi okunamadı: ${error.message}`,
          model: null,
          name: "AI provider DB",
          providerType: "database",
          slug: "ai-provider-db",
          status: "failed",
        },
      ],
      source,
    })
  }

  const providers = (data ?? []) as AiProviderHealthRow[]
  const results = await Promise.all(providers.map((provider) => testProvider(provider, checkedAt)))
  const summary = buildSummary({ checkedAt, results, source })

  await writeHealthAuditLog({
    organizationId: providers[0]?.organization_id,
    summary,
  })

  return summary
}

export async function sendAiProviderHealthEmail(summary: AiProviderHealthSummary) {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const to = process.env.AI_PROVIDER_HEALTH_EMAIL_TO?.trim() || "support@raipacs.com"
  const from =
    process.env.AI_PROVIDER_HEALTH_EMAIL_FROM?.trim() || "RAI PACS <support@raipacs.com>"

  if (!apiKey) {
    return {
      sent: false,
      skippedReason: "RESEND_API_KEY tanımlı değil.",
      to,
    }
  }

  const hasFailures = summary.failedCount > 0
  const subject = hasFailures
    ? `RAI PACS AI provider sağlık raporu - ${summary.failedCount} uyarı`
    : "RAI PACS AI provider sağlık raporu - OK"
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      html: renderHealthEmailHtml(summary),
      subject,
      text: renderHealthEmailText(summary),
      to: [to],
    }),
  })

  const responseText = await response.text()

  if (!response.ok) {
    return {
      error: clip(responseText, 600),
      sent: false,
      status: response.status,
      to,
    }
  }

  return {
    providerResponse: parseJsonObject(responseText) ?? clip(responseText, 600),
    sent: true,
    status: response.status,
    to,
  }
}

async function testProvider(
  provider: AiProviderHealthRow,
  checkedAt: string
): Promise<AiProviderHealthResult> {
  const startedAt = Date.now()
  const base = {
    checkedAt,
    name: provider.name,
    providerId: provider.id,
    providerType: provider.provider_type,
    slug: provider.slug,
  }

  if (!provider.is_active) {
    return {
      ...base,
      elapsedMs: Date.now() - startedAt,
      message: "Provider pasif.",
      model: provider.default_model,
      status: "skipped",
    }
  }

  try {
    if (provider.provider_type === "mock" || provider.slug === "rai-mock") {
      return ok(base, startedAt, provider.default_model, "Mock provider erişilebilir.")
    }

    if (provider.slug === "rai-orchestrator") {
      return ok(base, startedAt, provider.default_model, "RAI AI Orchestrator tanımı aktif.")
    }

    if (provider.provider_type === "openai") {
      return testOpenAiProvider(
        {
          credentialReference: provider.credential_reference,
          model: provider.default_model || process.env.OPENAI_MODEL || "gpt-5.5",
          providerType: provider.provider_type,
          slug: provider.slug,
        },
        base,
        startedAt
      )
    }

    if (provider.provider_type === "anthropic") {
      return testAnthropicProvider(
        {
          credentialReference: provider.credential_reference,
          model: provider.default_model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
          providerType: provider.provider_type,
          slug: provider.slug,
        },
        base,
        startedAt
      )
    }

    if (provider.provider_type === "google" || provider.slug === "gemini-google") {
      return testGeminiProvider(
        {
          credentialReference: provider.credential_reference,
          model:
            provider.default_model ||
            process.env.GOOGLE_GENERATIVE_AI_MODEL ||
            process.env.GEMINI_MODEL ||
            "gemini-3.5-flash",
          providerType: provider.provider_type,
          slug: provider.slug,
        },
        base,
        startedAt
      )
    }

    if (provider.slug === "medgemma") {
      return testOpenAiCompatibleProvider(
        {
          apiKey: resolveEnvValue(provider.credential_reference) || process.env.RAI_MEDGEMMA_API_KEY,
          baseUrl:
            resolveEndpointValue(provider.credential_reference) || process.env.RAI_MEDGEMMA_ENDPOINT,
          credentialReference: provider.credential_reference,
          model: provider.default_model || process.env.RAI_MEDGEMMA_MODEL || "google/medgemma-4b-it",
          providerType: provider.provider_type,
          slug: provider.slug,
        },
        base,
        startedAt
      )
    }

    if (provider.slug === "rai-llm") {
      return testOpenAiCompatibleProvider(
        {
          apiKey: resolveEnvValue(provider.credential_reference) || process.env.RAI_LLM_API_KEY,
          baseUrl: resolveEndpointValue(provider.credential_reference) || process.env.RAI_LLM_ENDPOINT,
          credentialReference: provider.credential_reference,
          model:
            provider.default_model ||
            process.env.RAI_LLM_MODEL_ID ||
            "Qwen/Qwen2.5-VL-7B-Instruct",
          providerType: provider.provider_type,
          slug: provider.slug,
        },
        base,
        startedAt
      )
    }

    const openAiCompatiblePrefix = openAiCompatibleEnvPrefix(
      provider.slug,
      provider.provider_type
    )

    if (openAiCompatiblePrefix) {
      return testOpenAiCompatibleProvider(
        {
          apiKey:
            resolveEnvValue(provider.credential_reference) ||
            process.env[`${openAiCompatiblePrefix}_API_KEY`],
          baseUrl:
            process.env[`${openAiCompatiblePrefix}_BASE_URL`] ||
            defaultOpenAiCompatibleBaseUrl(provider.slug),
          credentialReference: provider.credential_reference,
          model: normalizeOpenAiCompatibleModel(
            provider.slug,
            process.env[`${openAiCompatiblePrefix}_MODEL`] ||
              provider.default_model ||
              defaultOpenAiCompatibleModel(provider.slug)
          ),
          providerType: provider.provider_type,
          slug: provider.slug,
        },
        base,
        startedAt
      )
    }

    return {
      ...base,
      elapsedMs: Date.now() - startedAt,
      message: "Bu provider için otomatik sağlık testi henüz tanımlı değil.",
      model: provider.default_model,
      status: "skipped",
    }
  } catch (error) {
    return {
      ...base,
      elapsedMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
      model: provider.default_model,
      status: "failed",
    }
  }
}

async function testOpenAiProvider(
  config: ProviderTestConfig,
  base: Omit<AiProviderHealthResult, "elapsedMs" | "message" | "model" | "status">,
  startedAt: number
) {
  const apiKey = resolveEnvValue(config.credentialReference) || process.env.OPENAI_API_KEY
  if (!apiKey) return missingCredential(base, startedAt, config.model, "OPENAI_API_KEY")

  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    body: JSON.stringify({
      input: healthCheckPrompt,
      max_output_tokens: 80,
      model: config.model,
      temperature: 0,
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  })

  return resultFromHttpResponse(response, base, startedAt, config.model, "OpenAI yanıt verdi.")
}

async function testAnthropicProvider(
  config: ProviderTestConfig,
  base: Omit<AiProviderHealthResult, "elapsedMs" | "message" | "model" | "status">,
  startedAt: number
) {
  const apiKey = resolveEnvValue(config.credentialReference) || process.env.ANTHROPIC_API_KEY
  if (!apiKey) return missingCredential(base, startedAt, config.model, "ANTHROPIC_API_KEY")

  const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    body: JSON.stringify({
      max_tokens: 80,
      messages: [{ content: healthCheckPrompt, role: "user" }],
      model: config.model,
      temperature: 0,
    }),
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
    },
    method: "POST",
  })

  return resultFromHttpResponse(response, base, startedAt, config.model, "Claude yanıt verdi.")
}

async function testGeminiProvider(
  config: ProviderTestConfig,
  base: Omit<AiProviderHealthResult, "elapsedMs" | "message" | "model" | "status">,
  startedAt: number
) {
  const apiKey =
    resolveEnvValue(config.credentialReference) ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GEMINI_API_KEY
  if (!apiKey) {
    return missingCredential(base, startedAt, config.model, "GOOGLE_GENERATIVE_AI_API_KEY")
  }

  const model = config.model || "gemini-3.5-flash"
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      body: JSON.stringify({
        contents: [{ parts: [{ text: healthCheckPrompt }] }],
        generationConfig: { maxOutputTokens: 80, temperature: 0 },
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  )

  return resultFromHttpResponse(response, base, startedAt, model, "Gemini yanıt verdi.")
}

async function testOpenAiCompatibleProvider(
  config: ProviderTestConfig,
  base: Omit<AiProviderHealthResult, "elapsedMs" | "message" | "model" | "status">,
  startedAt: number
) {
  if (!config.baseUrl) {
    return {
      ...base,
      elapsedMs: Date.now() - startedAt,
      message: "Endpoint URL tanımlı değil.",
      model: config.model || null,
      status: "failed" as const,
    }
  }

  if (!config.apiKey && requiresApiKey(config.slug)) {
    return missingCredential(base, startedAt, config.model, `${config.slug.toUpperCase()}_API_KEY`)
  }

  const response = await fetchWithTimeout(config.baseUrl, {
    body: JSON.stringify({
      messages: [
        {
          content: healthCheckPrompt,
          role: "user",
        },
      ],
      model: config.model,
      response_format: { type: "json_object" },
      temperature: 0,
    }),
    headers: {
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      "Content-Type": "application/json",
    },
    method: "POST",
  })

  return resultFromHttpResponse(
    response,
    base,
    startedAt,
    config.model || null,
    `${config.slug} yanıt verdi.`
  )
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 45_000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const rawText = await response.text()
    return { ok: response.ok, rawText, status: response.status }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, rawText: "Endpoint zaman aşımına uğradı.", status: 408 }
    }
    return {
      ok: false,
      rawText: error instanceof Error ? error.message : String(error),
      status: 500,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function resultFromHttpResponse(
  response: Awaited<ReturnType<typeof fetchWithTimeout>>,
  base: Omit<AiProviderHealthResult, "elapsedMs" | "message" | "model" | "status">,
  startedAt: number,
  model: string | null | undefined,
  okMessage: string
): AiProviderHealthResult {
  return {
    ...base,
    elapsedMs: Date.now() - startedAt,
    message: response.ok ? okMessage : `HTTP ${response.status}: ${clip(response.rawText, 400)}`,
    model: model || null,
    status: response.ok ? "ok" : "failed",
  }
}

function ok(
  base: Omit<AiProviderHealthResult, "elapsedMs" | "message" | "model" | "status">,
  startedAt: number,
  model: string | null,
  message: string
): AiProviderHealthResult {
  return {
    ...base,
    elapsedMs: Date.now() - startedAt,
    message,
    model,
    status: "ok",
  }
}

function missingCredential(
  base: Omit<AiProviderHealthResult, "elapsedMs" | "message" | "model" | "status">,
  startedAt: number,
  model: string | null | undefined,
  envName: string
): AiProviderHealthResult {
  return {
    ...base,
    elapsedMs: Date.now() - startedAt,
    message: `${envName} tanımlı değil.`,
    model: model || null,
    status: "failed",
  }
}

function buildSummary({
  checkedAt,
  results,
  source,
}: {
  checkedAt: string
  results: AiProviderHealthResult[]
  source: string
}): AiProviderHealthSummary {
  return {
    checkedAt,
    failedCount: results.filter((result) => result.status === "failed").length,
    okCount: results.filter((result) => result.status === "ok").length,
    results,
    skippedCount: results.filter((result) => result.status === "skipped").length,
    source,
    totalCount: results.length,
  }
}

async function writeHealthAuditLog({
  organizationId,
  summary,
}: {
  organizationId?: string
  summary: AiProviderHealthSummary
}) {
  if (!organizationId || !isSupabaseServiceConfigured()) return

  try {
    const supabase = createServiceClient()
    await supabase.from("audit_logs").insert({
      action: "ai_provider.health_job_completed",
      actor_id: null,
      metadata: {
        checkedAt: summary.checkedAt,
        failedCount: summary.failedCount,
        okCount: summary.okCount,
        results: summary.results.map((result) => ({
          elapsedMs: result.elapsedMs,
          message: result.message,
          model: result.model,
          name: result.name,
          providerId: result.providerId,
          providerType: result.providerType,
          slug: result.slug,
          status: result.status,
        })),
        skippedCount: summary.skippedCount,
        source: summary.source,
        totalCount: summary.totalCount,
      },
      organization_id: organizationId,
      resource_type: "ai_service_provider",
    })
  } catch {
    // Health check response should not fail just because audit logging failed.
  }
}

function renderHealthEmailText(summary: AiProviderHealthSummary) {
  const lines = [
    "RAI PACS AI provider sağlık raporu",
    `Zaman: ${formatDateTime(summary.checkedAt)}`,
    `Sonuç: ${summary.okCount} OK, ${summary.failedCount} uyarı, ${summary.skippedCount} atlandı`,
    "",
    ...summary.results.map(
      (result) =>
        `- ${result.status.toUpperCase()} | ${result.name} (${result.slug}) | ${
          result.model || "-"
        } | ${result.elapsedMs} ms | ${result.message}`
    ),
  ]

  return lines.join("\n")
}

function renderHealthEmailHtml(summary: AiProviderHealthSummary) {
  const rows = summary.results
    .map(
      (result) => `
        <tr>
          <td>${escapeHtml(result.status.toUpperCase())}</td>
          <td>${escapeHtml(result.name)}</td>
          <td>${escapeHtml(result.slug)}</td>
          <td>${escapeHtml(result.model || "-")}</td>
          <td>${result.elapsedMs} ms</td>
          <td>${escapeHtml(result.message)}</td>
        </tr>`
    )
    .join("")

  return `
    <div style="font-family:Arial,sans-serif;color:#111827">
      <h2>RAI PACS AI provider sağlık raporu</h2>
      <p><strong>Zaman:</strong> ${escapeHtml(formatDateTime(summary.checkedAt))}</p>
      <p><strong>Sonuç:</strong> ${summary.okCount} OK, ${summary.failedCount} uyarı, ${summary.skippedCount} atlandı</p>
      <table style="border-collapse:collapse;width:100%">
        <thead>
          <tr>
            <th align="left">Durum</th>
            <th align="left">Provider</th>
            <th align="left">Slug</th>
            <th align="left">Model</th>
            <th align="left">Süre</th>
            <th align="left">Mesaj</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
}

function openAiCompatibleEnvPrefix(slug: string, providerType: string) {
  if (slug === "qwen") return "QWEN"
  if (slug === "deepseek") return "DEEPSEEK"
  if (providerType === "openai-compatible") return normalizeEnvPrefix(slug)
  return null
}

function defaultOpenAiCompatibleBaseUrl(slug: string) {
  if (slug === "qwen") return "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"
  if (slug === "deepseek") return "https://api.deepseek.com/chat/completions"
  return ""
}

function defaultOpenAiCompatibleModel(slug: string) {
  if (slug === "qwen") return "qwen-vl-max"
  if (slug === "deepseek") return "deepseek-v4-flash"
  return "model"
}

function normalizeOpenAiCompatibleModel(slug: string, model: string) {
  if (slug === "qwen" && model === "qwen-vl-max-latest") return "qwen-vl-max"
  if (slug === "qwen" && model === "qwen-vl-plus-latest") return "qwen-vl-plus"
  return model
}

function resolveEnvValue(reference: string | null | undefined) {
  if (!reference) return undefined
  return process.env[reference]?.trim()
}

function resolveEndpointValue(reference: string | null | undefined) {
  const value = resolveEnvValue(reference)
  return value && isHttpUrl(value) ? value : undefined
}

function requiresApiKey(slug: string) {
  return !["rai-llm"].includes(slug)
}

function normalizeEnvPrefix(slug: string) {
  return slug
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value)
}

function parseJsonObject(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function clip(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(new Date(value))
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
