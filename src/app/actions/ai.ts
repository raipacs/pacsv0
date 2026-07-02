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
import {
  createAiImagePreviewsFromDicom,
  type AiDicomImageSource,
  type AiImagePreview,
} from "@/lib/ai-image-previews"
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
  const forceAiRunProviderId = parseOptionalUuid(formData.get("forceAiRunProviderId"))
  const orchestratorProviderId = parseOptionalUuid(formData.get("orchestratorProviderId"))
  const orchestratorProviderSlug = parseOptionalText(formData.get("orchestratorProviderSlug"))
  const orchestratorSkipSlugs = parseOptionalCsv(formData.get("orchestratorSkipSlugs"))
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

  if (forceAiRunProviderId !== provider.id) {
    const reusableDraft = await findReusableAiDraftForProvider({
      organizationId: user.organizationId,
      providerId: provider.id,
      studyId,
      supabase,
    })

    if (reusableDraft) {
      revalidatePath(`/viewer/${studyId}`)
      redirect(
        appendQuery(
          appendQuery(
            appendQueryIfMissing(returnTo, "aiProvider", provider.id),
            "aiDraft",
            reusableDraft.id
          ),
          "aiReuse",
          provider.id
        )
      )
    }
  }

  if (provider.slug === "rai-orchestrator") {
    const routedProvider = await resolveRaiOrchestratorProvider({
      excludedSlugs: orchestratorSkipSlugs,
      organizationId: user.organizationId,
      supabase,
    })

    if (!routedProvider) {
      throw new Error(
        "RAI AI Orchestrator için çalıştırılabilir aktif provider bulunamadı. OpenAI, Gemini, Claude, MedGemma, RAI LLM veya RAI Mock sağlayıcılarından en az biri aktif ve hazır olmalı."
      )
    }

    const routedFormData = new FormData()
    routedFormData.set("studyId", studyId)
    routedFormData.set("providerId", routedProvider.id)
    routedFormData.set("orchestratorProviderId", provider.id)
    routedFormData.set("orchestratorProviderSlug", provider.slug)
    if (orchestratorSkipSlugs.length) {
      routedFormData.set("orchestratorSkipSlugs", orchestratorSkipSlugs.join(","))
    }
    routedFormData.set(
      "returnTo",
      appendQuery(appendQueryIfMissing(returnTo, "aiProvider", provider.id), "orchestrator", routedProvider.slug)
    )
    return startAiPreReport(routedFormData)
  }

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
  const medGemmaConfig = resolveMedGemmaConfig(provider.slug, provider.credential_reference)
  const raiLlmConfig = resolveRaiLlmConfig(provider.slug, provider.credential_reference)
  const openAiCompatibleConfig = resolveOpenAiCompatibleConfig(
    provider.slug,
    provider.provider_type,
    provider.credential_reference
  )
  const canRunMedGemma = Boolean(medGemmaConfig)
  const canRunRaiLlm = Boolean(raiLlmConfig)
  const canRunOpenAiCompatible = Boolean(openAiCompatibleConfig)
  const canRunLiveProvider =
    canRunOpenAi ||
    canRunAnthropic ||
    canRunGemini ||
    canRunOpenAiCompatible ||
    canRunMedGemma ||
    canRunRaiLlm
  const now = new Date().toISOString()
  const jobStatus = isMock ? "draft_ready" : canRunLiveProvider ? "running" : "waiting_credentials"
  const waitingMessage =
    provider.slug === "medgemma"
      ? "MedGemma endpoint tanımı bekleniyor. RAI_MEDGEMMA_ENDPOINT ve gerekirse RAI_MEDGEMMA_API_KEY Vercel/Supabase secret olarak tanımlanmalı."
      : provider.slug === "rai-llm"
        ? "RAI LLM endpoint tanımı bekleniyor. RAI_LLM_ENDPOINT ve gerekirse RAI_LLM_API_KEY Vercel/Supabase secret olarak tanımlanmalı."
        : provider.slug === "qwen"
          ? "Qwen API anahtarı bekleniyor. QWEN_API_KEY Vercel/Supabase secret olarak tanımlanmalı."
          : "AI sağlayıcı hesabı/anahtarı tanımlanınca çalıştırılacak."
  const inputContext = {
    accessionNumber: study.accession_number,
    description: study.description,
    instanceCount: instanceCount ?? 0,
    modality: study.modality,
    patientNumber: patient?.patient_number ?? "",
    seriesCount: seriesCount ?? 0,
    studyAt: study.study_at,
    ...(orchestratorProviderId && orchestratorProviderSlug
      ? {
          orchestrator: {
            providerId: orchestratorProviderId,
            providerSlug: orchestratorProviderSlug,
            routedProviderId: provider.id,
            routedProviderSlug: provider.slug,
          },
        }
      : {}),
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
      error_message: isMock || canRunLiveProvider ? null : waitingMessage,
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
      const visualContext = await loadAiVisualContext({
        organizationId: user.organizationId,
        studyId,
        supabase,
      })
      assertImagePreviewsReady({
        errors: visualContext.imagePreviewErrors,
        imagePreviews: visualContext.imagePreviews,
      })
      const draft = await createOpenAiRadiologyDraft({
        apiKey: openAiApiKey,
        imagePreviewErrors: visualContext.imagePreviewErrors,
        imagePreviews: visualContext.imagePreviews,
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
          dicomReferenceCount: visualContext.dicomReferences.length,
          imagePreviewCount: visualContext.imagePreviews.length,
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
      const visualContext = await loadAiVisualContext({
        organizationId: user.organizationId,
        studyId,
        supabase,
      })
      assertImagePreviewsReady({
        errors: visualContext.imagePreviewErrors,
        imagePreviews: visualContext.imagePreviews,
      })
      const draft = await createAnthropicRadiologyDraft({
        apiKey: anthropicApiKey,
        imagePreviewErrors: visualContext.imagePreviewErrors,
        imagePreviews: visualContext.imagePreviews,
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
          dicomReferenceCount: visualContext.dicomReferences.length,
          imagePreviewCount: visualContext.imagePreviews.length,
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
      const visualContext = await loadAiVisualContext({
        organizationId: user.organizationId,
        studyId,
        supabase,
      })
      assertImagePreviewsReady({
        errors: visualContext.imagePreviewErrors,
        imagePreviews: visualContext.imagePreviews,
      })
      const draft = await createGeminiRadiologyDraft({
        apiKey: googleApiKey,
        imagePreviewErrors: visualContext.imagePreviewErrors,
        imagePreviews: visualContext.imagePreviews,
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
          dicomReferenceCount: visualContext.dicomReferences.length,
          imagePreviewCount: visualContext.imagePreviews.length,
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

  if (canRunOpenAiCompatible && openAiCompatibleConfig) {
    try {
      const visualContext = await loadAiVisualContext({
        organizationId: user.organizationId,
        studyId,
        supabase,
      })
      assertImagePreviewsReady({
        errors: visualContext.imagePreviewErrors,
        imagePreviews: visualContext.imagePreviews,
      })
      const draft = await createOpenAiCompatibleRadiologyDraft({
        apiKey: openAiCompatibleConfig.apiKey,
        baseUrl: openAiCompatibleConfig.baseUrl,
        generator: openAiCompatibleConfig.generator,
        imagePreviewErrors: visualContext.imagePreviewErrors,
        imagePreviews: visualContext.imagePreviews,
        inputContext,
        model: normalizeOpenAiCompatibleModel(
          provider.slug,
          provider.default_model || openAiCompatibleConfig.defaultModel
        ),
        patientName: patient ? `${patient.first_name} ${patient.last_name}` : "",
        supportsImages: openAiCompatibleConfig.supportsImages,
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

      if (draftError) throw new Error(`${provider.name} ön raporu kaydedilemedi: ${draftError.message}`)

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
          dicomReferenceCount: visualContext.dicomReferences.length,
          imagePreviewCount: visualContext.imagePreviews.length,
          modality: study.modality,
          estimated: !draft.usage,
          responseId: draft.responseId,
        },
        created_by: user.id,
      })

      if (usageError && !isMissingAiTableError(usageError)) {
        throw new Error(`${provider.name} tüketim kaydı oluşturulamadı: ${usageError.message}`)
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
          error_message: error instanceof Error ? error.message : `${provider.name} ön raporu üretilemedi.`,
        })
        .eq("id", job.id)
        .eq("organization_id", user.organizationId)
    }
  }

  if (canRunMedGemma && medGemmaConfig) {
    try {
      const visualContext = await loadAiVisualContext({
        organizationId: user.organizationId,
        studyId,
        supabase,
      })
      assertImagePreviewsReady({
        errors: visualContext.imagePreviewErrors,
        imagePreviews: visualContext.imagePreviews,
      })
      const draft = await createMedGemmaRadiologyDraft({
        apiKey: medGemmaConfig.apiKey,
        dicomReferences: visualContext.dicomReferences,
        endpoint: medGemmaConfig.endpoint,
        endpointMode: medGemmaConfig.endpointMode,
        imagePreviewErrors: visualContext.imagePreviewErrors,
        imagePreviews: visualContext.imagePreviews,
        inputContext,
        model: provider.default_model || "medgemma-4b-it",
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

      if (draftError) throw new Error(`MedGemma ön raporu kaydedilemedi: ${draftError.message}`)

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
          dicomReferenceCount: visualContext.dicomReferences.length,
          imagePreviewCount: visualContext.imagePreviews.length,
          modality: study.modality,
          estimated: !draft.usage,
          responseId: draft.responseId,
        },
        created_by: user.id,
      })

      if (usageError && !isMissingAiTableError(usageError)) {
        throw new Error(`MedGemma tüketim kaydı oluşturulamadı: ${usageError.message}`)
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
      const errorMessage = error instanceof Error ? error.message : "MedGemma ön raporu üretilemedi."
      const endpointWaking = isMedGemmaEndpointWakingError(error)
      const nextStatus = endpointWaking ? "endpoint_waking" : "failed"

      await supabase
        .from("ai_jobs")
        .update({
          status: nextStatus,
          completed_at: new Date().toISOString(),
          error_message: errorMessage,
        })
        .eq("id", job.id)
        .eq("organization_id", user.organizationId)

      if (endpointWaking && orchestratorProviderId && orchestratorProviderSlug) {
        const fallbackFormData = new FormData()
        fallbackFormData.set("studyId", studyId)
        fallbackFormData.set("providerId", orchestratorProviderId)
        fallbackFormData.set("forceAiRunProviderId", orchestratorProviderId)
        fallbackFormData.set("orchestratorSkipSlugs", uniqueStrings([...orchestratorSkipSlugs, provider.slug]).join(","))
        fallbackFormData.set("returnTo", appendQueryIfMissing(returnTo, "aiProvider", orchestratorProviderId))
        return startAiPreReport(fallbackFormData)
      }
    }
  }

  if (canRunRaiLlm && raiLlmConfig) {
    try {
      const visualContext = await loadAiVisualContext({
        organizationId: user.organizationId,
        studyId,
        supabase,
      })
      assertImagePreviewsReady({
        errors: visualContext.imagePreviewErrors,
        imagePreviews: visualContext.imagePreviews,
      })
      const draft = await createMedGemmaRadiologyDraft({
        apiKey: raiLlmConfig.apiKey,
        defaultModelNamespace: "",
        dicomReferences: visualContext.dicomReferences,
        endpoint: raiLlmConfig.endpoint,
        endpointMode: raiLlmConfig.endpointMode,
        generator: "rai-llm-endpoint",
        imagePreviewErrors: visualContext.imagePreviewErrors,
        imagePreviews: visualContext.imagePreviews,
        inputContext,
        model: provider.default_model || "Qwen/Qwen2.5-VL-7B-Instruct",
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

      if (draftError) throw new Error(`RAI LLM ön raporu kaydedilemedi: ${draftError.message}`)

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
          dicomReferenceCount: visualContext.dicomReferences.length,
          imagePreviewCount: visualContext.imagePreviews.length,
          modality: study.modality,
          estimated: !draft.usage,
          responseId: draft.responseId,
        },
        created_by: user.id,
      })

      if (usageError && !isMissingAiTableError(usageError)) {
        throw new Error(`RAI LLM tüketim kaydı oluşturulamadı: ${usageError.message}`)
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
          error_message: error instanceof Error ? error.message : "RAI LLM ön raporu üretilemedi.",
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
  redirect(appendQuery(appendQueryIfMissing(returnTo, "aiProvider", provider.id), "aiJob", job.id))
}

function appendQuery(path: string, key: string, value: string) {
  const separator = path.includes("?") ? "&" : "?"
  return `${path}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

function parseOptionalUuid(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null
  const parsed = idSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function parseOptionalText(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

function parseOptionalCsv(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return []
  return uniqueStrings(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  )
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values))
}

function appendQueryIfMissing(path: string, key: string, value: string) {
  const [pathname, queryString] = path.split("?")
  if (!queryString) return appendQuery(path, key, value)

  const params = new URLSearchParams(queryString)
  if (params.has(key)) return path
  params.set(key, value)
  return `${pathname}?${params.toString()}`
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

type MedGemmaEndpointMode = "openai-compatible" | "rai-adapter"

type OrchestratorProviderCandidate = {
  credential_reference: string | null
  id: string
  is_active: boolean | null
  provider_type: string
  slug: string
}

type MedGemmaResponse = {
  id?: string
  responseId?: string
  output_text?: string
  findings?: string
  impression?: string
  recommendations?: string
  confidenceScore?: number
  criticality?: OpenAiDraft["criticality"]
  draft?: Partial<OpenAiDraft>
  choices?: Array<{
    message?: {
      content?: string
    }
    text?: string
  }>
  output?: Array<{
    content?: Array<{
      text?: string
      type?: string
    }>
  }>
  usage?: {
    completion_tokens?: number
    input_tokens?: number
    inputTokens?: number
    output_tokens?: number
    outputTokens?: number
    prompt_tokens?: number
  }
  error?: {
    message?: string
  }
}

const MEDGEMMA_REQUEST_TIMEOUT_MS = readPositiveIntegerEnv("RAI_MEDGEMMA_TIMEOUT_MS", 90_000)
const MEDGEMMA_MAX_ATTEMPTS = readPositiveIntegerEnv("RAI_MEDGEMMA_MAX_ATTEMPTS", 5)
const MEDGEMMA_RETRY_BASE_DELAY_MS = readPositiveIntegerEnv("RAI_MEDGEMMA_RETRY_DELAY_MS", 15_000)
const MEDGEMMA_RETRY_MAX_DELAY_MS = readPositiveIntegerEnv("RAI_MEDGEMMA_RETRY_MAX_DELAY_MS", 30_000)
const MEDGEMMA_RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504])
const RAI_ORCHESTRATOR_PRIORITY = ["rai-llm", "qwen", "deepseek", "openai", "gemini-google", "claude", "medgemma", "rai-mock"]

async function resolveRaiOrchestratorProvider({
  excludedSlugs = [],
  organizationId,
  supabase,
}: {
  excludedSlugs?: string[]
  organizationId: string
  supabase: Awaited<ReturnType<typeof createClient>>
}) {
  const { data: providers, error } = await supabase
    .from("ai_service_providers")
    .select("id, slug, provider_type, is_active, credential_reference")
    .eq("organization_id", organizationId)
    .eq("is_active", true)

  if (error) throw new Error(`RAI AI Orchestrator provider listesi alınamadı: ${error.message}`)

  const runnableProviders = ((providers ?? []) as OrchestratorProviderCandidate[])
    .filter((provider) => provider.slug !== "rai-orchestrator")
    .filter((provider) => !excludedSlugs.includes(provider.slug))
    .filter(isRunnableOrchestratorProvider)
    .sort((left, right) => orchestratorProviderRank(left) - orchestratorProviderRank(right))

  return runnableProviders[0] ?? null
}

async function findReusableAiDraftForProvider({
  organizationId,
  providerId,
  studyId,
  supabase,
}: {
  organizationId: string
  providerId: string
  studyId: string
  supabase: Awaited<ReturnType<typeof createClient>>
}) {
  const { data: drafts, error } = await supabase
    .from("ai_report_drafts")
    .select("id, ai_jobs(provider_id, input_context, status)")
    .eq("organization_id", organizationId)
    .eq("study_id", studyId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(20)

  if (error) {
    if (isMissingAiTableError(error)) return null
    throw new Error(`Mevcut AI raporu kontrol edilemedi: ${error.message}`)
  }

  for (const draft of drafts ?? []) {
    const job = firstRelation(
      draft.ai_jobs as
        | { input_context?: unknown; provider_id?: string | null; status?: string | null }
        | { input_context?: unknown; provider_id?: string | null; status?: string | null }[]
        | null
    )

    if (!job || job.status !== "draft_ready") continue
    if (job.provider_id === providerId) return { id: String(draft.id) }
    if (getOrchestratorProviderId(job.input_context) === providerId) {
      return { id: String(draft.id) }
    }
  }

  return null
}

function getOrchestratorProviderId(inputContext: unknown) {
  if (!inputContext || typeof inputContext !== "object") return null
  if (!("orchestrator" in inputContext)) return null

  const orchestrator = inputContext.orchestrator
  if (!orchestrator || typeof orchestrator !== "object") return null
  if (!("providerId" in orchestrator)) return null

  return typeof orchestrator.providerId === "string" ? orchestrator.providerId : null
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function isRunnableOrchestratorProvider(provider: OrchestratorProviderCandidate) {
  if (!provider.is_active) return false
  if (provider.provider_type === "mock") return true
  if (provider.provider_type === "openai") return hasProviderEnvValue(provider)
  if (provider.provider_type === "anthropic") return hasProviderEnvValue(provider)
  if (provider.provider_type === "google") return hasProviderEnvValue(provider)
  if (provider.provider_type === "openai-compatible" || provider.slug === "qwen") {
    return Boolean(resolveOpenAiCompatibleConfig(provider.slug, provider.provider_type, provider.credential_reference))
  }
  if (provider.slug === "medgemma") return Boolean(resolveMedGemmaConfig(provider.slug, provider.credential_reference))
  if (provider.slug === "rai-llm") return Boolean(resolveRaiLlmConfig(provider.slug, provider.credential_reference))
  return false
}

function hasProviderEnvValue(provider: OrchestratorProviderCandidate) {
  return Boolean(provider.credential_reference && process.env[provider.credential_reference]?.trim())
}

function orchestratorProviderRank(provider: OrchestratorProviderCandidate) {
  const slugRank = RAI_ORCHESTRATOR_PRIORITY.indexOf(provider.slug)
  if (slugRank >= 0) return slugRank

  switch (provider.provider_type) {
    case "openai":
      return 20
    case "google":
      return 30
    case "anthropic":
      return 40
    case "openai-compatible":
      return 45
    case "mock":
      return 90
    default:
      return 80
  }
}

async function loadAiDicomReferences({
  organizationId,
  studyId,
  supabase,
}: {
  organizationId: string
  studyId: string
  supabase: Awaited<ReturnType<typeof createClient>>
}) {
  const { data: instances, error } = await supabase
    .from("instances")
    .select("id, sop_instance_uid, instance_number, storage_bucket, storage_key, size_bytes")
    .eq("study_id", studyId)
    .eq("organization_id", organizationId)
    .order("instance_number", { ascending: true })
    .limit(8)

  if (error) throw new Error(`AI DICOM referansları alınamadı: ${error.message}`)
  if (!instances?.length) return [] satisfies AiDicomImageSource[]

  const signedUrls = new Map<string, string>()
  const instancesByBucket = instances.reduce((groups, instance) => {
    const bucketItems = groups.get(instance.storage_bucket) ?? []
    bucketItems.push(instance)
    groups.set(instance.storage_bucket, bucketItems)
    return groups
  }, new Map<string, typeof instances>())

  for (const [bucket, bucketInstances] of instancesByBucket.entries()) {
    const { data, error: signedUrlError } = await supabase.storage
      .from(bucket)
      .createSignedUrls(
        bucketInstances.map((instance) => instance.storage_key),
        15 * 60,
        { download: true }
      )

    if (signedUrlError) {
      throw new Error(`AI DICOM imzalı URL üretilemedi: ${signedUrlError.message}`)
    }

    data.forEach((signedUrl, index) => {
      const instance = bucketInstances[index]
      if (instance && signedUrl.signedUrl) signedUrls.set(instance.id, signedUrl.signedUrl)
    })
  }

  return instances
    .map((instance) => ({
      id: instance.id,
      instanceNumber: instance.instance_number ?? null,
      signedUrl: signedUrls.get(instance.id) ?? "",
      sizeBytes: Number(instance.size_bytes ?? 0),
      sopInstanceUid: instance.sop_instance_uid,
    }))
    .filter((instance) => instance.signedUrl) satisfies AiDicomImageSource[]
}

async function loadAiVisualContext({
  organizationId,
  studyId,
  supabase,
}: {
  organizationId: string
  studyId: string
  supabase: Awaited<ReturnType<typeof createClient>>
}) {
  const dicomReferences = await loadAiDicomReferences({
    organizationId,
    studyId,
    supabase,
  })
  const { errors: imagePreviewErrors, previews: imagePreviews } =
    await createAiImagePreviewsFromDicom({
      sources: dicomReferences,
    })

  return { dicomReferences, imagePreviewErrors, imagePreviews }
}

function assertImagePreviewsReady({
  errors,
  imagePreviews,
}: {
  errors: string[]
  imagePreviews: AiImagePreview[]
}) {
  if (imagePreviews.length > 0) return

  throw new Error(
    [
      "AI görüntü işleme başlatılamadı: DICOM görüntülerinden PNG önizleme üretilemedi.",
      errors.length ? `Detay: ${errors.slice(0, 3).join(" | ")}` : "Storage üzerinde okunabilir DICOM instance bulunamadı.",
    ].join(" ")
  )
}

function imagePreviewSummary(imagePreviews: AiImagePreview[], errors: string[]) {
  return {
    imagePreviewCount: imagePreviews.length,
    imagePreviewErrors: errors.slice(0, 5),
    imagePreviews: imagePreviews.map((preview) => ({
      columns: preview.columns,
      instanceNumber: preview.instanceNumber,
      label: preview.label,
      rows: preview.rows,
      sopInstanceUid: preview.sopInstanceUid,
    })),
  }
}

function resolveMedGemmaConfig(slug: string, credentialReference: string | null) {
  if (slug !== "medgemma") return null

  const referencedValue = credentialReference ? process.env[credentialReference] : undefined
  const endpointFromReference = referencedValue && isHttpUrl(referencedValue) ? referencedValue : undefined
  const endpoint = process.env.RAI_MEDGEMMA_ENDPOINT || endpointFromReference
  if (!endpoint) return null

  const apiKeyFromReference = referencedValue && !isHttpUrl(referencedValue) ? referencedValue : undefined
  const apiKey = process.env.RAI_MEDGEMMA_API_KEY || apiKeyFromReference
  const configuredMode = process.env.RAI_MEDGEMMA_ENDPOINT_MODE
  const endpointMode: MedGemmaEndpointMode =
    configuredMode === "openai-compatible" || endpoint.includes("/v1/chat/completions")
      ? "openai-compatible"
      : "rai-adapter"

  return { apiKey, endpoint, endpointMode }
}

function resolveRaiLlmConfig(slug: string, credentialReference: string | null) {
  if (slug !== "rai-llm") return null

  const referencedValue = credentialReference ? process.env[credentialReference] : undefined
  const endpointFromReference = referencedValue && isHttpUrl(referencedValue) ? referencedValue : undefined
  const endpoint = process.env.RAI_LLM_ENDPOINT || endpointFromReference
  if (!endpoint) return null

  const apiKeyFromReference = referencedValue && !isHttpUrl(referencedValue) ? referencedValue : undefined
  const apiKey = process.env.RAI_LLM_API_KEY || apiKeyFromReference
  const configuredMode = process.env.RAI_LLM_ENDPOINT_MODE
  const endpointMode: MedGemmaEndpointMode =
    configuredMode === "rai-adapter" && !endpoint.includes("/v1/chat/completions")
      ? "rai-adapter"
      : "openai-compatible"

  return { apiKey, endpoint, endpointMode }
}

function resolveOpenAiCompatibleConfig(
  slug: string,
  providerType: string,
  credentialReference: string | null
) {
  const prefix = openAiCompatibleEnvPrefix(slug, providerType)
  if (!prefix) return null

  const referencedValue = credentialReference ? process.env[credentialReference] : undefined
  const apiKey = referencedValue || process.env[`${prefix}_API_KEY`]
  if (!apiKey) return null

  return {
    apiKey,
    baseUrl: process.env[`${prefix}_BASE_URL`] || defaultOpenAiCompatibleBaseUrl(slug),
    defaultModel: process.env[`${prefix}_MODEL`] || defaultOpenAiCompatibleModel(slug),
    generator: `${slug}-openai-compatible`,
    supportsImages: openAiCompatibleSupportsImages(slug),
  }
}

function openAiCompatibleEnvPrefix(slug: string, providerType: string) {
  if (slug === "qwen") return "QWEN"
  if (slug === "deepseek") return "DEEPSEEK"
  if (providerType === "openai-compatible") {
    return slug
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
  }
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

function openAiCompatibleSupportsImages(slug: string) {
  return slug === "qwen"
}

async function createOpenAiRadiologyDraft({
  apiKey,
  imagePreviewErrors,
  imagePreviews,
  inputContext,
  model,
  patientName,
}: {
  apiKey: string
  imagePreviewErrors: string[]
  imagePreviews: AiImagePreview[]
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
        "DICOM görüntülerinden üretilmiş PNG önizlemelerini ve tetkik metadata bilgisini birlikte değerlendir.",
        "Yalnızca görüntüde ve metadata bağlamında desteklenen bulguları yaz; belirsizlikleri açıkça belirt.",
        "Sadece JSON döndür. Markdown, açıklama veya kod bloğu kullanma.",
      ].join(" "),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                task: "radiology_pre_report",
                patientName,
                study: inputContext,
                visualContext: imagePreviewSummary(imagePreviews, imagePreviewErrors),
                expectedJson: {
                  findings: "string",
                  impression: "string",
                  recommendations: "string",
                  confidenceScore: "number 0..1",
                  criticality: "none | low | medium | high",
                },
              }),
            },
            ...imagePreviews.map((preview) => ({
              detail: "high",
              image_url: preview.dataUrl,
              type: "input_image",
            })),
          ],
        },
      ],
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
      imagePreviewCount: imagePreviews.length,
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
  imagePreviewErrors,
  imagePreviews,
  inputContext,
  model,
  patientName,
}: {
  apiKey: string
  imagePreviewErrors: string[]
  imagePreviews: AiImagePreview[]
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
          content: [
            ...imagePreviews.map((preview) => ({
              source: {
                data: preview.base64,
                media_type: preview.mimeType,
                type: "base64",
              },
              type: "image",
            })),
            {
              text: JSON.stringify({
                task: "radiology_pre_report",
                patientName,
                study: inputContext,
                visualContext: imagePreviewSummary(imagePreviews, imagePreviewErrors),
                expectedJson: {
                  findings: "string",
                  impression: "string",
                  recommendations: "string",
                  confidenceScore: "number 0..1",
                  criticality: "none | low | medium | high",
                },
              }),
              type: "text",
            },
          ],
        },
      ],
      model,
      system: [
        "Sen radyoloji ön rapor asistanısın.",
        "Tanı koymazsın; yalnızca hekimin düzenleyip onaylayacağı Türkçe bir ön rapor taslağı hazırlarsın.",
        "DICOM görüntülerinden üretilmiş PNG önizlemelerini ve tetkik metadata bilgisini birlikte değerlendir.",
        "Yalnızca görüntüde ve metadata bağlamında desteklenen bulguları yaz; belirsizlikleri açıkça belirt.",
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
      imagePreviewCount: imagePreviews.length,
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

async function createOpenAiCompatibleRadiologyDraft({
  apiKey,
  baseUrl,
  generator,
  imagePreviewErrors,
  imagePreviews,
  inputContext,
  model,
  patientName,
  supportsImages,
}: {
  apiKey: string
  baseUrl: string
  generator: string
  imagePreviewErrors: string[]
  imagePreviews: AiImagePreview[]
  inputContext: Record<string, unknown>
  model: string
  patientName: string
  supportsImages: boolean
}): Promise<OpenAiDraft> {
  if (!baseUrl) throw new Error("OpenAI-compatible provider endpoint tanımlı değil.")

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          content: [
            "Sen radyoloji ön rapor asistanısın.",
            "Tanı koymazsın; yalnızca hekimin düzenleyip onaylayacağı Türkçe bir ön rapor taslağı hazırlarsın.",
            "DICOM görüntülerinden üretilmiş PNG önizlemelerini ve tetkik metadata bilgisini birlikte değerlendir.",
            "Yalnızca görüntüde ve metadata bağlamında desteklenen bulguları yaz; belirsizlikleri açıkça belirt.",
            "Bulgular ve izlenim alanlarını kısa tut; her biri en fazla 3 cümle olsun.",
            "Sadece JSON döndür. Markdown, açıklama veya kod bloğu kullanma.",
          ].join(" "),
          role: "system",
        },
        {
          content: [
            {
              text: JSON.stringify({
                expectedJson: {
                  confidenceScore: "number 0..1",
                  criticality: "none | low | medium | high",
                  findings: "string",
                  impression: "string",
                  recommendations: "string",
                },
                patientName,
                study: inputContext,
                task: "radiology_pre_report",
                visualContext: imagePreviewSummary(imagePreviews, imagePreviewErrors),
              }),
              type: "text",
            },
            ...(supportsImages
              ? imagePreviews.map((preview) => ({
                  image_url: { url: preview.dataUrl },
                  type: "image_url",
                }))
              : []),
          ],
          role: "user",
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  })

  const payload = (await response.json().catch(() => null)) as MedGemmaResponse | null
  if (!response.ok) {
    const message =
      payload?.error?.message || `OpenAI-compatible provider isteği başarısız oldu (${response.status}).`
    throw new Error(message)
  }

  const text = extractMedGemmaOutputText(payload, JSON.stringify(payload ?? {}))
  const parsed = parseOpenAiDraftJson(text)

  return {
    confidenceScore: parsed.confidenceScore,
    criticality: parsed.criticality,
    findings: parsed.findings,
    impression: parsed.impression,
    recommendations: parsed.recommendations,
    responseId: payload?.id ?? payload?.responseId,
    sourceSummary: {
      generator,
      imagePreviewCount: imagePreviews.length,
      inputContext,
      model,
    },
    usage: extractMedGemmaUsage(payload),
  }
}

async function createGeminiRadiologyDraft({
  apiKey,
  imagePreviewErrors,
  imagePreviews,
  inputContext,
  model,
  patientName,
}: {
  apiKey: string
  imagePreviewErrors: string[]
  imagePreviews: AiImagePreview[]
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
                  "DICOM görüntülerinden üretilmiş PNG önizlemelerini ve tetkik metadata bilgisini birlikte değerlendir.",
                  "Yalnızca görüntüde ve metadata bağlamında desteklenen bulguları yaz; belirsizlikleri açıkça belirt.",
                  "Bulgular ve izlenim alanlarını kısa tut; her biri en fazla 3 cümle olsun.",
                  "Sadece JSON döndür. Markdown, açıklama veya kod bloğu kullanma.",
                  JSON.stringify({
                    task: "radiology_pre_report",
                    patientName,
                    study: inputContext,
                    visualContext: imagePreviewSummary(imagePreviews, imagePreviewErrors),
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
              ...imagePreviews.map((preview) => ({
                inlineData: {
                  data: preview.base64,
                  mimeType: preview.mimeType,
                },
              })),
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
      imagePreviewCount: imagePreviews.length,
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

async function createMedGemmaRadiologyDraft({
  apiKey,
  defaultModelNamespace = "google",
  dicomReferences,
  endpoint,
  endpointMode,
  generator = "medgemma-endpoint",
  imagePreviewErrors,
  imagePreviews,
  inputContext,
  model,
  patientName,
}: {
  apiKey?: string
  defaultModelNamespace?: string
  dicomReferences: AiDicomImageSource[]
  endpoint: string
  endpointMode: MedGemmaEndpointMode
  generator?: string
  imagePreviewErrors: string[]
  imagePreviews: AiImagePreview[]
  inputContext: Record<string, unknown>
  model: string
  patientName: string
}): Promise<OpenAiDraft> {
  const endpointModel =
    endpointMode === "openai-compatible" && defaultModelNamespace && !model.includes("/")
      ? `${defaultModelNamespace}/${model}`
      : model
  const instructions = [
    "Sen radyoloji ön rapor asistanısın.",
    "Tanı koymazsın; yalnızca hekimin düzenleyip onaylayacağı Türkçe bir ön rapor taslağı hazırlarsın.",
    "DICOM görüntülerinden üretilmiş PNG önizlemelerini ve tetkik metadata bilgisini birlikte değerlendir.",
    "Yalnızca görüntüde ve metadata bağlamında desteklenen bulguları yaz; belirsizlikleri açıkça belirt.",
    "Bulgular ve izlenim alanlarını kısa tut; her biri en fazla 3 cümle olsun.",
    "Sadece JSON döndür. Markdown, açıklama veya kod bloğu kullanma.",
  ]
  const expectedJson = {
    findings: "string",
    impression: "string",
    recommendations: "string",
    confidenceScore: "number 0..1",
    criticality: "none | low | medium | high",
  }
  const taskPayload = {
    dicomReferences,
    expectedJson,
    imagePreviewErrors,
    imagePreviews: imagePreviews.map((preview) => ({
      data: preview.base64,
      instanceNumber: preview.instanceNumber,
      label: preview.label,
      mimeType: preview.mimeType,
      sopInstanceUid: preview.sopInstanceUid,
    })),
    patientName,
    study: inputContext,
    task: "radiology_pre_report",
    visualContext: imagePreviewSummary(imagePreviews, imagePreviewErrors),
  }
  const body =
    endpointMode === "openai-compatible"
      ? {
          model: endpointModel,
          messages: [
            { content: instructions.join(" "), role: "system" },
            {
              content: [
                { text: JSON.stringify(taskPayload), type: "text" },
                ...imagePreviews.map((preview) => ({
                  image_url: { url: preview.dataUrl },
                  type: "image_url",
                })),
              ],
              role: "user",
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
        }
      : {
          ...taskPayload,
          instructions,
          model,
        }

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    const result = await postMedGemmaEndpoint({
      body,
      endpoint,
      headers,
    })

    const parsed = extractMedGemmaDraft(result.payload, result.rawText)

    return {
      findings: parsed.findings,
      impression: parsed.impression,
      recommendations: parsed.recommendations,
      confidenceScore: parsed.confidenceScore,
      criticality: parsed.criticality,
      sourceSummary: {
        dicomReferenceCount: dicomReferences.length,
        endpoint: safeEndpointLabel(endpoint),
        endpointMode,
        generator,
        imagePreviewCount: imagePreviews.length,
        inputContext,
        model: endpointModel,
        requestAttempts: result.attemptCount,
      },
      usage: extractMedGemmaUsage(result.payload),
      responseId: result.payload?.responseId ?? result.payload?.id,
    }
  } catch (error) {
    throw normalizeMedGemmaError(error)
  }
}

function extractMedGemmaDraft(payload: MedGemmaResponse | null, rawText: string) {
  if (payload?.draft) return normalizeDraftJson(payload.draft)
  if (payload?.findings || payload?.impression) {
    return normalizeDraftJson({
      confidenceScore: payload.confidenceScore,
      criticality: payload.criticality,
      findings: payload.findings,
      impression: payload.impression,
      recommendations: payload.recommendations,
    })
  }

  const text = extractMedGemmaOutputText(payload, rawText)
  return parseOpenAiDraftJson(text)
}

async function postMedGemmaEndpoint({
  body,
  endpoint,
  headers,
}: {
  body: unknown
  endpoint: string
  headers: Record<string, string>
}) {
  let lastError: Error | null = null

  for (let attemptIndex = 0; attemptIndex < MEDGEMMA_MAX_ATTEMPTS; attemptIndex += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), MEDGEMMA_REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify(body),
        cache: "no-store",
        headers,
        method: "POST",
        signal: controller.signal,
      })
      const rawText = await response.text()
      const payload = parseJsonResponse(rawText) as MedGemmaResponse | null

      if (response.ok) {
        return {
          attemptCount: attemptIndex + 1,
          payload,
          rawText,
        }
      }

      const message =
        payload?.error?.message ||
        rawText.trim() ||
        `MedGemma endpoint isteği başarısız oldu (${response.status}).`
      const endpointError = new Error(message)

      if (!isRetryableMedGemmaStatus(response.status) || attemptIndex === MEDGEMMA_MAX_ATTEMPTS - 1) {
        throw endpointError
      }

      lastError = endpointError
      await waitForMedGemmaRetryDelay(attemptIndex, response.headers.get("retry-after"))
    } catch (error) {
      const endpointError = error instanceof Error ? error : new Error("MedGemma endpoint isteği başarısız oldu.")
      const canRetry = isRetryableMedGemmaError(endpointError) && attemptIndex < MEDGEMMA_MAX_ATTEMPTS - 1

      if (!canRetry) {
        throw addMedGemmaAttemptContext(endpointError, attemptIndex + 1)
      }

      lastError = endpointError
      await waitForMedGemmaRetryDelay(attemptIndex)
    } finally {
      clearTimeout(timeout)
    }
  }

  throw addMedGemmaAttemptContext(lastError ?? new Error("MedGemma endpoint yanıt vermedi."), MEDGEMMA_MAX_ATTEMPTS)
}

function isRetryableMedGemmaStatus(status: number) {
  return MEDGEMMA_RETRYABLE_STATUS_CODES.has(status)
}

function isRetryableMedGemmaError(error: Error) {
  return error.name === "AbortError" || error.message.includes("503") || error.message.includes("fetch failed")
}

function addMedGemmaAttemptContext(error: Error, attemptCount: number) {
  if (error.name === "AbortError") {
    return new Error(
      `MedGemma endpoint ${attemptCount} deneme sonunda zaman aşımına uğradı. Endpoint uyanıyor veya yoğun olabilir; lütfen birazdan tekrar deneyin.`
    )
  }

  if (isMedGemmaServiceUnavailable(error)) {
    return new Error(
      `MedGemma endpoint ${attemptCount} deneme sonunda hazır hale gelemedi. Hugging Face endpoint uykudan uyanıyor veya geçici olarak servis veremiyor. Birkaç dakika sonra tekrar deneyin.`
    )
  }

  return new Error(
    `MedGemma endpoint ${attemptCount} deneme sonunda yanıt veremedi. Son hata: ${error.message}`
  )
}

function normalizeMedGemmaError(error: unknown) {
  if (!(error instanceof Error)) return new Error("MedGemma ön raporu üretilemedi.")
  if (error.name === "AbortError") return new Error("MedGemma endpoint zaman aşımına uğradı.")
  return error
}

async function waitForMedGemmaRetryDelay(attemptIndex: number, retryAfterHeader?: string | null) {
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader)
  const exponentialDelayMs = MEDGEMMA_RETRY_BASE_DELAY_MS * 2 ** attemptIndex
  const delayMs = Math.min(retryAfterMs ?? exponentialDelayMs, MEDGEMMA_RETRY_MAX_DELAY_MS)
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

function isMedGemmaServiceUnavailable(error: Error) {
  return error.message.includes("503") || error.message.includes("SERVICE_UNAVAILABLE")
}

function isMedGemmaEndpointWakingError(error: unknown) {
  if (!(error instanceof Error)) return false
  return (
    error.message.includes("hazır hale gelemedi") ||
    error.message.includes("uykudan uyanıyor") ||
    error.message.includes("geçici olarak servis veremiyor") ||
    error.message.includes("SERVICE_UNAVAILABLE") ||
    error.message.includes("503")
  )
}

function parseRetryAfterMs(value?: string | null) {
  if (!value) return null

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000

  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return null

  return Math.max(timestamp - Date.now(), 0)
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function extractMedGemmaOutputText(payload: MedGemmaResponse | null, rawText: string) {
  if (payload?.output_text) return payload.output_text

  const choiceText =
    payload?.choices
      ?.map((choice) => choice.message?.content ?? choice.text)
      .filter(Boolean)
      .join("\n")
      .trim() ?? ""
  if (choiceText) return choiceText

  const outputText =
    payload?.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text)
      .filter(Boolean)
      .join("\n")
      .trim() ?? ""
  if (outputText) return outputText

  const text = rawText.trim()
  if (!text) throw new Error("MedGemma boş ön rapor döndürdü.")
  return text
}

function extractMedGemmaUsage(payload: MedGemmaResponse | null) {
  const inputTokens = payload?.usage?.prompt_tokens ?? payload?.usage?.input_tokens ?? payload?.usage?.inputTokens
  const outputTokens =
    payload?.usage?.completion_tokens ?? payload?.usage?.output_tokens ?? payload?.usage?.outputTokens

  return typeof inputTokens === "number" && typeof outputTokens === "number"
    ? { inputTokens, outputTokens }
    : undefined
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
  let parsed: Partial<OpenAiDraft>
  try {
    parsed = JSON.parse(cleanText) as Partial<OpenAiDraft>
  } catch (error) {
    const recovered = recoverDraftFromLooseJson(cleanText)
    if (recovered) return recovered
    throw error
  }

  return normalizeDraftJson(parsed)
}

function normalizeDraftJson(parsed: Partial<OpenAiDraft>) {
  const criticality = ["none", "low", "medium", "high"].includes(String(parsed.criticality))
    ? (parsed.criticality as OpenAiDraft["criticality"])
    : "none"

  return {
    findings: String(parsed.findings ?? "").trim() || "AI bulgu taslağı boş döndü.",
    impression: String(parsed.impression ?? "").trim() || "AI sonuç taslağı boş döndü.",
    recommendations: String(parsed.recommendations ?? "").trim(),
    confidenceScore:
      typeof parsed.confidenceScore === "number"
        ? Math.min(1, Math.max(0, parsed.confidenceScore))
        : 0.5,
    criticality,
  }
}

function recoverDraftFromLooseJson(text: string) {
  const findings = extractLooseJsonString(text, "findings")
  const impression = extractLooseJsonString(text, "impression")
  const recommendations = extractLooseJsonString(text, "recommendations")
  const criticality = extractLooseJsonString(text, "criticality")
  const confidenceMatch = text.match(/"confidenceScore"\s*:\s*([0-9.]+)/)
  const confidenceScore = confidenceMatch ? Number(confidenceMatch[1]) : 0.25

  if (!findings && !impression) return null

  return normalizeDraftJson({
    criticality: criticality as OpenAiDraft["criticality"],
    confidenceScore: Number.isFinite(confidenceScore) ? confidenceScore : 0.25,
    findings:
      findings ||
      "AI sağlayıcısı bulgular alanını eksik döndürdü; yanıt kısmi olarak kurtarıldı.",
    impression:
      impression ||
      "AI sağlayıcısı izlenim alanını eksik döndürdü; bu taslak düşük güven skoru ile kontrol edilmelidir.",
    recommendations:
      recommendations ||
      "Yanıt formatı eksik geldiği için hekim kontrolü ve gerekirse yeniden AI çalıştırma önerilir.",
  })
}

function extractLooseJsonString(text: string, field: string) {
  const fieldIndex = text.indexOf(`"${field}"`)
  if (fieldIndex === -1) return ""

  const colonIndex = text.indexOf(":", fieldIndex)
  if (colonIndex === -1) return ""

  const firstQuoteIndex = text.indexOf('"', colonIndex + 1)
  if (firstQuoteIndex === -1) return ""

  let value = ""
  let escaped = false
  for (let index = firstQuoteIndex + 1; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) {
      value += `\\${char}`
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === '"') break
    value += char
  }

  return decodeLooseJsonString(value).trim()
}

function decodeLooseJsonString(value: string) {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string
  } catch {
    return value.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
  }
}

function parseJsonResponse(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function safeEndpointLabel(value: string) {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return "custom-medgemma-endpoint"
  }
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value)
}
