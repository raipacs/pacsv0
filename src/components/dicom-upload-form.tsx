"use client"

import { useMemo, useState, useTransition } from "react"

import {
  completeDicomStorageUpload,
  completeDicomImportStorageUpload,
  prepareDicomStorageUpload,
  prepareDicomImportStorageUpload,
  type DicomUploadInput,
  type DicomImportInput,
} from "@/app/actions/dicom"
import {
  DICOM_STORAGE_BUCKET,
  MAX_BROWSER_DICOM_UPLOAD_BYTES,
} from "@/lib/dicom-storage"
import {
  isDicomInstanceMetadata,
  parseDicomMetadata,
  type ParsedDicomMetadata,
} from "@/lib/dicom-client-parser"
import { createClient } from "@/lib/supabase/client"

type PatientOption = {
  id: string
  label: string
}

type UploadStatus = {
  type: "idle" | "error" | "success"
  message: string
}

type ImportResult = {
  uploaded: number
  existing: number
  skipped: number
  failed: number
  details: string[]
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
        message: "Supabase ortam değişkenleri tanımlanmadan DICOM yüklenemez.",
      })
      return
    }

    if (!(file instanceof File) || file.size === 0) {
      setStatus({ type: "error", message: "Bir DICOM dosyası seçin." })
      return
    }

    if (file.size > MAX_BROWSER_DICOM_UPLOAD_BYTES) {
      setStatus({
        type: "error",
        message:
          "Bu MVP formu tek dosyada 512 MB ile sınırlıdır. Daha büyük DICOM aktarımı için Storage ingestion servisi kullanılacak.",
      })
      return
    }

    if (!(await hasDicomPreamble(file))) {
      setStatus({
        type: "error",
        message: "Seçilen dosyada DICOM preamble imzası bulunamadı.",
      })
      return
    }

    const input = formInput(formData)
    setStatus({ type: "idle", message: "Dosya özeti hesaplanıyor..." })

    startTransition(async () => {
      const prepared = await prepareDicomStorageUpload(input)
      if (!prepared.ok) {
        setStatus({ type: "error", message: prepared.error })
        return
      }

      const sha256 = await digestSha256(file)
      setStatus({ type: "idle", message: "DICOM Storage bucket'a yükleniyor..." })

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
        message: "DICOM Storage'a yüklendi ve metadata kaydedildi.",
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
                Hasta seçin
              </option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            DICOM dosyası
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
            Vücut bölgesi
            <input name="bodyPart" placeholder="Beyin, toraks, abdomen" />
          </label>
          <label>
            Tetkik tarihi
            <input name="studyAt" type="datetime-local" defaultValue={defaultStudyAt} />
          </label>
          <label className="wide">
            Açıklama
            <input name="description" placeholder="MR Beyin kontrastli" />
          </label>
          <label>
            Öncelik
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
          Demo modda dosya yüklenmez. Vercel ortam değişkenleri ve Supabase
          projesi bağlanınca Storage aktif olur.
        </p>
      ) : null}
      <button
        className="button primary"
        type="submit"
        disabled={isPending || !supabaseConfigured}
      >
        {isPending ? "Yükleniyor..." : "Storage'a yükle"}
      </button>
    </form>
  )
}

export function DicomExportImportForm({
  supabaseConfigured,
}: {
  supabaseConfigured: boolean
}) {
  const [status, setStatus] = useState<UploadStatus>({
    type: "idle",
    message: "",
  })
  const [details, setDetails] = useState<string[]>([])
  const [isPending, startTransition] = useTransition()

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const files = formData
      .getAll("dicomExportFiles")
      .filter((file): file is File => file instanceof File && file.size > 0)

    if (!supabaseConfigured) {
      setStatus({
        type: "error",
        message: "Supabase ortam değişkenleri tanımlanmadan DICOM yüklenemez.",
      })
      return
    }

    if (!files.length) {
      setStatus({ type: "error", message: "DICOM export klasörü veya dosyaları seçin." })
      return
    }

    startTransition(async () => {
      const result: ImportResult = {
        uploaded: 0,
        existing: 0,
        skipped: 0,
        failed: 0,
        details: [],
      }
      const supabase = createClient()
      setDetails([])

      for (const file of files) {
        const fileLabel = file.webkitRelativePath || file.name
        setStatus({
          type: "idle",
          message: `${fileLabel} okunuyor... (${result.uploaded} yeni, ${result.existing} mevcut)`,
        })

        if (file.size > MAX_BROWSER_DICOM_UPLOAD_BYTES) {
          result.failed += 1
          result.details.push(`${fileLabel}: 512 MB sınırını aştı.`)
          continue
        }

        let metadata: ParsedDicomMetadata
        try {
          metadata = await parseDicomMetadata(file)
        } catch (caught) {
          result.skipped += 1
          if (result.details.length < 12) {
            const message =
              caught instanceof Error ? caught.message : "DICOM metadata okunamadı."
            result.details.push(`${fileLabel}: atlandı (${message})`)
          }
          continue
        }

        if (!isDicomInstanceMetadata(metadata)) {
          result.skipped += 1
          if (result.details.length < 12) {
            result.details.push(`${fileLabel}: atlandı (görüntü instance UID bilgisi yok)`)
          }
          continue
        }

        const input = importInput(metadata)
        const prepared = await prepareDicomImportStorageUpload(input)
        if (!prepared.ok) {
          result.failed += 1
          result.details.push(`${fileLabel}: hazırlık hatası (${prepared.error})`)
          continue
        }

        const sha256 = await digestSha256(file)
        const { error: uploadError } = await supabase.storage
          .from(DICOM_STORAGE_BUCKET)
          .upload(prepared.storageKey, file, {
            cacheControl: "31536000",
            contentType: file.type || "application/dicom",
            upsert: false,
          })

        const alreadyExists = uploadError ? isDuplicateStorageError(uploadError.message) : false
        if (uploadError && !alreadyExists) {
          result.failed += 1
          result.details.push(`${fileLabel}: Storage hatası (${uploadError.message})`)
          continue
        }

        const completed = await completeDicomImportStorageUpload({
          ...input,
          storageKey: prepared.storageKey,
          sizeBytes: file.size,
          sha256,
        })

        if (!completed.ok) {
          if (!alreadyExists) {
            await supabase.storage.from(prepared.bucket).remove([prepared.storageKey])
          }
          result.failed += 1
          result.details.push(`${fileLabel}: metadata hatası (${completed.error})`)
          continue
        }

        if (alreadyExists) {
          result.existing += 1
        } else {
          result.uploaded += 1
        }
      }

      form.reset()
      const importedCount = result.uploaded + result.existing
      const type = result.failed || importedCount === 0 ? "error" : "success"
      setDetails(result.details)
      setStatus({
        type,
        message: `${result.uploaded} yeni DICOM yüklendi. ${result.existing} mevcut DICOM metadata ile eşlendi. ${result.skipped} dosya atlandı, ${result.failed} dosya başarısız.`,
      })
    })
  }

  return (
    <form className="upload-form" onSubmit={onSubmit}>
      <fieldset disabled={isPending || !supabaseConfigured}>
        <div className="form-grid">
          <label className="wide">
            DICOM export klasörü
            <input
              name="dicomExportFiles"
              type="file"
              multiple
              {...{ webkitdirectory: "" }}
            />
          </label>
          <label className="wide">
            DICOM dosyaları
            <input
              name="dicomExportFiles"
              type="file"
              accept=".dcm,application/dicom"
              multiple
            />
          </label>
        </div>
      </fieldset>
      {status.message ? (
        <p className={`form-status ${status.type}`}>{status.message}</p>
      ) : null}
      {details.length ? (
        <details className="import-details">
          <summary>Import ayrıntıları</summary>
          <ul>
            {details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {!supabaseConfigured ? (
        <p className="form-status error">
          Demo modda dosya yüklenmez. Vercel ortam değişkenleri ve Supabase
          projesi bağlanınca Storage aktif olur.
        </p>
      ) : null}
      <button
        className="button primary"
        type="submit"
        disabled={isPending || !supabaseConfigured}
      >
        {isPending ? "Import ediliyor..." : "Export'u Storage'a import et"}
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

function importInput(metadata: ParsedDicomMetadata): DicomImportInput {
  return {
    patientName: metadata.patientName,
    patientDicomId: metadata.patientDicomId,
    patientBirthDate: metadata.patientBirthDate,
    patientSex: metadata.patientSex,
    accessionNumber: metadata.accessionNumber,
    modality: metadata.modality,
    bodyPart: metadata.bodyPart,
    description: metadata.description,
    studyAt: metadata.studyAt,
    priority: "routine",
    studyInstanceUid: metadata.studyInstanceUid,
    seriesInstanceUid: metadata.seriesInstanceUid,
    sopInstanceUid: metadata.sopInstanceUid,
    seriesNumber: metadata.seriesNumber,
    instanceNumber: metadata.instanceNumber,
    sopClassUid: metadata.sopClassUid,
    transferSyntaxUid: metadata.transferSyntaxUid,
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

function isDuplicateStorageError(message: string) {
  return /already exists|duplicate|resource already exists|409/i.test(message)
}
