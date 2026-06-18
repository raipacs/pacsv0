"use client"

import { useMemo, useState, useTransition } from "react"

import {
  completeDicomStorageUpload,
  prepareDicomStorageUpload,
  type DicomUploadInput,
} from "@/app/actions/dicom"
import {
  DICOM_STORAGE_BUCKET,
  MAX_BROWSER_DICOM_UPLOAD_BYTES,
} from "@/lib/dicom-storage"
import { createClient } from "@/lib/supabase/client"

type PatientOption = {
  id: string
  label: string
}

type UploadStatus = {
  type: "idle" | "error" | "success"
  message: string
}

export function DicomUploadForm({
  patients,
  supabaseConfigured,
}: {
  patients: PatientOption[]
  supabaseConfigured: boolean
}) {
  const [status, setStatus] = useState<UploadStatus>({
    type: "idle",
    message: "",
  })
  const [isPending, startTransition] = useTransition()

  const defaultStudyAt = useMemo(() => {
    const now = new Date()
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
    return now.toISOString().slice(0, 16)
  }, [])

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const file = formData.get("dicomFile")

    if (!supabaseConfigured) {
      setStatus({
        type: "error",
        message: "Supabase env degiskenleri tanimlanmadan DICOM yuklenemez.",
      })
      return
    }

    if (!(file instanceof File) || file.size === 0) {
      setStatus({ type: "error", message: "Bir DICOM dosyasi secin." })
      return
    }

    if (file.size > MAX_BROWSER_DICOM_UPLOAD_BYTES) {
      setStatus({
        type: "error",
        message:
          "Bu MVP formu tek dosyada 512 MB ile sinirlidir. Daha buyuk DICOM aktarimi icin Storage ingestion servisi kullanilacak.",
      })
      return
    }

    if (!(await hasDicomPreamble(file))) {
      setStatus({
        type: "error",
        message: "Secilen dosyada DICOM preamble imzasi bulunamadi.",
      })
      return
    }

    const input = formInput(formData)
    setStatus({ type: "idle", message: "Dosya ozeti hesaplaniyor..." })

    startTransition(async () => {
      const prepared = await prepareDicomStorageUpload(input)
      if (!prepared.ok) {
        setStatus({ type: "error", message: prepared.error })
        return
      }

      const sha256 = await digestSha256(file)
      setStatus({ type: "idle", message: "DICOM Storage bucket'a yukleniyor..." })

      const supabase = createClient()
      const { error: uploadError } = await supabase.storage
        .from(DICOM_STORAGE_BUCKET)
        .upload(prepared.storageKey, file, {
          cacheControl: "31536000",
          contentType: file.type || "application/dicom",
          upsert: false,
        })

      if (uploadError) {
        setStatus({ type: "error", message: uploadError.message })
        return
      }

      const completed = await completeDicomStorageUpload({
        ...input,
        storageKey: prepared.storageKey,
        sizeBytes: file.size,
        sha256,
      })

      if (!completed.ok) {
        await supabase.storage.from(prepared.bucket).remove([prepared.storageKey])
        setStatus({ type: "error", message: completed.error })
        return
      }

      form.reset()
      setStatus({
        type: "success",
        message: "DICOM Storage'a yuklendi ve metadata kaydedildi.",
      })
    })
  }

  return (
    <form className="upload-form" onSubmit={onSubmit}>
      <fieldset disabled={isPending || !supabaseConfigured}>
        <div className="form-grid">
          <label>
            Hasta
            <select name="patientId" required defaultValue="">
              <option value="" disabled>
                Hasta secin
              </option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            DICOM dosyasi
            <input
              name="dicomFile"
              type="file"
              accept=".dcm,application/dicom"
              required
            />
          </label>
          <label>
            Accession no
            <input name="accessionNumber" required placeholder="ACC-2026-0001" />
          </label>
          <label>
            Modalite
            <select name="modality" required defaultValue="MR">
              <option value="MR">MR</option>
              <option value="BT">BT</option>
              <option value="US">US</option>
              <option value="MG">MG</option>
              <option value="CR">CR</option>
              <option value="DX">DX</option>
            </select>
          </label>
          <label>
            Vucut bolgesi
            <input name="bodyPart" placeholder="Beyin, toraks, abdomen" />
          </label>
          <label>
            Tetkik tarihi
            <input name="studyAt" type="datetime-local" defaultValue={defaultStudyAt} />
          </label>
          <label className="wide">
            Aciklama
            <input name="description" placeholder="MR Beyin kontrastli" />
          </label>
          <label>
            Oncelik
            <select name="priority" defaultValue="routine">
              <option value="routine">Rutin</option>
              <option value="urgent">Acil</option>
              <option value="stat">STAT</option>
              <option value="follow_up">Kontrol</option>
            </select>
          </label>
          <label>
            Study Instance UID
            <input name="studyInstanceUid" required placeholder="1.2.840..." />
          </label>
          <label>
            Series Instance UID
            <input name="seriesInstanceUid" required placeholder="1.2.840..." />
          </label>
          <label>
            SOP Instance UID
            <input name="sopInstanceUid" required placeholder="1.2.840..." />
          </label>
          <label>
            Series no
            <input name="seriesNumber" inputMode="numeric" placeholder="1" />
          </label>
          <label>
            Instance no
            <input name="instanceNumber" inputMode="numeric" placeholder="1" />
          </label>
          <label>
            SOP Class UID
            <input name="sopClassUid" placeholder="Opsiyonel" />
          </label>
          <label>
            Transfer Syntax UID
            <input name="transferSyntaxUid" placeholder="Opsiyonel" />
          </label>
        </div>
      </fieldset>
      {status.message ? (
        <p className={`form-status ${status.type}`}>{status.message}</p>
      ) : null}
      {!supabaseConfigured ? (
        <p className="form-status error">
          Demo modda dosya yuklenmez. Vercel env degiskenleri ve Supabase
          projesi baglaninca Storage aktif olur.
        </p>
      ) : null}
      <button
        className="button primary"
        type="submit"
        disabled={isPending || !supabaseConfigured}
      >
        {isPending ? "Yukleniyor..." : "Storage'a yukle"}
      </button>
    </form>
  )
}

function formInput(formData: FormData): DicomUploadInput {
  return {
    patientId: String(formData.get("patientId") ?? ""),
    accessionNumber: String(formData.get("accessionNumber") ?? ""),
    modality: String(formData.get("modality") ?? ""),
    bodyPart: String(formData.get("bodyPart") ?? ""),
    description: String(formData.get("description") ?? ""),
    studyAt: String(formData.get("studyAt") ?? ""),
    priority: String(formData.get("priority") ?? ""),
    studyInstanceUid: String(formData.get("studyInstanceUid") ?? ""),
    seriesInstanceUid: String(formData.get("seriesInstanceUid") ?? ""),
    sopInstanceUid: String(formData.get("sopInstanceUid") ?? ""),
    seriesNumber: String(formData.get("seriesNumber") ?? ""),
    instanceNumber: String(formData.get("instanceNumber") ?? ""),
    sopClassUid: String(formData.get("sopClassUid") ?? ""),
    transferSyntaxUid: String(formData.get("transferSyntaxUid") ?? ""),
  }
}

async function digestSha256(file: File) {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

async function hasDicomPreamble(file: File) {
  if (file.size < 132) return false
  const bytes = new Uint8Array(await file.slice(128, 132).arrayBuffer())
  return (
    bytes[0] === 0x44 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x43 &&
    bytes[3] === 0x4d
  )
}
