"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import {
  calculateAiUsageCost,
  createMockRadiologyDraft,
  estimateTokenUsage,
  isMissingAiTableError,
} from "@/lib/ai-reporting"
import { requireUser } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/config"
import { createClient } from "@/lib/supabase/server"

const idSchema = z.string().uuid()
const returnToSchema = z
  .string()
  .trim()
  .refine((value) => value.startsWith("/") && !value.startsWith("//"))

export async function startAiPreReport(formData: FormData) {
  const user = await requireUser()
  if (!isSupabaseConfigured) redirect("/worklist")

  const studyId = idSchema.parse(formData.get("studyId"))
  const providerId = idSchema.parse(formData.get("providerId"))
  const returnTo = returnToSchema.parse(String(formData.get("returnTo") ?? `/viewer/${studyId}`))
  const supabase = await createClient()

  const [{ data: study, error: studyError }, { count: instanceCount, error: countError }] =
    await Promise.all([
      supabase
        .from("studies")
        .select(
          "id, accession_number, modality, description, study_at, patients(patient_number, first_name, last_name)"
        )
        .eq("id", studyId)
        .eq("organization_id", user.organizationId)
        .maybeSingle(),
      supabase
        .from("instances")
        .select("id", { count: "exact", head: true })
        .eq("study_id", studyId)
        .eq("organization_id", user.organizationId),
    ])

  if (studyError) throw new Error(`AI tetkik bilgisi alınamadı: ${studyError.message}`)
  if (countError) throw new Error(`AI instance sayısı alınamadı: ${countError.message}`)
  if (!study) throw new Error("AI için tetkik bulunamadı.")

  const { data: provider, error: providerError } = await supabase
    .from("ai_service_providers")
    .select(
      "id, name, slug, provider_type, default_model, is_active, requires_credentials, credential_reference"
    )
    .eq("id", providerId)
    .eq("organization_id", user.organizationId)
    .maybeSingle()

  if (providerError) {
    if (isMissingAiTableError(providerError)) {
      throw new Error("AI tabloları henüz Supabase üzerinde uygulanmamış.")
    }
    throw new Error(`AI servis tanımı alınamadı: ${providerError.message}`)
  }
  if (!provider || !provider.is_active) throw new Error("Seçilen AI servisi aktif değil.")

  const { count: seriesCount, error: seriesCountError } = await supabase
    .from("series")
    .select("id", { count: "exact", head: true })
    .eq("study_id", studyId)
    .eq("organization_id", user.organizationId)

  if (seriesCountError) throw new Error(`AI seri sayısı alınamadı: ${seriesCountError.message}`)

  const patient = Array.isArray(study.patients) ? study.patients[0] : study.patients
  const isMock = provider.provider_type === "mock"
  const openAiApiKey =
    provider.provider_type === "openai" && provider.credential_reference
      ? process.env[provider.credential_reference]
      : null
  const anthropicApiKey =
    provider.provider_type === "anthropic" && provider.credential_reference
      ? process.env[provider.credential_reference]
      : null
  const googleApiKey =
    provider.provider_type === "google" && provider.credential_reference
      ? process.env[provider.credential_reference]
      : null
  const canRunOpenAi = provider.provider_type === "openai" && Boolean(openAiApiKey)
  const canRunAnthropic = provider.provider_type === "anthropic" && Boolean(anthropicApiKey)
  const canRunGemini = provider.provider_type === "google" && Boolean(googleApiKey)
  const canRunLiveProvider = canRunOpenAi || canRunAnthropic || canRunGemini
  const now = new Date().toISOString()
  const jobStatus = isMock ? "draft_ready" : canRunLiveProvider ? "running" : "waiting_credentials"
  const inputContext = {
    accessionNumber: study.accession_number,
    description: study.description,
    instanceCount: instanceCount ?? 0,
    modality: study.modality,
    patientNumber: patient?.patient_number ?? "",
    seriesCount: seriesCount ?? 0,
    studyAt: study.study_at,
  }

  const { data: job, error: jobError } = await supabase
    .from("ai_jobs")
    .insert({
      organization_id: user.organizationId,
      study_id: studyId,
      requested_by: user.id,
      provider_id: provider.id,
      provider_slug: provider.slug,
      model_name: provider.default_model,
      status: jobStatus,
      input_context: inputContext,
      started_at: now,
      completed_at: isMock ? now : null,
      error_message:
        isMock || canRunLiveProvider
          ? null
          : "AI sağlayıcı hesabı/anahtarı tanımlanınca çalıştırılacak.",
    })
    .select("id")
    .single()

  if (jobError) throw new Error(`AI işi oluşturulamadı: ${jobError.message}`)

  if (isMock) {
    const draft = createMockRadiologyDraft({
      accessionNumber: study.accession_number,
      description: study.description,
      instanceCount: instanceCount ?? 0,
      modality: study.modality,
      patientName: patient ? `${patient.first_name} ${patient.last_name}` : "",
      patientNumber: patient?.patient_number ?? "",
      seriesCount: seriesCount ?? 0,
      studyAt: study.study_at,
    })

    const { error: draftError } = await supabase.from("ai_report_drafts").insert({
      organization_id: user.organizationId,
      study_id: studyId,
      job_id: job.id,
      findings: draft.findings,
      impression: draft.impression,
      recommendations: draft.recommendations,
      confidence_score: draft.confidenceScore,
      criticality: draft.criticality,
      source_summary: draft.sourceSummary,
    })

    if (draftError) throw new Error(`AI ön raporu oluşturulamadı: ${draftError.message}`)

    const tokenUsage = estimateTokenUsage({
      findings: draft.findings,
      impression: draft.impression,
      inputContext,
    })
    const cost = calculateAiUsageCost({
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      providerSlug: provider.slug,
    })

    const { error: usageError } = await supabase.from("ai_usage_events").insert({
      organization_id: user.organizationId,
      job_id: job.id,
      study_id: studyId,
      provider_slug: provider.slug,
      model_name: provider.default_model,
      usage_type: "pre_report",
      input_tokens: tokenUsage.inputTokens,
      output_tokens: tokenUsage.outputTokens,
      currency: cost.currency,
      input_cost: cost.inputCost,
      output_cost: cost.outputCost,
      pricing_snapshot: cost.pricingSnapshot,
      metadata: {
        accessionNumber: study.accession_number,
        modality: study.modality,
        estimated: true,
      },
      created_by: user.id,
    })

    if (usageError && !isMissingAiTableError(usageError)) {
      throw new Error(`AI tüketim kaydı oluşturulamadı: ${usageError.message}`)
    }
  }

  if (canRunOpenAi && openAiApiKey) {
    try {
      const draft = await createOpenAiRadiologyDraft({
        apiKey: openAiApiKey,
        inputContext,
        model: provider.default_model || "gpt-5.1",
        patientName: patient ? `${patient.first_name} ${patient.last_name}` : "",
      })

      const { error: draftError } = await supabase.from("ai_report_drafts").insert({
        organization_id: user.organizationId,
        study_id: studyId,
        job_id: job.id,
        findings: draft.findings,
        impression: draft.impression,
        recommendations: draft.recommendations,
        confidence_score: draft.confidenceScore,
        criticality: draft.criticality,
        source_summary: draft.sourceSummary,
      })

      if (draftError) throw new Error(`OpenAI ön raporu kaydedilemedi: ${draftError.message}`)

      const tokenUsage =
        draft.usage ??
        estimateTokenUsage({
          findings: draft.findings,
          impression: draft.impression,
          inputContext,
        })
      const cost = calculateAiUsageCost({
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        providerSlug: provider.slug,
      })

      const { error: usageError } = await supabase.from("ai_usage_events").insert({
        organization_id: user.organizationId,
        job_id: job.id,
        study_id: studyId,
        provider_slug: provider.slug,
        model_name: provider.default_model,
        usage_type: "pre_report",
        input_tokens: tokenUsage.inputTokens,
        output_tokens: tokenUsage.outputTokens,
        currency: cost.currency,
        input_cost: cost.inputCost,
        output_cost: cost.outputCost,
        pricing_snapshot: cost.pricingSnapshot,
        metadata: {
          accessionNumber: study.accession_number,
          modality: study.modality,
          estimated: !draft.usage,
          responseId: draft.responseId,
        },
        created_by: user.id,
      })

      if (usageError && !isMissingAiTableError(usageError)) {
        throw new Error(`OpenAI tüketim kaydı oluşturulamadı: ${usageError.message}`)
      }

      await supabase
        .from("ai_jobs")
        .update({
          status: "draft_ready",
          completed_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", job.id)
        .eq("organization_id", user.organizationId)
    } catch (error) {
      await supabase
        .from("ai_jobs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : "OpenAI ön raporu üretilemedi.",
        })
        .eq("id", job.id)
        .eq("organization_id", user.organizationId)
    }
  }

  if (canRunAnthropic && anthropicApiKey) {
    try {
      const draft = await createAnthropicRadiologyDraft({
        apiKey: anthropicApiKey,
        inputContext,
        model: provider.default_model || "claude-sonnet-4-6",
        patientName: patient ? `${patient.first_name} ${patient.last_name}` : "",
      })

      const { error: draftError } = await supabase.from("ai_report_drafts").insert({
        organization_id: user.organizationId,
        study_id: studyId,
        job_id: job.id,
        findings: draft.findings,
        impression: draft.impression,
        recommendations: draft.recommendations,
        confidence_score: draft.confidenceScore,
        criticality: draft.criticality,
        source_summary: draft.sourceSummary,
      })

      if (draftError) throw new Error(`Claude ön raporu kaydedilemedi: ${draftError.message}`)

      const tokenUsage =
        draft.usage ??
        estimateTokenUsage({
          findings: draft.findings,
          impression: draft.impression,
          inputContext,
        })
      const cost = calculateAiUsageCost({
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        providerSlug: provider.slug,
      })

      const { error: usageError } = await supabase.from("ai_usage_events").insert({
        organization_id: user.organizationId,
        job_id: job.id,
        study_id: studyId,
        provider_slug: provider.slug,
        model_name: provider.default_model,
        usage_type: "pre_report",
        input_tokens: tokenUsage.inputTokens,
        output_tokens: tokenUsage.outputTokens,
        currency: cost.currency,
        input_cost: cost.inputCost,
        output_cost: cost.outputCost,
        pricing_snapshot: cost.pricingSnapshot,
        metadata: {
          accessionNumber: study.accession_number,
          modality: study.modality,
          estimated: !draft.usage,
          responseId: draft.responseId,
        },
        created_by: user.id,
      })

      if (usageError && !isMissingAiTableError(usageError)) {
        throw new Error(`Claude tüketim kaydı oluşturulamadı: ${usageError.message}`)
      }

      await supabase
        .from("ai_jobs")
        .update({
          status: "draft_ready",
          completed_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", job.id)
        .eq("organization_id", user.organizationId)
    } catch (error) {
      await supabase
        .from("ai_jobs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : "Claude ön raporu üretilemedi.",
        })
        .eq("id", job.id)
        .eq("organization_id", user.organizationId)
    }
  }

  if (canRunGemini && googleApiKey) {
    try {
      const draft = await createGeminiRadiologyDraft({
        apiKey: googleApiKey,
        inputContext,
        model: provider.default_model || "gemini-3.5-flash",
        patientName: patient ? `${patient.first_name} ${patient.last_name}` : "",
      })

      const { error: draftError } = await supabase.from("ai_report_drafts").insert({
        organization_id: user.organizationId,
        study_id: studyId,
        job_id: job.id,
        findings: draft.findings,
        impression: draft.impression,
        recommendations: draft.recommendations,
        confidence_score: draft.confidenceScore,
        criticality: draft.criticality,
        source_summary: draft.sourceSummary,
      })

      if (draftError) throw new Error(`Gemini ön raporu kaydedilemedi: ${draftError.message}`)

      const tokenUsage =
        draft.usage ??
        estimateTokenUsage({
          findings: draft.findings,
          impression: draft.impression,
          inputContext,
        })
      const cost = calculateAiUsageCost({
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        providerSlug: provider.slug,
      })

      const { error: usageError } = await supabase.from("ai_usage_events").insert({
        organization_id: user.organizationId,
        job_id: job.id,
        study_id: studyId,
        provider_slug: provider.slug,
        model_name: provider.default_model,
        usage_type: "pre_report",
        input_tokens: tokenUsage.inputTokens,
        output_tokens: tokenUsage.outputTokens,
        currency: cost.currency,
        input_cost: cost.inputCost,
        output_cost: cost.outputCost,
        pricing_snapshot: cost.pricingSnapshot,
        metadata: {
          accessionNumber: study.accession_number,
          modality: study.modality,
          estimated: !draft.usage,
          responseId: draft.responseId,
        },
        created_by: user.id,
      })

      if (usageError && !isMissingAiTableError(usageError)) {
        throw new Error(`Gemini tüketim kaydı oluşturulamadı: ${usageError.message}`)
      }

      await supabase
        .from("ai_jobs")
        .update({
          status: "draft_ready",
          completed_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", job.id)
        .eq("organization_id", user.organizationId)
    } catch (error) {
      await supabase
        .from("ai_jobs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : "Gemini ön raporu üretilemedi.",
        })
        .eq("id", job.id)
        .eq("organization_id", user.organizationId)
    }
  }

  await supabase.from("audit_logs").insert({
    organization_id: user.organizationId,
    actor_id: user.id,
    action: "ai.pre_report_requested",
    resource_type: "study",
    resource_id: studyId,
    metadata: {
      jobId: job.id,
      provider: provider.slug,
      model: provider.default_model,
      status: jobStatus,
    },
  })

  revalidatePath(`/viewer/${studyId}`)
  redirect(appendQuery(returnTo, "aiJob", job.id))
}

function appendQuery(path: string, key: string, value: string) {
  const separator = path.includes("?") ? "&" : "?"
  return `${path}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

type OpenAiDraft = {
  findings: string
  impression: string
  recommendations: string
  confidenceScore: number
  criticality: "none" | "low" | "medium" | "high"
  sourceSummary: Record<string, unknown>
  usage?: {
    inputTokens: number
    outputTokens: number
  }
  responseId?: string
}

type OpenAiResponse = {
  id?: string
  output_text?: string
  output?: Array<{
    content?: Array<{
      text?: string
      type?: string
    }>
  }>
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
}

type AnthropicResponse = {
  id?: string
  content?: Array<{
    text?: string
    type?: string
  }>
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
}

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
      }>
    }
  }>
  modelVersion?: string
  responseId?: string
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
  error?: {
    message?: string
  }
}

async function createOpenAiRadiologyDraft({
  apiKey,
  inputContext,
  model,
  patientName,
}: {
  apiKey: string
  inputContext: Record<string, unknown>
  model: string
  patientName: string
}): Promise<OpenAiDraft> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: [
        "Sen radyoloji ön rapor asistanısın.",
        "Tanı koymazsın; yalnızca hekimin düzenleyip onaylayacağı Türkçe bir ön rapor taslağı hazırlarsın.",
        "Elinde şu an görüntü pikselleri değil DICOM metadata ve tetkik bağlamı var; belirsizlikleri açıkça belirt.",
        "Sadece JSON döndür. Markdown, açıklama veya kod bloğu kullanma.",
      ].join(" "),
      input: JSON.stringify({
        task: "radiology_pre_report",
        patientName,
        study: inputContext,
        expectedJson: {
          findings: "string",
          impression: "string",
          recommendations: "string",
          confidenceScore: "number 0..1",
          criticality: "none | low | medium | high",
        },
      }),
    }),
  })

  const payload = (await response.json().catch(() => null)) as OpenAiResponse | { error?: { message?: string } } | null
  if (!response.ok) {
    const message =
      payload && "error" in payload && payload.error?.message
        ? payload.error.message
        : `OpenAI isteği başarısız oldu (${response.status}).`
    throw new Error(message)
  }

  const openAiPayload = payload as OpenAiResponse
  const text = extractOpenAiOutputText(openAiPayload)
  const parsed = parseOpenAiDraftJson(text)

  return {
    findings: parsed.findings,
    impression: parsed.impression,
    recommendations: parsed.recommendations,
    confidenceScore: parsed.confidenceScore,
    criticality: parsed.criticality,
    sourceSummary: {
      generator: "openai-responses",
      model,
      inputContext,
    },
    usage:
      typeof openAiPayload.usage?.input_tokens === "number" &&
      typeof openAiPayload.usage?.output_tokens === "number"
        ? {
            inputTokens: openAiPayload.usage.input_tokens,
            outputTokens: openAiPayload.usage.output_tokens,
          }
        : undefined,
    responseId: openAiPayload.id,
  }
}

async function createAnthropicRadiologyDraft({
  apiKey,
  inputContext,
  model,
  patientName,
}: {
  apiKey: string
  inputContext: Record<string, unknown>
  model: string
  patientName: string
}): Promise<OpenAiDraft> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      max_tokens: 1200,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            task: "radiology_pre_report",
            patientName,
            study: inputContext,
            expectedJson: {
              findings: "string",
              impression: "string",
              recommendations: "string",
              confidenceScore: "number 0..1",
              criticality: "none | low | medium | high",
            },
          }),
        },
      ],
      model,
      system: [
        "Sen radyoloji ön rapor asistanısın.",
        "Tanı koymazsın; yalnızca hekimin düzenleyip onaylayacağı Türkçe bir ön rapor taslağı hazırlarsın.",
        "Elinde şu an görüntü pikselleri değil DICOM metadata ve tetkik bağlamı var; belirsizlikleri açıkça belirt.",
        "Sadece JSON döndür. Markdown, açıklama veya kod bloğu kullanma.",
      ].join(" "),
    }),
  })

  const payload = (await response.json().catch(() => null)) as
    | AnthropicResponse
    | { error?: { message?: string } }
    | null
  if (!response.ok) {
    const message =
      payload && "error" in payload && payload.error?.message
        ? payload.error.message
        : `Claude isteği başarısız oldu (${response.status}).`
    throw new Error(message)
  }

  const anthropicPayload = payload as AnthropicResponse
  const text = extractAnthropicOutputText(anthropicPayload)
  const parsed = parseOpenAiDraftJson(text)

  return {
    findings: parsed.findings,
    impression: parsed.impression,
    recommendations: parsed.recommendations,
    confidenceScore: parsed.confidenceScore,
    criticality: parsed.criticality,
    sourceSummary: {
      generator: "anthropic-messages",
      model,
      inputContext,
    },
    usage:
      typeof anthropicPayload.usage?.input_tokens === "number" &&
      typeof anthropicPayload.usage?.output_tokens === "number"
        ? {
            inputTokens: anthropicPayload.usage.input_tokens,
            outputTokens: anthropicPayload.usage.output_tokens,
          }
        : undefined,
    responseId: anthropicPayload.id,
  }
}

function extractAnthropicOutputText(payload: AnthropicResponse) {
  const chunks =
    payload.content
      ?.filter((content) => content.type === "text" || content.text)
      .map((content) => content.text)
      .filter(Boolean) ?? []
  const text = chunks.join("\n").trim()
  if (!text) throw new Error("Claude boş ön rapor döndürdü.")
  return text
}

async function createGeminiRadiologyDraft({
  apiKey,
  inputContext,
  model,
  patientName,
}: {
  apiKey: string
  inputContext: Record<string, unknown>
  model: string
  patientName: string
}): Promise<OpenAiDraft> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: [
                  "Sen radyoloji ön rapor asistanısın.",
                  "Tanı koymazsın; yalnızca hekimin düzenleyip onaylayacağı Türkçe bir ön rapor taslağı hazırlarsın.",
                  "Elinde şu an görüntü pikselleri değil DICOM metadata ve tetkik bağlamı var; belirsizlikleri açıkça belirt.",
                  "Bulgular ve izlenim alanlarını kısa tut; her biri en fazla 3 cümle olsun.",
                  "Sadece JSON döndür. Markdown, açıklama veya kod bloğu kullanma.",
                  JSON.stringify({
                    task: "radiology_pre_report",
                    patientName,
                    study: inputContext,
                    expectedJson: {
                      findings: "string",
                      impression: "string",
                      recommendations: "string",
                      confidenceScore: "number 0..1",
                      criticality: "none | low | medium | high",
                    },
                  }),
                ].join("\n"),
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            properties: {
              confidenceScore: { type: "NUMBER" },
              criticality: {
                enum: ["none", "low", "medium", "high"],
                type: "STRING",
              },
              findings: { type: "STRING" },
              impression: { type: "STRING" },
              recommendations: { type: "STRING" },
            },
            required: ["findings", "impression", "recommendations", "confidenceScore", "criticality"],
            type: "OBJECT",
          },
          temperature: 0.2,
          maxOutputTokens: 2000,
        },
      }),
    }
  )

  const payload = (await response.json().catch(() => null)) as GeminiResponse | null
  if (!response.ok) {
    const message = payload?.error?.message || `Gemini isteği başarısız oldu (${response.status}).`
    throw new Error(message)
  }

  const text = extractGeminiOutputText(payload)
  const parsed = parseOpenAiDraftJson(text)

  return {
    findings: parsed.findings,
    impression: parsed.impression,
    recommendations: parsed.recommendations,
    confidenceScore: parsed.confidenceScore,
    criticality: parsed.criticality,
    sourceSummary: {
      generator: "google-gemini-generate-content",
      model,
      modelVersion: payload?.modelVersion,
      inputContext,
    },
    usage:
      typeof payload?.usageMetadata?.promptTokenCount === "number" &&
      typeof payload?.usageMetadata?.candidatesTokenCount === "number"
        ? {
            inputTokens: payload.usageMetadata.promptTokenCount,
            outputTokens: payload.usageMetadata.candidatesTokenCount,
          }
        : undefined,
    responseId: payload?.responseId,
  }
}

function extractGeminiOutputText(payload: GeminiResponse | null) {
  const chunks =
    payload?.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text)
      .filter(Boolean) ?? []
  const text = chunks.join("\n").trim()
  if (!text) throw new Error("Gemini boş ön rapor döndürdü.")
  return text
}

function extractOpenAiOutputText(payload: OpenAiResponse) {
  if (payload.output_text) return payload.output_text
  const chunks =
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text)
      .filter(Boolean) ?? []
  const text = chunks.join("\n").trim()
  if (!text) throw new Error("OpenAI boş ön rapor döndürdü.")
  return text
}

function parseOpenAiDraftJson(text: string) {
  const cleanText = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim()
  const parsed = JSON.parse(cleanText) as Partial<OpenAiDraft>
  const criticality = ["none", "low", "medium", "high"].includes(String(parsed.criticality))
    ? (parsed.criticality as OpenAiDraft["criticality"])
    : "none"

  return {
    findings: String(parsed.findings ?? "").trim() || "OpenAI bulgu taslağı boş döndü.",
    impression: String(parsed.impression ?? "").trim() || "OpenAI sonuç taslağı boş döndü.",
    recommendations: String(parsed.recommendations ?? "").trim(),
    confidenceScore:
      typeof parsed.confidenceScore === "number"
        ? Math.min(1, Math.max(0, parsed.confidenceScore))
        : 0.5,
    criticality,
  }
}
