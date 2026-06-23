"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { requireAdmin } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/config"
import { createClient } from "@/lib/supabase/server"

const idSchema = z.string().uuid()
const optionalUuidSchema = z.preprocess(
  (value) => {
    const text = String(value ?? "").trim()
    return text || null
  },
  z.string().uuid().nullable()
)
const returnToSchema = z.preprocess(
  (value) => {
    const text = String(value ?? "").trim()
    return text || undefined
  },
  z
    .string()
    .refine((value) => value.startsWith("/") && !value.startsWith("//"))
    .optional()
)

const hisIntegrationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  vendor: z.string().trim().max(120).optional(),
  branchId: optionalUuidSchema,
  protocol: z.enum(["hl7_v2_mllp", "fhir_r4", "rest_api", "webhook", "file_drop"]),
  direction: z.enum(["inbound", "outbound", "bidirectional"]),
  authType: z.enum([
    "none",
    "basic",
    "bearer",
    "oauth2_client_credentials",
    "mutual_tls",
    "vpn",
  ]),
  endpointUrl: z.string().trim().max(500).optional(),
  host: z.string().trim().max(255).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional().nullable(),
  sendingApplication: z.string().trim().max(80).optional(),
  sendingFacility: z.string().trim().max(80).optional(),
  receivingApplication: z.string().trim().max(80).optional(),
  receivingFacility: z.string().trim().max(80).optional(),
  enabledMessageTypes: z.string().trim().max(500).optional(),
  patientIdStrategy: z.string().trim().max(80).optional(),
  accessionStrategy: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(1200).optional(),
})

type StorageObjectRef = {
  storage_bucket: string
  storage_key: string
}

export async function deleteStudy(formData: FormData) {
  const user = await requireAdmin()
  if (!isSupabaseConfigured) redirect("/worklist")

  const studyId = idSchema.parse(formData.get("studyId"))
  const returnTo = returnToSchema.parse(String(formData.get("returnTo") ?? "")) || "/worklist"
  const supabase = await createClient()

  const { data: study, error: studyError } = await supabase
    .from("studies")
    .select("id, patient_id")
    .eq("id", studyId)
    .eq("organization_id", user.organizationId)
    .maybeSingle()

  if (studyError) throw new Error(`Tetkik bulunamadı: ${studyError.message}`)
  if (!study) redirect(returnTo)

  const { data: instances, error: instancesError } = await supabase
    .from("instances")
    .select("storage_bucket, storage_key")
    .eq("study_id", study.id)
    .eq("organization_id", user.organizationId)

  if (instancesError) {
    throw new Error(`DICOM dosya referansları alınamadı: ${instancesError.message}`)
  }

  await removeStorageObjects(instances ?? [])

  const { error: deleteError } = await supabase
    .from("studies")
    .delete()
    .eq("id", study.id)
    .eq("organization_id", user.organizationId)

  if (deleteError) throw new Error(`Tetkik silinemedi: ${deleteError.message}`)

  await supabase.from("audit_logs").insert({
    organization_id: user.organizationId,
    actor_id: user.id,
    action: "study.deleted",
    resource_type: "study",
    resource_id: study.id,
    metadata: { patientId: study.patient_id },
  })

  revalidatePath("/worklist")
  revalidatePath("/patients")
  revalidatePath(`/patients/${study.patient_id}`)
  redirect(returnTo)
}

export async function deletePatient(formData: FormData) {
  const user = await requireAdmin()
  if (!isSupabaseConfigured) redirect("/patients")

  const patientId = idSchema.parse(formData.get("patientId"))
  const supabase = await createClient()

  const { data: patient, error: patientError } = await supabase
    .from("patients")
    .select("id, patient_number")
    .eq("id", patientId)
    .eq("organization_id", user.organizationId)
    .maybeSingle()

  if (patientError) throw new Error(`Hasta bulunamadı: ${patientError.message}`)
  if (!patient) redirect("/patients")

  const { data: studies, error: studiesError } = await supabase
    .from("studies")
    .select("id")
    .eq("patient_id", patient.id)
    .eq("organization_id", user.organizationId)

  if (studiesError) throw new Error(`Hasta tetkikleri alınamadı: ${studiesError.message}`)

  const studyIds = (studies ?? []).map((study) => study.id)
  const { data: instances, error: instancesError } = studyIds.length
    ? await supabase
        .from("instances")
        .select("storage_bucket, storage_key")
        .in("study_id", studyIds)
        .eq("organization_id", user.organizationId)
    : { data: [], error: null }

  if (instancesError) {
    throw new Error(`DICOM dosya referansları alınamadı: ${instancesError.message}`)
  }

  await removeStorageObjects(instances ?? [])

  if (studyIds.length) {
    const { error: deleteStudiesError } = await supabase
      .from("studies")
      .delete()
      .in("id", studyIds)
      .eq("organization_id", user.organizationId)

    if (deleteStudiesError) {
      throw new Error(`Hasta tetkikleri silinemedi: ${deleteStudiesError.message}`)
    }
  }

  const { error: deletePatientError } = await supabase
    .from("patients")
    .delete()
    .eq("id", patient.id)
    .eq("organization_id", user.organizationId)

  if (deletePatientError) {
    throw new Error(`Hasta silinemedi: ${deletePatientError.message}`)
  }

  await supabase.from("audit_logs").insert({
    organization_id: user.organizationId,
    actor_id: user.id,
    action: "patient.deleted",
    resource_type: "patient",
    resource_id: patient.id,
    metadata: {
      patientNumber: patient.patient_number,
      studyCount: studyIds.length,
    },
  })

  revalidatePath("/patients")
  revalidatePath("/worklist")
  redirect("/patients")
}

export async function createHisIntegration(formData: FormData) {
  const user = await requireAdmin()
  if (!isSupabaseConfigured) redirect("/admin/his-integration")

  const values = hisIntegrationSchema.parse({
    name: formData.get("name"),
    vendor: formData.get("vendor"),
    branchId: formData.get("branchId"),
    protocol: formData.get("protocol"),
    direction: formData.get("direction"),
    authType: formData.get("authType"),
    endpointUrl: formData.get("endpointUrl"),
    host: formData.get("host"),
    port: String(formData.get("port") ?? "").trim() || null,
    sendingApplication: formData.get("sendingApplication"),
    sendingFacility: formData.get("sendingFacility"),
    receivingApplication: formData.get("receivingApplication"),
    receivingFacility: formData.get("receivingFacility"),
    enabledMessageTypes: formData.get("enabledMessageTypes"),
    patientIdStrategy: formData.get("patientIdStrategy"),
    accessionStrategy: formData.get("accessionStrategy"),
    notes: formData.get("notes"),
  })

  const supabase = await createClient()
  const messageTypes = (values.enabledMessageTypes ?? "")
    .split(/[,\n]/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)

  if (values.branchId) {
    const { data: branch, error: branchError } = await supabase
      .from("branches")
      .select("id")
      .eq("id", values.branchId)
      .eq("organization_id", user.organizationId)
      .maybeSingle()

    if (branchError) throw new Error(`Şube doğrulanamadı: ${branchError.message}`)
    if (!branch) throw new Error("Seçilen şube bulunamadı.")
  }

  const { data, error } = await supabase
    .from("his_integrations")
    .insert({
      organization_id: user.organizationId,
      branch_id: values.branchId,
      name: values.name,
      vendor: values.vendor || null,
      protocol: values.protocol,
      direction: values.direction,
      auth_type: values.authType,
      endpoint_url: values.endpointUrl || null,
      host: values.host || null,
      port: values.port ?? null,
      sending_application: values.sendingApplication || null,
      sending_facility: values.sendingFacility || null,
      receiving_application: values.receivingApplication || null,
      receiving_facility: values.receivingFacility || null,
      enabled_message_types: messageTypes,
      patient_id_strategy: values.patientIdStrategy || "patient_number",
      accession_strategy: values.accessionStrategy || "his_accession",
      notes: values.notes || null,
      created_by: user.id,
      settings: {
        mllp: {
          ackMode: "application_ack",
          charset: "UTF-8",
        },
        fhir: {
          version: "R4",
          resources: ["Patient", "ServiceRequest", "DiagnosticReport", "Observation"],
        },
      },
    })
    .select("id")
    .single()

  if (error) throw new Error(`HIS entegrasyonu kaydedilemedi: ${error.message}`)

  await supabase.from("his_integration_events").insert({
    organization_id: user.organizationId,
    branch_id: values.branchId,
    integration_id: data.id,
    event_type: "definition_created",
    direction: values.direction,
    message_type: messageTypes[0] ?? null,
    status: "observed",
    message: "HIS entegrasyon tanımı oluşturuldu",
    metadata: {
      protocol: values.protocol,
      authType: values.authType,
      messageTypes,
    },
  })

  revalidatePath("/admin/his-integration")
  redirect("/admin/his-integration")
}

async function removeStorageObjects(instances: StorageObjectRef[]) {
  const supabase = await createClient()
  const byBucket = new Map<string, string[]>()

  instances.forEach((instance) => {
    if (!instance.storage_bucket || !instance.storage_key) return

    const paths = byBucket.get(instance.storage_bucket) ?? []
    paths.push(instance.storage_key)
    byBucket.set(instance.storage_bucket, paths)
  })

  for (const [bucket, paths] of byBucket) {
    const uniquePaths = Array.from(new Set(paths))
    const { error } = await supabase.storage.from(bucket).remove(uniquePaths)
    if (error) throw new Error(`Storage temizlenemedi: ${error.message}`)
  }
}
