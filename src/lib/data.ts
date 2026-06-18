import { isSupabaseConfigured } from "@/lib/config"
import { demoPatients, demoStudies } from "@/lib/demo-data"
import { createClient } from "@/lib/supabase/server"
import type { Patient, WorklistStudy } from "@/lib/types"

export async function getPatients(organizationId: string): Promise<Patient[]> {
  if (!isSupabaseConfigured) return demoPatients

  const supabase = await createClient()
  const [{ data: patients, error }, { data: studies }] = await Promise.all([
    supabase
      .from("patients")
      .select(
        "id, patient_number, first_name, last_name, birth_date, sex, phone, email"
      )
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("last_name"),
    supabase
      .from("studies")
      .select("patient_id, study_at")
      .eq("organization_id", organizationId)
      .order("study_at", { ascending: false }),
  ])

  if (error) throw new Error(`Hasta listesi alinamadi: ${error.message}`)

  return (patients ?? []).map((patient) => {
    const patientStudies = (studies ?? []).filter(
      (study) => study.patient_id === patient.id
    )
    return {
      id: patient.id,
      patientNumber: patient.patient_number,
      firstName: patient.first_name,
      lastName: patient.last_name,
      birthDate: patient.birth_date ?? "",
      sex: mapSex(patient.sex),
      phone: patient.phone,
      email: patient.email,
      studyCount: patientStudies.length,
      lastStudyAt: patientStudies[0]?.study_at ?? null,
    }
  })
}

export async function getPatient(
  organizationId: string,
  patientId: string
): Promise<Patient | null> {
  const patients = await getPatients(organizationId)
  return patients.find((patient) => patient.id === patientId) ?? null
}

export async function getWorklist(
  organizationId: string
): Promise<WorklistStudy[]> {
  if (!isSupabaseConfigured) return demoStudies

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("studies")
    .select(
      "id, accession_number, modality, body_part, description, study_at, priority, status, patients(patient_number, first_name, last_name)"
    )
    .eq("organization_id", organizationId)
    .order("study_at", { ascending: false })

  if (error) throw new Error(`Worklist alinamadi: ${error.message}`)

  return (data ?? []).map((study) => {
    const patient = Array.isArray(study.patients)
      ? study.patients[0]
      : study.patients
    return {
      id: study.id,
      patientName: patient
        ? `${patient.first_name} ${patient.last_name}`
        : "Bilinmeyen hasta",
      patientNumber: patient?.patient_number ?? "-",
      accessionNumber: study.accession_number,
      modality: study.modality,
      bodyPart: study.body_part ?? "-",
      description: study.description ?? "Aciklama yok",
      date: study.study_at
        ? new Intl.DateTimeFormat("tr-TR", {
            dateStyle: "short",
            timeStyle: "short",
          }).format(new Date(study.study_at))
        : "-",
      priority: mapPriority(study.priority),
      status: mapStatus(study.status),
    }
  })
}

function mapSex(value: string): Patient["sex"] {
  if (value === "F") return "K"
  if (value === "M") return "E"
  return "D"
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
