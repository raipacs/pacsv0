"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { requireAdmin } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/config"
import { createClient } from "@/lib/supabase/server"

const idSchema = z.string().uuid()
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
