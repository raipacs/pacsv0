"use server"

import { revalidatePath } from "next/cache"

import { requireTableManager } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/config"
import { DICOM_STORAGE_BUCKET } from "@/lib/dicom-storage"
import { createClient } from "@/lib/supabase/server"

export type DicomUploadInput = {
  patientId: string
  accessionNumber: string
  modality: string
  bodyPart: string
  description: string
  studyAt: string
  priority: string
  studyInstanceUid: string
  seriesInstanceUid: string
  sopInstanceUid: string
  seriesNumber: string
  instanceNumber: string
  sopClassUid: string
  transferSyntaxUid: string
}

export type PreparedDicomUpload = {
  ok: true
  bucket: string
  storageKey: string
}

export type DicomActionError = {
  ok: false
  error: string
}

export async function prepareDicomStorageUpload(
  input: DicomUploadInput
): Promise<PreparedDicomUpload | DicomActionError> {
  const user = await requireTableManager("instances", "insert")

  if (!isSupabaseConfigured) {
    return {
      ok: false,
      error: "Supabase bağlantısı olmadan DICOM yüklenemez.",
    }
  }

  const validationError = validateDicomInput(input)
  if (validationError) return { ok: false, error: validationError }

  return {
    ok: true,
    bucket: DICOM_STORAGE_BUCKET,
    storageKey: [
      user.organizationId,
      normalizeStorageSegment(input.studyInstanceUid),
      normalizeStorageSegment(input.seriesInstanceUid),
      `${normalizeStorageSegment(input.sopInstanceUid)}.dcm`,
    ].join("/"),
  }
}

export async function completeDicomStorageUpload(
  input: DicomUploadInput & {
    storageKey: string
    sizeBytes: number
    sha256: string
  }
): Promise<{ ok: true; studyId: string } | DicomActionError> {
  const user = await requireTableManager("instances", "insert")

  if (!isSupabaseConfigured) {
    return {
      ok: false,
      error: "Supabase bağlantısı olmadan DICOM metadata kaydedilemez.",
    }
  }

  const validationError = validateDicomInput(input)
  if (validationError) return { ok: false, error: validationError }

  if (!input.storageKey.startsWith(`${user.organizationId}/`)) {
    return { ok: false, error: "Storage anahtarı kurum alanı dışında." }
  }

  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, error: "Dosya boyutu geçersiz." }
  }

  if (!/^[a-f0-9]{64}$/.test(input.sha256)) {
    return { ok: false, error: "SHA-256 değeri geçersiz." }
  }

  const supabase = await createClient()

  const { data: study, error: studyError } = await supabase
    .from("studies")
    .upsert(
      {
        organization_id: user.organizationId,
        patient_id: input.patientId,
        study_instance_uid: input.studyInstanceUid.trim(),
        accession_number: input.accessionNumber.trim(),
        modality: input.modality.trim().toUpperCase(),
        body_part: input.bodyPart.trim() || null,
        description: input.description.trim() || null,
        study_at: input.studyAt ? new Date(input.studyAt).toISOString() : null,
        priority: normalizePriority(input.priority),
        status: "received",
      },
      { onConflict: "organization_id,study_instance_uid" }
    )
    .select("id")
    .single()

  if (studyError) {
    return { ok: false, error: `Tetkik kaydedilemedi: ${studyError.message}` }
  }

  const { data: series, error: seriesError } = await supabase
    .from("series")
    .upsert(
      {
        organization_id: user.organizationId,
        study_id: study.id,
        series_instance_uid: input.seriesInstanceUid.trim(),
        series_number: toNullableInteger(input.seriesNumber),
        modality: input.modality.trim().toUpperCase(),
        description: input.description.trim() || null,
      },
      { onConflict: "organization_id,series_instance_uid" }
    )
    .select("id")
    .single()

  if (seriesError) {
    return { ok: false, error: `Seri kaydedilemedi: ${seriesError.message}` }
  }

  const { error: instanceError } = await supabase.from("instances").upsert(
    {
      organization_id: user.organizationId,
      study_id: study.id,
      series_id: series.id,
      sop_instance_uid: input.sopInstanceUid.trim(),
      sop_class_uid: input.sopClassUid.trim() || null,
      transfer_syntax_uid: input.transferSyntaxUid.trim() || null,
      instance_number: toNullableInteger(input.instanceNumber),
      storage_bucket: DICOM_STORAGE_BUCKET,
      storage_key: input.storageKey,
      size_bytes: input.sizeBytes,
      sha256: input.sha256,
    },
    { onConflict: "organization_id,sop_instance_uid" }
  )

  if (instanceError) {
    return {
      ok: false,
      error: `DICOM instance kaydedilemedi: ${instanceError.message}`,
    }
  }

  const { count } = await supabase
    .from("instances")
    .select("id", { count: "exact", head: true })
    .eq("series_id", series.id)

  if (typeof count === "number") {
    await supabase
      .from("series")
      .update({ instance_count: count })
      .eq("id", series.id)
  }

  await supabase.from("audit_logs").insert({
    organization_id: user.organizationId,
    actor_id: user.id,
    action: "dicom.uploaded",
    resource_type: "instance",
    resource_id: input.sopInstanceUid.trim(),
    metadata: {
      bucket: DICOM_STORAGE_BUCKET,
      storageKey: input.storageKey,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
    },
  })

  revalidatePath("/worklist")
  revalidatePath(`/patients/${input.patientId}`)

  return { ok: true, studyId: study.id }
}

function validateDicomInput(input: DicomUploadInput) {
  if (!input.patientId) return "Hasta seçimi gerekli."
  if (!input.accessionNumber.trim()) return "Accession numarası gerekli."
  if (!input.modality.trim()) return "Modalite gerekli."
  if (!input.studyInstanceUid.trim()) return "Study Instance UID gerekli."
  if (!input.seriesInstanceUid.trim()) return "Series Instance UID gerekli."
  if (!input.sopInstanceUid.trim()) return "SOP Instance UID gerekli."
  return null
}

function normalizeStorageSegment(value: string) {
  return value.trim().replace(/[^A-Za-z0-9.=-]/g, "_")
}

function normalizePriority(value: string) {
  if (value === "stat" || value === "urgent" || value === "follow_up") {
    return value
  }
  return "routine"
}

function toNullableInteger(value: string) {
  if (!value.trim()) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}
