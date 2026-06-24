"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { requireTableManager } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/config"
import { createClient } from "@/lib/supabase/server"

const idSchema = z.string().uuid()
const optionalIdSchema = z.preprocess(
  (value) => {
    const text = String(value ?? "").trim()
    return text || null
  },
  z.string().uuid().nullable()
)
const returnToSchema = z
  .string()
  .trim()
  .refine((value) => value.startsWith("/") && !value.startsWith("//"))

export async function saveReportDraft(formData: FormData) {
  await persistReport(formData, "draft")
}

export async function finalizeReport(formData: FormData) {
  await persistReport(formData, "final")
}

async function persistReport(formData: FormData, targetStatus: "draft" | "final") {
  const user = await requireTableManager("reports", targetStatus === "final" ? "update" : "insert")
  if (!isSupabaseConfigured) redirect("/worklist")

  const studyId = idSchema.parse(formData.get("studyId"))
  const reportId = optionalIdSchema.parse(formData.get("reportId"))
  const returnTo = returnToSchema.parse(String(formData.get("returnTo") ?? `/viewer/${studyId}`))
  const findings = z.string().trim().min(1).max(12000).parse(formData.get("findings"))
  const impression = z.string().trim().min(1).max(6000).parse(formData.get("impression"))
  const supabase = await createClient()

  const { data: study, error: studyError } = await supabase
    .from("studies")
    .select("id")
    .eq("id", studyId)
    .eq("organization_id", user.organizationId)
    .maybeSingle()

  if (studyError) throw new Error(`Rapor tetkiki doğrulanamadı: ${studyError.message}`)
  if (!study) throw new Error("Rapor için tetkik bulunamadı.")

  const statusPayload =
    targetStatus === "final"
      ? { status: "final", finalized_at: new Date().toISOString() }
      : { status: "draft", finalized_at: null }

  let savedReportId = reportId
  if (reportId) {
    const { error } = await supabase
      .from("reports")
      .update({
        findings,
        impression,
        ...statusPayload,
      })
      .eq("id", reportId)
      .eq("organization_id", user.organizationId)
      .eq("study_id", studyId)

    if (error) throw new Error(`Rapor güncellenemedi: ${error.message}`)
  } else {
    const { data: latestReport, error: latestError } = await supabase
      .from("reports")
      .select("version")
      .eq("organization_id", user.organizationId)
      .eq("study_id", studyId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latestError) throw new Error(`Rapor versiyonu alınamadı: ${latestError.message}`)

    const { data: report, error } = await supabase
      .from("reports")
      .insert({
        organization_id: user.organizationId,
        study_id: studyId,
        author_id: user.id,
        findings,
        impression,
        version: (latestReport?.version ?? 0) + 1,
        ...statusPayload,
      })
      .select("id")
      .single()

    if (error) throw new Error(`Rapor oluşturulamadı: ${error.message}`)
    savedReportId = report.id
  }

  await supabase.from("audit_logs").insert({
    organization_id: user.organizationId,
    actor_id: user.id,
    action: targetStatus === "final" ? "report.finalized" : "report.draft_saved",
    resource_type: "report",
    resource_id: savedReportId ?? studyId,
    metadata: { studyId },
  })

  revalidatePath(`/viewer/${studyId}`)
  redirect(appendQuery(returnTo, targetStatus === "final" ? "report" : "draft", savedReportId ?? "saved"))
}

function appendQuery(path: string, key: string, value: string) {
  const separator = path.includes("?") ? "&" : "?"
  return `${path}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}
