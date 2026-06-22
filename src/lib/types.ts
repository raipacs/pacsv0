export type AppRole = "admin" | "doctor"

export type PatientExternalValue = string | number | boolean | null | undefined

export type PatientExternalData = Record<string, PatientExternalValue>

export type Patient = {
  id: string
  patientNumber: string
  firstName: string
  lastName: string
  birthDate: string
  sex: "K" | "E" | "D"
  phone: string | null
  email: string | null
  sourceSystem?: string | null
  externalPatientId?: string | null
  nationalId?: string | null
  passportNumber?: string | null
  motherName?: string | null
  fatherName?: string | null
  birthPlace?: string | null
  mobilePhoneE164?: string | null
  externalData?: PatientExternalData | null
  studyCount: number
  lastStudyAt: string | null
}

export type WorklistStudy = {
  id: string
  patientName: string
  patientNumber: string
  accessionNumber: string
  modality: string
  bodyPart: string
  description: string
  date: string
  priority: "Acil" | "Rutin" | "Kontrol"
  status: "Okunacak" | "Raporlanıyor" | "Tamamlandı"
  instances: DicomInstance[]
}

export type DicomInstance = {
  id: string
  sopInstanceUid: string
  instanceNumber: number | null
  storageBucket: string
  storageKey: string
  sizeBytes: number
  sha256: string
  createdAt: string
}

export type PatientStudy = {
  id: string
  accessionNumber: string
  modality: string
  description: string
  date: string
  status: WorklistStudy["status"]
  instanceCount: number
  instances: DicomInstance[]
}
