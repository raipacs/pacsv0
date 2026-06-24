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
    .select("id, name, slug, provider_type, default_model, is_active, requires_credentials")
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
  const now = new Date().toISOString()
  const jobStatus = isMock ? "draft_ready" : "waiting_credentials"
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
      error_message: isMock ? null : "AI sağlayıcı hesabı/anahtarı tanımlanınca çalıştırılacak.",
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
