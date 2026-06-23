import { isSupabaseConfigured } from "@/lib/config"
import { demoPatients, demoStudies } from "@/lib/demo-data"
import { createClient } from "@/lib/supabase/server"
import type {
  Patient,
  PatientExternalData,
  PatientStudy,
  WorklistStudy,
} from "@/lib/types"

type PatientBaseRow = {
  id: string
  patient_number: string
  first_name: string
  last_name: string
  birth_date: string | null
  sex: string
  phone: string | null
  email: string | null
}

type PatientExtensionRow = {
  source_system: string | null
  external_patient_id: string | null
  national_id: string | null
  passport_number: string | null
  mother_name: string | null
  father_name: string | null
  birth_place: string | null
  mobile_phone_e164: string | null
  external_data: PatientExternalData | null
}

export async function getPatients(
  organizationId: string,
  branchId?: string | null
): Promise<Patient[]> {
  if (!isSupabaseConfigured) return demoPatients

  const supabase = await createClient()
  const patientQuery = supabase
    .from("patients")
    .select(
      "id, patient_number, first_name, last_name, birth_date, sex, phone, email"
    )
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("last_name")

  const studyQuery = supabase
    .from("studies")
    .select("patient_id, study_at")
    .eq("organization_id", organizationId)
    .order("study_at", { ascending: false })

  if (branchId) {
    patientQuery.eq("branch_id", branchId)
    studyQuery.eq("branch_id", branchId)
  }

  const [{ data: patients, error }, { data: studies }] = await Promise.all([
    patientQuery,
    studyQuery,
  ])

  if (error) throw new Error(`Hasta listesi alınamadı: ${error.message}`)

  return (patients ?? []).map((patient) => {
    const patientStudies = (studies ?? []).filter(
      (study) => study.patient_id === patient.id
    )
    return mapPatientBase(patient, patientStudies.length, patientStudies[0]?.study_at)
  })
}

export async function getPatient(
  organizationId: string,
  patientId: string
): Promise<Patient | null> {
  const patients = await getPatients(organizationId)
  const patient = patients.find((item) => item.id === patientId) ?? null
  if (!patient || !isSupabaseConfigured) return patient

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("patients")
    .select(
      "source_system, external_patient_id, national_id, passport_number, mother_name, father_name, birth_place, mobile_phone_e164, external_data"
    )
    .eq("organization_id", organizationId)
    .eq("id", patientId)
    .maybeSingle()

  if (error || !data) return patient

  return applyPatientExtension(patient, data as PatientExtensionRow)
}

export async function getWorklist(
  organizationId: string,
  branchId?: string | null
): Promise<WorklistStudy[]> {
  if (!isSupabaseConfigured) return demoStudies

  const supabase = await createClient()
  const query = supabase
    .from("studies")
    .select(
      "id, accession_number, modality, body_part, description, study_at, priority, status, patients(patient_number, first_name, last_name)"
    )
    .eq("organization_id", organizationId)
    .order("study_at", { ascending: false })

  if (branchId) query.eq("branch_id", branchId)

  const { data, error } = await query

  if (error) throw new Error(`Worklist alınamadı: ${error.message}`)

  const studyIds = (data ?? []).map((study) => study.id)
  const { data: instances } = studyIds.length
    ? await supabase
        .from("instances")
        .select(
          "id, study_id, sop_instance_uid, instance_number, storage_bucket, storage_key, size_bytes, sha256, created_at"
        )
        .in("study_id", studyIds)
        .order("instance_number", { ascending: true })
    : { data: [] }

  return (data ?? []).map((study) => {
    const patient = Array.isArray(study.patients)
      ? study.patients[0]
      : study.patients
    const studyInstances = (instances ?? []).filter(
      (instance) => instance.study_id === study.id
    )

    return {
      id: study.id,
      patientName: patient
        ? `${patient.first_name} ${patient.last_name}`
        : "Bilinmeyen hasta",
      patientNumber: patient?.patient_number ?? "-",
      accessionNumber: study.accession_number,
      modality: study.modality,
      bodyPart: study.body_part ?? "-",
      description: study.description ?? "Açıklama yok",
      date: study.study_at
        ? new Intl.DateTimeFormat("tr-TR", {
            dateStyle: "short",
            timeStyle: "short",
          }).format(new Date(study.study_at))
        : "-",
      priority: mapPriority(study.priority),
      status: mapStatus(study.status),
      instances: studyInstances.map((instance) => ({
        id: instance.id,
        sopInstanceUid: instance.sop_instance_uid,
        instanceNumber: instance.instance_number,
        storageBucket: instance.storage_bucket,
        storageKey: instance.storage_key,
        sizeBytes: instance.size_bytes,
        sha256: instance.sha256,
        createdAt: instance.created_at,
      })),
    }
  })
}

export async function getPatientStudies(
  organizationId: string,
  patientId: string
): Promise<PatientStudy[]> {
  if (!isSupabaseConfigured) {
    const patient = demoPatients.find((item) => item.id === patientId)
    if (!patient) return []

    return demoStudies
      .filter((study) => study.patientNumber === patient.patientNumber)
      .map((study) => ({
        id: study.id,
        accessionNumber: study.accessionNumber,
        modality: study.modality,
        description: study.description,
        date: study.date,
        status: study.status,
        instanceCount: 0,
        instances: [],
      }))
  }

  const supabase = await createClient()
  const { data: studies, error } = await supabase
    .from("studies")
    .select("id, accession_number, modality, description, study_at, status")
    .eq("organization_id", organizationId)
    .eq("patient_id", patientId)
    .order("study_at", { ascending: false })

  if (error) throw new Error(`Tetkikler alınamadı: ${error.message}`)
  if (!studies?.length) return []

  const studyIds = studies.map((study) => study.id)
  const [{ data: series }, { data: instances }] = await Promise.all([
    supabase
      .from("series")
      .select("id, study_id, instance_count")
      .in("study_id", studyIds),
    supabase
      .from("instances")
      .select(
        "id, study_id, sop_instance_uid, instance_number, storage_bucket, storage_key, size_bytes, sha256, created_at"
      )
      .in("study_id", studyIds)
      .order("instance_number", { ascending: true }),
  ])

  return studies.map((study) => {
    const studyInstances = (instances ?? []).filter(
      (instance) => instance.study_id === study.id
    )
    const seriesInstanceCount = (series ?? [])
      .filter((item) => item.study_id === study.id)
      .reduce((total, item) => total + (item.instance_count ?? 0), 0)

    return {
      id: study.id,
      accessionNumber: study.accession_number,
      modality: study.modality,
      description: study.description ?? "Açıklama yok",
      date: study.study_at
        ? new Intl.DateTimeFormat("tr-TR", {
            dateStyle: "short",
            timeStyle: "short",
          }).format(new Date(study.study_at))
        : "-",
      status: mapStatus(study.status),
      instanceCount: Math.max(seriesInstanceCount, studyInstances.length),
      instances: studyInstances.map((instance) => ({
        id: instance.id,
        sopInstanceUid: instance.sop_instance_uid,
        instanceNumber: instance.instance_number,
        storageBucket: instance.storage_bucket,
        storageKey: instance.storage_key,
        sizeBytes: instance.size_bytes,
        sha256: instance.sha256,
        createdAt: instance.created_at,
      })),
    }
  })
}

function mapSex(value: string): Patient["sex"] {
  if (value === "F") return "K"
  if (value === "M") return "E"
  return "D"
}

function mapPatientBase(
  patient: PatientBaseRow,
  studyCount: number,
  lastStudyAt: string | null | undefined
): Patient {
  return {
    id: patient.id,
    patientNumber: patient.patient_number,
    firstName: patient.first_name,
    lastName: patient.last_name,
    birthDate: patient.birth_date ?? "",
    sex: mapSex(patient.sex),
    phone: patient.phone,
    email: patient.email,
    sourceSystem: null,
    externalPatientId: null,
    nationalId: null,
    passportNumber: null,
    motherName: null,
    fatherName: null,
    birthPlace: null,
    mobilePhoneE164: null,
    externalData: null,
    studyCount,
    lastStudyAt: lastStudyAt ?? null,
  }
}

function applyPatientExtension(
  patient: Patient,
  extension: PatientExtensionRow
): Patient {
  return {
    ...patient,
    sourceSystem: extension.source_system,
    externalPatientId: extension.external_patient_id,
    nationalId: extension.national_id,
    passportNumber: extension.passport_number,
    motherName: extension.mother_name,
    fatherName: extension.father_name,
    birthPlace: extension.birth_place,
    mobilePhoneE164: extension.mobile_phone_e164,
    externalData: normalizeExternalData(extension.external_data),
  }
}

function normalizeExternalData(value: unknown): PatientExternalData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as PatientExternalData
}

function mapPriority(value: string): WorklistStudy["priority"] {
  if (value === "stat" || value === "urgent") return "Acil"
  if (value === "follow_up") return "Kontrol"
  return "Rutin"
}

function mapStatus(value: string): WorklistStudy["status"] {
  if (value === "reporting") return "Raporlanıyor"
  if (value === "final") return "Tamamlandı"
  return "Okunacak"
}
