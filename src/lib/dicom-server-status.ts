import { isSupabaseConfigured } from "@/lib/config"
import { createClient } from "@/lib/supabase/server"

export type HealthState = "ok" | "warning" | "error" | "unknown"

export type HealthItem = {
  name: string
  detail: string
  state: HealthState
  latencyMs?: number
}

export type ModalityConnection = {
  key: string
  aeTitle: string
  modality: string
  studies: number
  instances: number
  lastReceivedAt: string | null
  lastDescription: string
  status: "Aktif" | "Sessiz" | "Yeni"
}

export type DicomServerDashboard = {
  endpoint: {
    host: string
    port: string
    aeTitle: string
    protocol: string
    tls: string
  }
  services: HealthItem[]
  apis: HealthItem[]
  modalities: ModalityConnection[]
  lastImportAt: string | null
}

type StudyRow = {
  id: string
  modality: string | null
  source_ae_title: string | null
  description: string | null
  received_at: string | null
}

type InstanceRow = {
  study_id: string
}

const DEFAULT_DICOM_HOST = "dicom.raipacs.com"
const DEFAULT_DICOM_PORT = "4242"
const DEFAULT_DICOM_AE_TITLE = "RAIPACS"

export async function getDicomServerDashboard(
  organizationId: string
): Promise<DicomServerDashboard> {
  const endpoint = {
    host: process.env.RAI_PACS_DICOM_HOST || DEFAULT_DICOM_HOST,
    port: process.env.RAI_PACS_DICOM_PORT || DEFAULT_DICOM_PORT,
    aeTitle: process.env.RAI_PACS_DICOM_AE_TITLE || DEFAULT_DICOM_AE_TITLE,
    protocol: "DICOM C-STORE",
    tls: "Kapalı",
  }

  const [gateway, orthancRest, dicomweb, dbStatus, storageStatus, modalityData] =
    await Promise.all([
      checkGatewayReachability(),
      checkOrthancRest(),
      checkDicomweb(),
      checkDatabase(organizationId),
      checkStorage(),
      getModalityConnections(organizationId),
    ])

  return {
    endpoint,
    services: [
      gateway,
      {
        name: "DICOM C-STORE",
        detail: `${endpoint.host}:${endpoint.port} / AE ${endpoint.aeTitle}`,
        state: "ok",
      },
      {
        name: "Import worker",
        detail: modalityData.lastImportAt
          ? `Son import: ${formatDateTime(modalityData.lastImportAt)}`
          : "Henüz import sinyali yok",
        state: modalityData.lastImportAt ? "ok" : "unknown",
      },
      orthancRest,
    ],
    apis: [dbStatus, storageStatus, dicomweb],
    modalities: modalityData.modalities,
    lastImportAt: modalityData.lastImportAt,
  }
}

async function checkDatabase(organizationId: string): Promise<HealthItem> {
  if (!isSupabaseConfigured) {
    return {
      name: "Supabase DB",
      detail: "Demo modunda",
      state: "warning",
    }
  }

  const startedAt = Date.now()
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from("studies")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)

    if (error) throw error
    return {
      name: "Supabase DB",
      detail: "Metadata sorguları çalışıyor",
      state: "ok",
      latencyMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      name: "Supabase DB",
      detail: error instanceof Error ? error.message : "Sorgu başarısız",
      state: "error",
      latencyMs: Date.now() - startedAt,
    }
  }
}

async function checkStorage(): Promise<HealthItem> {
  if (!isSupabaseConfigured) {
    return {
      name: "Supabase Storage",
      detail: "Demo modunda",
      state: "warning",
    }
  }

  const startedAt = Date.now()
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.storage.listBuckets()
    if (error) throw error

    const hasDicomBucket = data?.some((bucket) => bucket.name === "dicom-originals")
    return {
      name: "Supabase Storage",
      detail: hasDicomBucket
        ? "dicom-originals bucket erişilebilir"
        : "dicom-originals bucket görünmüyor",
      state: hasDicomBucket ? "ok" : "warning",
      latencyMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      name: "Supabase Storage",
      detail: error instanceof Error ? error.message : "Storage kontrolü başarısız",
      state: "error",
      latencyMs: Date.now() - startedAt,
    }
  }
}

async function checkGatewayReachability(): Promise<HealthItem> {
  const url = `${getOrthancBaseUrl()}/system`
  const result = await timedFetch(url, { method: "HEAD" })

  if (result.ok || result.status === 401) {
    return {
      name: "Gateway HTTPS",
      detail:
        result.status === 401
          ? "Erişilebilir, Basic Auth ile korunuyor"
          : "Erişilebilir",
      state: "ok",
      latencyMs: result.latencyMs,
    }
  }

  return {
    name: "Gateway HTTPS",
    detail: result.error || `HTTP ${result.status}`,
    state: "error",
    latencyMs: result.latencyMs,
  }
}

async function checkOrthancRest(): Promise<HealthItem> {
  const authHeader = getOrthancAuthHeader()
  if (!authHeader) {
    return {
      name: "Orthanc REST",
      detail: "RAI_PACS_ORTHANC_USERNAME/PASSWORD tanımlanınca detaylı izlenir",
      state: "unknown",
    }
  }

  const result = await timedFetch(`${getOrthancBaseUrl()}/system`, {
    headers: { Authorization: authHeader },
  })

  return {
    name: "Orthanc REST",
    detail: result.ok ? "Orthanc sistem API yanıt veriyor" : result.error || `HTTP ${result.status}`,
    state: result.ok ? "ok" : "error",
    latencyMs: result.latencyMs,
  }
}

async function checkDicomweb(): Promise<HealthItem> {
  const authHeader = getOrthancAuthHeader()
  if (!authHeader) {
    return {
      name: "DICOMweb API",
      detail: "Orthanc kimlik bilgisi tanımlanınca QIDO-RS kontrol edilir",
      state: "unknown",
    }
  }

  const result = await timedFetch(`${getOrthancBaseUrl()}/dicom-web/studies`, {
    headers: { Authorization: authHeader },
  })

  return {
    name: "DICOMweb API",
    detail: result.ok ? "QIDO-RS studies endpoint çalışıyor" : result.error || `HTTP ${result.status}`,
    state: result.ok ? "ok" : "error",
    latencyMs: result.latencyMs,
  }
}

async function getModalityConnections(organizationId: string) {
  if (!isSupabaseConfigured) {
    return {
      lastImportAt: null,
      modalities: [
        {
          key: "demo-dx",
          aeTitle: "Demo AE",
          modality: "DX",
          studies: 2,
          instances: 5,
          lastReceivedAt: null,
          lastDescription: "Demo DICOM akışı",
          status: "Yeni" as const,
        },
      ],
    }
  }

  const supabase = await createClient()
  const { data: studies, error } = await supabase
    .from("studies")
    .select("id, modality, source_ae_title, description, received_at")
    .eq("organization_id", organizationId)
    .order("received_at", { ascending: false })
    .limit(200)

  if (error) throw new Error(`Modalite listesi alınamadı: ${error.message}`)

  const studyRows = (studies ?? []) as StudyRow[]
  const studyIds = studyRows.map((study) => study.id)
  const { data: instances } = studyIds.length
    ? await supabase.from("instances").select("study_id").in("study_id", studyIds)
    : { data: [] }

  const instancesByStudy = new Map<string, number>()
  for (const instance of ((instances ?? []) as InstanceRow[])) {
    instancesByStudy.set(
      instance.study_id,
      (instancesByStudy.get(instance.study_id) ?? 0) + 1
    )
  }

  const groups = new Map<string, ModalityConnection>()
  for (const study of studyRows) {
    const aeTitle = study.source_ae_title?.trim() || "AE bilinmiyor"
    const modality = study.modality?.trim().toUpperCase() || "DICOM"
    const key = `${aeTitle}:${modality}`
    const previous = groups.get(key)
    const receivedAt = study.received_at
    const instanceCount = instancesByStudy.get(study.id) ?? 0

    if (!previous) {
      groups.set(key, {
        key,
        aeTitle,
        modality,
        studies: 1,
        instances: instanceCount,
        lastReceivedAt: receivedAt,
        lastDescription: study.description || "Açıklama yok",
        status: classifyModalityStatus(receivedAt),
      })
      continue
    }

    previous.studies += 1
    previous.instances += instanceCount
    if (isAfter(receivedAt, previous.lastReceivedAt)) {
      previous.lastReceivedAt = receivedAt
      previous.lastDescription = study.description || "Açıklama yok"
      previous.status = classifyModalityStatus(receivedAt)
    }
  }

  const lastImportAt = studyRows[0]?.received_at ?? null
  return {
    lastImportAt,
    modalities: Array.from(groups.values()).sort((left, right) =>
      (right.lastReceivedAt ?? "").localeCompare(left.lastReceivedAt ?? "")
    ),
  }
}

function classifyModalityStatus(receivedAt: string | null): ModalityConnection["status"] {
  if (!receivedAt) return "Sessiz"
  const ageHours = (Date.now() - new Date(receivedAt).getTime()) / 3_600_000
  if (ageHours <= 1) return "Yeni"
  if (ageHours <= 72) return "Aktif"
  return "Sessiz"
}

function isAfter(left: string | null, right: string | null) {
  if (!left) return false
  if (!right) return true
  return new Date(left).getTime() > new Date(right).getTime()
}

function getOrthancBaseUrl() {
  return (process.env.RAI_PACS_ORTHANC_URL || "https://dicom.raipacs.com").replace(
    /\/+$/,
    ""
  )
}

function getOrthancAuthHeader() {
  const username = process.env.RAI_PACS_ORTHANC_USERNAME
  const password = process.env.RAI_PACS_ORTHANC_PASSWORD
  if (!username || !password) return null
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

async function timedFetch(url: string, init: RequestInit = {}) {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6_000)

  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    })
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      error: null,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Bağlantı hatası",
    }
  } finally {
    clearTimeout(timeout)
  }
}

export function formatDateTime(value: string | null) {
  if (!value) return "-"
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value))
}
