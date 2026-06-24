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
const memberRoleSchema = z.enum(["admin", "doctor"])
const permissionTableSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9_]+$/)

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

type HisIntegrationTestRow = {
  id: string
  organization_id: string
  branch_id: string | null
  name: string
  protocol: "hl7_v2_mllp" | "fhir_r4" | "rest_api" | "webhook" | "file_drop"
  direction: "inbound" | "outbound" | "bidirectional"
  auth_type:
    | "none"
    | "basic"
    | "bearer"
    | "oauth2_client_credentials"
    | "mutual_tls"
    | "vpn"
  endpoint_url: string | null
  host: string | null
  port: number | null
  enabled_message_types: string[] | null
}

type StorageObjectRef = {
  storage_bucket: string
  storage_key: string
}

export async function updateMemberAccess(formData: FormData) {
  const user = await requireAdmin()
  if (!isSupabaseConfigured) redirect("/admin/users")

  const memberUserId = idSchema.parse(formData.get("memberUserId"))
  const role = memberRoleSchema.parse(formData.get("role"))
  const branchId = optionalUuidSchema.parse(formData.get("branchId"))
  const isActive = formData.get("isActive") === "on"
  const supabase = await createClient()

  const { error } = await supabase
    .from("organization_members")
    .update({
      role,
      branch_id: branchId,
      is_active: isActive,
    })
    .eq("organization_id", user.organizationId)
    .eq("user_id", memberUserId)

  if (error) throw new Error(`Kullanıcı erişimi güncellenemedi: ${error.message}`)

  await supabase.from("audit_logs").insert({
    organization_id: user.organizationId,
    actor_id: user.id,
    action: "member.access_updated",
    resource_type: "organization_member",
    resource_id: memberUserId,
    metadata: { role, branchId, isActive },
  })

  revalidatePath("/admin/users")
  redirect("/admin/users")
}

export async function createAccessGroup(formData: FormData) {
  const user = await requireAdmin()
  if (!isSupabaseConfigured) redirect("/admin/users")

  const name = z.string().trim().min(2).max(80).parse(formData.get("name"))
  const description = z
    .string()
    .trim()
    .max(240)
    .optional()
    .parse(String(formData.get("description") ?? "").trim() || undefined)
  const supabase = await createClient()
  const slug = slugifyGroupName(name)

  const { error } = await supabase.from("access_groups").insert({
    organization_id: user.organizationId,
    name,
    slug,
    description: description ?? null,
    created_by: user.id,
  })

  if (error) throw new Error(`Grup oluşturulamadı: ${error.message}`)

  await supabase.from("audit_logs").insert({
    organization_id: user.organizationId,
    actor_id: user.id,
    action: "access_group.created",
    resource_type: "access_group",
    metadata: { name, slug },
  })

  revalidatePath("/admin/users")
  redirect("/admin/users")
}

export async function updateGroupMembership(formData: FormData) {
  const user = await requireAdmin()
  if (!isSupabaseConfigured) redirect("/admin/users")

  const memberUserId = idSchema.parse(formData.get("memberUserId"))
  const groupId = idSchema.parse(formData.get("groupId"))
  const intent = z.enum(["add", "remove"]).parse(formData.get("intent"))
  const supabase = await createClient()

  if (intent === "add") {
    const { error } = await supabase.from("access_group_members").upsert(
      {
        organization_id: user.organizationId,
        group_id: groupId,
        user_id: memberUserId,
        is_active: true,
        added_by: user.id,
      },
      { onConflict: "group_id,user_id" }
    )

    if (error) throw new Error(`Grup üyeliği eklenemedi: ${error.message}`)
  } else {
    const { error } = await supabase
      .from("access_group_members")
      .delete()
      .eq("organization_id", user.organizationId)
      .eq("group_id", groupId)
      .eq("user_id", memberUserId)

    if (error) throw new Error(`Grup üyeliği kaldırılamadı: ${error.message}`)
  }

  await supabase.from("audit_logs").insert({
    organization_id: user.organizationId,
    actor_id: user.id,
    action: intent === "add" ? "access_group.member_added" : "access_group.member_removed",
    resource_type: "access_group",
    resource_id: groupId,
    metadata: { memberUserId },
  })

  revalidatePath("/admin/users")
  redirect("/admin/users")
}

export async function updateGroupPermission(formData: FormData) {
  const user = await requireAdmin()
  if (!isSupabaseConfigured) redirect("/admin/users")

  const groupId = idSchema.parse(formData.get("groupId"))
  const tableName = permissionTableSchema.parse(formData.get("tableName"))
  const permission = {
    can_select: formData.get("canSelect") === "on",
    can_insert: formData.get("canInsert") === "on",
    can_update: formData.get("canUpdate") === "on",
    can_delete: formData.get("canDelete") === "on",
  }
  const supabase = await createClient()

  const { error } = await supabase.from("group_table_permissions").upsert(
    {
      organization_id: user.organizationId,
      group_id: groupId,
      table_name: tableName,
      ...permission,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "group_id,table_name" }
  )

  if (error) throw new Error(`Grup yetkisi güncellenemedi: ${error.message}`)

  await supabase.from("audit_logs").insert({
    organization_id: user.organizationId,
    actor_id: user.id,
    action: "access_group.permission_updated",
    resource_type: "group_table_permission",
    resource_id: groupId,
    metadata: { tableName, permission },
  })

  revalidatePath("/admin/users")
  redirect("/admin/users")
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

export async function testHisIntegration(formData: FormData) {
  const user = await requireAdmin()
  if (!isSupabaseConfigured) redirect("/admin/his-integration")

  const integrationId = idSchema.parse(formData.get("integrationId"))
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("his_integrations")
    .select(
      "id, organization_id, branch_id, name, protocol, direction, auth_type, endpoint_url, host, port, enabled_message_types"
    )
    .eq("id", integrationId)
    .eq("organization_id", user.organizationId)
    .maybeSingle()

  if (error) throw new Error(`HIS tanımı okunamadı: ${error.message}`)
  if (!data) throw new Error("HIS tanımı bulunamadı.")

  const integration = data as HisIntegrationTestRow
  const result = evaluateHisIntegration(integration)
  const now = new Date().toISOString()

  const { error: updateError } = await supabase
    .from("his_integrations")
    .update({
      status: result.success ? "active" : "error",
      last_checked_at: now,
      last_success_at: result.success ? now : null,
      last_error_at: result.success ? null : now,
      last_error_message: result.success ? null : result.message,
    })
    .eq("id", integration.id)
    .eq("organization_id", user.organizationId)

  if (updateError) {
    throw new Error(`HIS test sonucu kaydedilemedi: ${updateError.message}`)
  }

  await supabase.from("his_integration_events").insert({
    organization_id: user.organizationId,
    branch_id: integration.branch_id,
    integration_id: integration.id,
    event_type: "connection_test",
    direction: integration.direction,
    message_type: integration.enabled_message_types?.[0] ?? null,
    status: result.success ? "success" : "failed",
    message: result.message,
    metadata: {
      protocol: integration.protocol,
      authType: integration.auth_type,
      checks: result.checks,
      testedBy: user.email,
    },
  })

  revalidatePath("/admin/his-integration")
  redirect("/admin/his-integration")
}

function evaluateHisIntegration(integration: HisIntegrationTestRow) {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = []
  const hasUrl = Boolean(integration.endpoint_url?.trim())
  const hasHost = Boolean(integration.host?.trim())
  const hasPort = typeof integration.port === "number"
  const messageTypes = integration.enabled_message_types ?? []

  if (integration.protocol === "hl7_v2_mllp") {
    checks.push({
      name: "HL7 host",
      ok: hasHost,
      detail: hasHost ? integration.host ?? "" : "Host/IP girilmeli",
    })
    checks.push({
      name: "MLLP port",
      ok: hasPort,
      detail: hasPort ? String(integration.port) : "Port girilmeli",
    })
    checks.push({
      name: "Mesaj tipleri",
      ok: messageTypes.some((type) => /^(ADT|ORM|ORU)/.test(type)),
      detail: messageTypes.join(", ") || "ADT/ORM/ORU tiplerinden en az biri önerilir",
    })
  } else if (["fhir_r4", "rest_api", "webhook"].includes(integration.protocol)) {
    checks.push({
      name: "Endpoint URL",
      ok: hasUrl && /^https?:\/\//i.test(integration.endpoint_url ?? ""),
      detail: hasUrl ? integration.endpoint_url ?? "" : "HTTP/HTTPS endpoint girilmeli",
    })
    checks.push({
      name: "Auth",
      ok: integration.auth_type !== "none",
      detail:
        integration.auth_type === "none"
          ? "Canlı bağlantı için auth önerilir"
          : integration.auth_type,
    })
  } else {
    checks.push({
      name: "Dosya aktarım yolu",
      ok: hasHost || hasUrl,
      detail: integration.host || integration.endpoint_url || "Host veya path girilmeli",
    })
  }

  const failed = checks.filter((check) => !check.ok)
  return {
    success: failed.length === 0,
    checks,
    message:
      failed.length === 0
        ? "HIS bağlantı tanımı temel doğrulamadan geçti"
        : `HIS bağlantı testi eksik: ${failed.map((check) => check.name).join(", ")}`,
  }
}

function slugifyGroupName(value: string) {
  return (
    value
      .trim()
      .toLocaleLowerCase("tr-TR")
      .replaceAll("ı", "i")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "grup"
  )
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
