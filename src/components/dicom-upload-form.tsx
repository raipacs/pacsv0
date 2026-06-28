"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"

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
import { CopyErrorButton } from "@/components/copy-error-button"
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

type ImportProgress = {
  totalFiles: number
  completedFiles: number
  totalBytes: number
  completedBytes: number
  startedAt: number
  finishedAt: number | null
  currentFile: string
  currentIndex: number
  phase: string
  uploaded: number
  existing: number
  skipped: number
  failed: number
}

const MAX_PARALLEL_IMPORTS = 3
const IMPORT_STEP_TIMEOUT_MS = 45000

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
      {status.message && status.type === "error" ? (
        <div className="form-status-with-copy">
          <p className={`form-status ${status.type}`}>{status.message}</p>
          <CopyErrorButton text={status.message} />
        </div>
      ) : status.message ? (
        <p className={`form-status ${status.type}`}>{status.message}</p>
      ) : null}
      {!supabaseConfigured ? (
        <div className="form-status-with-copy">
          <p className="form-status error">
            Demo modda dosya yüklenmez. Vercel ortam değişkenleri ve Supabase
            projesi bağlanınca Storage aktif olur.
          </p>
          <CopyErrorButton text="Demo modda dosya yüklenmez. Vercel ortam değişkenleri ve Supabase projesi bağlanınca Storage aktif olur." />
        </div>
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
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [clockNow, setClockNow] = useState(() => Date.now())
  const cancelImportRef = useRef(false)

  useEffect(() => {
    if (!isImporting) return
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isImporting])

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

    cancelImportRef.current = false
    setIsImporting(true)
    setStatus({ type: "idle", message: "Import başlatılıyor..." })

    try {
      cancelImportRef.current = false
      const result: ImportResult = {
        uploaded: 0,
        existing: 0,
        skipped: 0,
        failed: 0,
        details: [],
      }
      const supabase = createClient()
      const importFiles = uniqueFiles(files)
      const totalBytes = importFiles.reduce((sum, file) => sum + file.size, 0)
      let completedCount = 0
      let completedBytes = 0
      let nextFileIndex = 0

      setDetails([])
      const startedAt = getCurrentTime()
      setClockNow(startedAt)
      setImportProgress({
        totalFiles: importFiles.length,
        completedFiles: 0,
        totalBytes,
        completedBytes: 0,
        startedAt,
        finishedAt: null,
        currentFile: "",
        currentIndex: 0,
        phase: "Başlıyor",
        uploaded: 0,
        existing: 0,
        skipped: 0,
        failed: 0,
      })

      async function processFile(file: File, index: number) {
        if (cancelImportRef.current) return

        const fileLabel = file.webkitRelativePath || file.name
        const progress = `${index + 1}/${importFiles.length}`

        updateImportProgress({
          currentFile: fileLabel,
          currentIndex: index + 1,
          phase: "DICOM kontrol ediliyor",
        })
        setStatus({
          type: "idle",
          message: `${progress} ${fileLabel}: DICOM kontrol ediliyor...`,
        })

        if (file.size > MAX_BROWSER_DICOM_UPLOAD_BYTES) {
          result.failed += 1
          result.details.push(`${fileLabel}: 512 MB sınırını aştı.`)
          return
        }

        if (!(await hasDicomPreamble(file))) {
          result.skipped += 1
          if (result.details.length < 12) {
            result.details.push(`${fileLabel}: atlandı (DICOM preamble imzası yok)`)
          }
          return
        }

        let metadata: ParsedDicomMetadata
        try {
          updateImportProgress({
            currentFile: fileLabel,
            currentIndex: index + 1,
            phase: "Metadata okunuyor",
          })
          setStatus({
            type: "idle",
            message: `${progress} ${fileLabel}: metadata okunuyor...`,
          })
          metadata = await parseDicomMetadata(file)
        } catch (caught) {
          result.skipped += 1
          if (result.details.length < 12) {
            const message =
              caught instanceof Error ? caught.message : "DICOM metadata okunamadı."
            result.details.push(`${fileLabel}: atlandı (${message})`)
          }
          return
        }

        if (!isDicomInstanceMetadata(metadata)) {
          result.skipped += 1
          if (result.details.length < 12) {
            result.details.push(`${fileLabel}: atlandı (görüntü instance UID bilgisi yok)`)
          }
          return
        }

        const input = importInput(metadata)
        updateImportProgress({
          currentFile: fileLabel,
          currentIndex: index + 1,
          phase: "Storage yolu hazırlanıyor",
        })
        setStatus({
          type: "idle",
          message: `${progress} ${fileLabel}: Storage yolu hazırlanıyor...`,
        })
        const prepared = await withTimeout(
          prepareDicomImportStorageUpload(input),
          IMPORT_STEP_TIMEOUT_MS,
          "Storage yolu hazırlama"
        )
        if (!prepared.ok) {
          result.failed += 1
          result.details.push(`${fileLabel}: hazırlık hatası (${prepared.error})`)
          return
        }

        updateImportProgress({
          currentFile: fileLabel,
          currentIndex: index + 1,
          phase: "Dosya özeti hesaplanıyor",
        })
        setStatus({
          type: "idle",
          message: `${progress} ${fileLabel}: dosya özeti hesaplanıyor...`,
        })
        const sha256 = await withTimeout(
          digestSha256(file),
          IMPORT_STEP_TIMEOUT_MS,
          "SHA-256 hesaplama"
        )

        updateImportProgress({
          currentFile: fileLabel,
          currentIndex: index + 1,
          phase: "Storage'a yükleniyor",
        })
        setStatus({
          type: "idle",
          message: `${progress} ${fileLabel}: Storage'a yükleniyor...`,
        })
        const { error: uploadError } = await withTimeout(
          supabase.storage.from(DICOM_STORAGE_BUCKET).upload(prepared.storageKey, file, {
            cacheControl: "31536000",
            contentType: file.type || "application/dicom",
            upsert: false,
          }),
          IMPORT_STEP_TIMEOUT_MS,
          "Storage yükleme"
        )

        const alreadyExists = uploadError ? isDuplicateStorageError(uploadError.message) : false
        if (uploadError && !alreadyExists) {
          result.failed += 1
          result.details.push(`${fileLabel}: Storage hatası (${uploadError.message})`)
          return
        }

        updateImportProgress({
          currentFile: fileLabel,
          currentIndex: index + 1,
          phase: "Metadata kaydediliyor",
        })
        setStatus({
          type: "idle",
          message: `${progress} ${fileLabel}: metadata kaydediliyor...`,
        })
        const completed = await withTimeout(
          completeDicomImportStorageUpload({
            ...input,
            storageKey: prepared.storageKey,
            sizeBytes: file.size,
            sha256,
          }),
          IMPORT_STEP_TIMEOUT_MS,
          "metadata kaydetme"
        )

        if (!completed.ok) {
          if (!alreadyExists) {
            await supabase.storage.from(prepared.bucket).remove([prepared.storageKey])
          }
          result.failed += 1
          result.details.push(`${fileLabel}: metadata hatası (${completed.error})`)
          return
        }

        if (alreadyExists) {
          result.existing += 1
        } else {
          result.uploaded += 1
        }
      }

      async function runWorker() {
        while (nextFileIndex < importFiles.length && !cancelImportRef.current) {
          const fileIndex = nextFileIndex
          nextFileIndex += 1
          const file = importFiles[fileIndex]
          try {
            await processFile(file, fileIndex)
          } catch (caught) {
            const fileLabel = file.webkitRelativePath || file.name
            const message =
              caught instanceof Error ? caught.message : "Beklenmeyen import hatası."
            result.failed += 1
            result.details.push(`${fileLabel}: ${message}`)
          }
          completedCount += 1
          completedBytes += file.size
          updateImportProgress({
            completedFiles: completedCount,
            completedBytes,
            uploaded: result.uploaded,
            existing: result.existing,
            skipped: result.skipped,
            failed: result.failed,
            phase: cancelImportRef.current ? "İptal ediliyor" : "Devam ediyor",
          })
          setStatus({
            type: "idle",
            message: `${completedCount}/${importFiles.length} dosya tamamlandı. ${result.uploaded} yeni, ${result.existing} mevcut, ${result.skipped} atlandı, ${result.failed} başarısız.`,
          })
        }
      }

      await Promise.all(
        Array.from(
          { length: Math.min(MAX_PARALLEL_IMPORTS, importFiles.length) },
          () => runWorker()
        )
      )

      if (cancelImportRef.current) {
        setDetails(result.details)
        updateImportProgress({
          finishedAt: getCurrentTime(),
          phase: "İptal edildi",
          uploaded: result.uploaded,
          existing: result.existing,
          skipped: result.skipped,
          failed: result.failed,
        })
        setStatus({
          type: "error",
          message: `Import iptal edildi. ${completedCount}/${importFiles.length} dosya işlendi. ${result.uploaded} yeni, ${result.existing} mevcut, ${result.skipped} atlandı, ${result.failed} başarısız.`,
        })
        return
      }

      form.reset()
      const importedCount = result.uploaded + result.existing
      const type = result.failed || importedCount === 0 ? "error" : "success"
      setDetails(result.details)
      updateImportProgress({
        completedFiles: completedCount,
        completedBytes,
        finishedAt: getCurrentTime(),
        phase: type === "success" ? "Tamamlandı" : "Hata ile tamamlandı",
        uploaded: result.uploaded,
        existing: result.existing,
        skipped: result.skipped,
        failed: result.failed,
      })
      setStatus({
        type,
        message: `${result.uploaded} yeni DICOM yüklendi. ${result.existing} mevcut DICOM metadata ile eşlendi. ${result.skipped} dosya atlandı, ${result.failed} dosya başarısız.`,
      })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Beklenmeyen import hatası."
      updateImportProgress({
        finishedAt: getCurrentTime(),
        phase: "Hata oluştu",
      })
      setStatus({ type: "error", message })
    } finally {
      setIsImporting(false)
    }
  }

  function updateImportProgress(patch: Partial<ImportProgress>) {
    setImportProgress((current) => (current ? { ...current, ...patch } : current))
  }

  return (
    <form className="upload-form" onSubmit={onSubmit}>
      <fieldset disabled={isImporting || !supabaseConfigured}>
        <div className="form-grid">
          <label className="wide upload-choice">
            <span>DICOM upload</span>
            <small>
              PACS/Synapse export klasörü, DICOMOBJ klasörü veya DICOM dosyaları
              seçilebilir. RAI seçilen içerikteki DICOM instance listesini
              otomatik algılar ve Storage alanına import eder.
            </small>
            <input
              name="dicomExportFiles"
              type="file"
              multiple
              {...{ webkitdirectory: "" }}
            />
          </label>
        </div>
      </fieldset>
      {status.message && status.type === "error" ? (
        <div className="form-status-with-copy">
          <p className={`form-status ${status.type}`}>{status.message}</p>
          <CopyErrorButton text={status.message} />
        </div>
      ) : status.message ? (
        <p className={`form-status ${status.type}`}>{status.message}</p>
      ) : null}
      {importProgress ? (
        <ImportProgressPanel
          now={clockNow}
          progress={importProgress}
          statusType={status.type}
        />
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
        <div className="form-status-with-copy">
          <p className="form-status error">
            Demo modda dosya yüklenmez. Vercel ortam değişkenleri ve Supabase
            projesi bağlanınca Storage aktif olur.
          </p>
          <CopyErrorButton text="Demo modda dosya yüklenmez. Vercel ortam değişkenleri ve Supabase projesi bağlanınca Storage aktif olur." />
        </div>
      ) : null}
      <button
        className="button primary"
        type="submit"
        disabled={isImporting || !supabaseConfigured}
      >
        {isImporting ? "Import ediliyor..." : "Export'u Storage'a import et"}
      </button>
      {isImporting ? (
        <button
          className="button subtle"
          type="button"
          onClick={() => {
            cancelImportRef.current = true
            setStatus({
              type: "idle",
              message: "Import iptal ediliyor... Devam eden dosya aşaması kapanınca duracak.",
            })
          }}
        >
          İptal et
        </button>
      ) : null}
    </form>
  )
}

function ImportProgressPanel({
  now,
  progress,
  statusType,
}: {
  now: number
  progress: ImportProgress
  statusType: UploadStatus["type"]
}) {
  const percent =
    progress.totalFiles > 0
      ? Math.min(100, Math.round((progress.completedFiles / progress.totalFiles) * 100))
      : 0
  const finishedAt = progress.finishedAt
  const elapsedMs = Math.max(0, (finishedAt ?? now) - progress.startedAt)

  return (
    <section className={`import-progress ${statusType}`} aria-live="polite">
      <div className="import-progress-header">
        <div>
          <strong>{percent}%</strong>
          <span>
            {progress.completedFiles} / {progress.totalFiles} dosya
          </span>
        </div>
        <span>{progress.phase}</span>
      </div>
      <div
        className="import-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="DICOM import ilerlemesi"
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <dl className="import-progress-grid">
        <div>
          <dt>Başlangıç</dt>
          <dd>{formatDateTime(progress.startedAt)}</dd>
        </div>
        <div>
          <dt>Bitiş</dt>
          <dd>{finishedAt ? formatDateTime(finishedAt) : "Devam ediyor"}</dd>
        </div>
        <div>
          <dt>Süre</dt>
          <dd>{formatDuration(elapsedMs)}</dd>
        </div>
        <div>
          <dt>Boyut</dt>
          <dd>
            {formatBytes(progress.completedBytes)} / {formatBytes(progress.totalBytes)}
          </dd>
        </div>
        <div>
          <dt>Son dosya</dt>
          <dd>{progress.currentFile || "-"}</dd>
        </div>
        <div>
          <dt>Sonuç</dt>
          <dd>
            {progress.uploaded} yeni, {progress.existing} mevcut, {progress.skipped} atlandı,{" "}
            {progress.failed} başarısız
          </dd>
        </div>
      </dl>
    </section>
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

function uniqueFiles(files: File[]) {
  const seen = new Set<string>()
  return files.filter((file) => {
    const key = `${file.webkitRelativePath || file.name}:${file.size}:${file.lastModified}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getCurrentTime() {
  return new Date().getTime()
}

function formatDateTime(value: number) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds} sn`
  return `${minutes} dk ${seconds.toString().padStart(2, "0")} sn`
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const fractionDigits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => {
        reject(new Error(`${label} ${Math.round(timeoutMs / 1000)} sn içinde tamamlanmadı.`))
      }, timeoutMs)
    }),
  ])
}
