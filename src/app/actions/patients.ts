"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { requirePatientManager } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/config"
import { createClient } from "@/lib/supabase/server"

export type PatientFormState = {
  error?: string
}

const patientSchema = z.object({
  patientNumber: z.string().trim().max(40).optional(),
  firstName: z.string().trim().min(1, "Ad gerekli.").max(80),
  lastName: z.string().trim().min(1, "Soyad gerekli.").max(80),
  birthDate: z.string().trim().optional(),
  sex: z.enum(["F", "M", "O", "U"]),
  phone: z.string().trim().max(40).optional(),
  email: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || z.email().safeParse(value).success, {
      message: "E-posta formatı geçersiz.",
    }),
  nationalId: z.string().trim().max(20).optional(),
  passportNumber: z.string().trim().max(40).optional(),
  motherName: z.string().trim().max(80).optional(),
  fatherName: z.string().trim().max(80).optional(),
  birthPlace: z.string().trim().max(80).optional(),
  mobilePhoneE164: z.string().trim().max(24).optional(),
  sourceSystem: z.string().trim().max(80).optional(),
  externalPatientId: z.string().trim().max(80).optional(),
})

export async function createPatient(
  _state: PatientFormState,
  formData: FormData
): Promise<PatientFormState> {
  const user = await requirePatientManager()

  if (!isSupabaseConfigured) {
    return { error: "Supabase bağlantısı olmadan hasta kaydedilemez." }
  }

  const parsed = patientSchema.safeParse({
    patientNumber: formData.get("patientNumber"),
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    birthDate: formData.get("birthDate"),
    sex: formData.get("sex") || "U",
    phone: formData.get("phone"),
    email: formData.get("email"),
    nationalId: formData.get("nationalId"),
    passportNumber: formData.get("passportNumber"),
    motherName: formData.get("motherName"),
    fatherName: formData.get("fatherName"),
    birthPlace: formData.get("birthPlace"),
    mobilePhoneE164: formData.get("mobilePhoneE164"),
    sourceSystem: formData.get("sourceSystem"),
    externalPatientId: formData.get("externalPatientId"),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Hasta bilgileri geçersiz." }
  }

  const input = parsed.data
  const patientNumber = input.patientNumber || createPatientNumber()
  const supabase = await createClient()

  const basePatientPayload = {
    organization_id: user.organizationId,
    patient_number: patientNumber,
    first_name: input.firstName,
    last_name: input.lastName,
    birth_date: input.birthDate || null,
    sex: input.sex,
    phone: input.phone || null,
    email: input.email || null,
    created_by: user.id,
  }
  const extendedPatientPayload = {
    source_system: input.sourceSystem || null,
    external_patient_id: input.externalPatientId || null,
    national_id: input.nationalId || null,
    passport_number: input.passportNumber || null,
    mother_name: input.motherName || null,
    father_name: input.fatherName || null,
    birth_place: input.birthPlace || null,
    mobile_phone_e164: input.mobilePhoneE164 || null,
    external_data: {},
  }

  let result = await supabase
    .from("patients")
    .insert({ ...basePatientPayload, ...extendedPatientPayload })
    .select("id")
    .single()

  if (result.error && isMissingPatientExtensionColumn(result.error)) {
    result = await supabase
      .from("patients")
      .insert(basePatientPayload)
      .select("id")
      .single()
  }

  const { data: patient, error } = result

  if (error) {
    if (error.code === "23505") {
      return { error: "Bu hasta numarası zaten kullanılıyor." }
    }
    return { error: `Hasta kaydedilemedi: ${error.message}` }
  }

  await supabase.from("audit_logs").insert({
    organization_id: user.organizationId,
    actor_id: user.id,
    action: "patient.created",
    resource_type: "patient",
    resource_id: patient.id,
    metadata: {
      patientNumber,
      sourceSystem: input.sourceSystem || null,
      externalPatientId: input.externalPatientId || null,
    },
  })

  revalidatePath("/patients")
  redirect(`/patients/${patient.id}`)
}

function createPatientNumber() {
  const date = new Date()
  const stamp = date.toISOString().slice(0, 10).replaceAll("-", "")
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `PAT-${stamp}-${suffix}`
}

function isMissingPatientExtensionColumn(error: { code?: string; message: string }) {
  return (
    error.code === "PGRST204" ||
    /schema cache|external_patient_id|source_system|external_data/i.test(
      error.message
    )
  )
}
