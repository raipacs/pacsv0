import { resolve4 } from "node:dns/promises"

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

export type ImportJobStatus = "received" | "importing" | "completed" | "failed" | "retrying"

export type ImportJobSummary = {
  id: string
  jobKey: string
  status: ImportJobStatus
  source: string
  sourceAeTitle: string | null
  modality: string | null
  patientDicomId: string | null
  accessionNumber: string | null
  expectedInstances: number
  importedInstances: number
  failedInstances: number
  startedAt: string | null
  completedAt: string | null
  lastSeenAt: string | null
  errorMessage: string | null
}

export type CloudInfrastructureItem = {
  name: string
  kind: string
  detail: string
  state: HealthState
  signal: string
  latencyMs?: number
}

export type RecentDicomStudy = {
  id: string
  patientName: string
  patientNumber: string
  accessionNumber: string
  modality: string
  sourceAeTitle: string
  description: string
  receivedAt: string | null
  status: string
  instanceCount: number
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
  cloudInfrastructure: CloudInfrastructureItem[]
  modalities: ModalityConnection[]
  importJobs: ImportJobSummary[]
  recentStudies: RecentDicomStudy[]
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

type ModalityRegistryRow = {
  id: string
  ae_title: string
  modality: string | null
  description: string | null
  last_seen_at: string | null
  last_store_at: string | null
  last_accession_number: string | null
  received_study_count: number | null
  received_instance_count: number | null
}

type ImportJobRow = {
  id: string
  job_key: string
  status: ImportJobStatus
  source: string
  source_ae_title: string | null
  modality: string | null
  patient_dicom_id: string | null
  accession_number: string | null
  expected_instances: number | null
  imported_instances: number | null
  failed_instances: number | null
  started_at: string | null
  completed_at: string | null
  last_seen_at: string | null
  error_message: string | null
}

type RecentStudyRow = {
  id: string
  accession_number: string | null
  modality: string | null
  source_ae_title: string | null
  description: string | null
  received_at: string | null
  study_at: string | null
  status: string | null
  patients:
    | {
        patient_number: string | null
        first_name: string | null
        last_name: string | null
      }
    | Array<{
        patient_number: string | null
        first_name: string | null
        last_name: string | null
      }>
    | null
}

const DEFAULT_DICOM_HOST = "dicom.raipacs.com"
const DEFAULT_DICOM_PORT = "4242"
const DEFAULT_DICOM_AE_TITLE = "RAIPACS"
const DEFAULT_GCP_PROJECT_ID = "rai-pacs"
const DEFAULT_GCP_ZONE = "europe-west4-c"
const DEFAULT_GCP_VM_NAME = "rai-dicom-gateway"
const DEFAULT_GCP_STATIC_IP = "34.7.217.58"
const DEFAULT_GCP_FIREWALL_SCOPE = "0.0.0.0/0"

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

  const [
    gateway,
    orthancRest,
    dicomweb,
    dbStatus,
    storageStatus,
    cloudInfrastructure,
    modalityData,
    importJobs,
    recentStudies,
  ] = await Promise.all([
    checkGatewayReachability(),
    checkOrthancRest(),
    checkDicomweb(),
    checkDatabase(organizationId),
    checkStorage(),
    getCloudInfrastructure(endpoint),
    getModalityConnections(organizationId),
    getImportJobs(organizationId),
    getRecentStudies(organizationId),
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
    cloudInfrastructure,
    modalities: modalityData.modalities,
    importJobs,
    recentStudies,
    lastImportAt: modalityData.lastImportAt,
  }
}

async function getCloudInfrastructure(
  endpoint: DicomServerDashboard["endpoint"]
): Promise<CloudInfrastructureItem[]> {
  const projectId = process.env.RAI_PACS_GCP_PROJECT_ID || DEFAULT_GCP_PROJECT_ID
  const zone = process.env.RAI_PACS_GCP_ZONE || DEFAULT_GCP_ZONE
  const vmName = process.env.RAI_PACS_GCP_VM_NAME || DEFAULT_GCP_VM_NAME
  const staticIp = process.env.RAI_PACS_GCP_STATIC_IP || DEFAULT_GCP_STATIC_IP
  const firewallScope =
    process.env.RAI_PACS_GCP_FIREWALL_SOURCE_RANGE || DEFAULT_GCP_FIREWALL_SCOPE
  const firewallPort = process.env.RAI_PACS_GCP_FIREWALL_DICOM_PORT || endpoint.port

  const [dnsCheck, gatewayCheck, orthancCheck] = await Promise.all([
    resolveDnsToIp(endpoint.host),
    timedFetch(`${getOrthancBaseUrl()}/system`, { method: "HEAD" }),
    checkOrthancRest(),
  ])

  return [
    {
      name: "Google Cloud project",
      kind: "GCP",
      detail: `${projectId} / ${zone}`,
      state: "ok",
      signal: "Konfigürasyon",
    },
    {
      name: "Compute Engine VM",
      kind: "VM",
      detail: vmName,
      state: gatewayCheck.ok || gatewayCheck.status === 401 ? "ok" : "warning",
      signal:
        gatewayCheck.ok || gatewayCheck.status === 401
          ? "Gateway HTTPS yanıt veriyor"
          : gatewayCheck.error || `HTTP ${gatewayCheck.status}`,
      latencyMs: gatewayCheck.latencyMs,
    },
    {
      name: "Static external IP",
      kind: "Network",
      detail: staticIp,
      state: dnsCheck.resolvedIp === staticIp ? "ok" : dnsCheck.resolvedIp ? "warning" : "unknown",
      signal: dnsCheck.resolvedIp
        ? `${endpoint.host} -> ${dnsCheck.resolvedIp}`
        : "DNS resolver sonucu alınamadı",
      latencyMs: dnsCheck.latencyMs,
    },
    {
      name: "DNS A record",
      kind: "DNS",
      detail: endpoint.host,
      state: dnsCheck.resolvedIp === staticIp ? "ok" : dnsCheck.resolvedIp ? "warning" : "unknown",
      signal: dnsCheck.resolvedIp
        ? `A kaydı ${dnsCheck.resolvedIp}`
        : dnsCheck.error || "DNS kontrolü başarısız",
      latencyMs: dnsCheck.latencyMs,
    },
    {
      name: "Firewall DICOM",
      kind: "Firewall",
      detail: `TCP ${firewallPort} / ${firewallScope}`,
      state: firewallScope === "0.0.0.0/0" ? "warning" : "ok",
      signal:
        firewallScope === "0.0.0.0/0"
          ? "Geçici olarak tüm kaynaklara açık"
          : "Kaynak aralığı kısıtlı",
    },
    {
      name: "Caddy reverse proxy",
      kind: "Container",
      detail: "HTTPS / Basic Auth ön kapı",
      state: gatewayCheck.ok || gatewayCheck.status === 401 ? "ok" : "error",
      signal:
        gatewayCheck.status === 401
          ? "HTTPS erişilebilir, auth aktif"
          : gatewayCheck.ok
            ? "HTTPS erişilebilir"
            : gatewayCheck.error || `HTTP ${gatewayCheck.status}`,
      latencyMs: gatewayCheck.latencyMs,
    },
    {
      name: "Orthanc container",
      kind: "Container",
      detail: "rai-pacs-orthanc",
      state: orthancCheck.state,
      signal: orthancCheck.detail,
      latencyMs: orthancCheck.latencyMs,
    },
    {
      name: "DICOMweb proxy",
      kind: "Container",
      detail: "rai-pacs-dicomweb-proxy",
      state: orthancCheck.state === "ok" ? "ok" : "unknown",
      signal: "Orthanc DICOMweb endpoint üzerinden izleniyor",
    },
    {
      name: "Import timer",
      kind: "systemd",
      detail: "rai-orthanc-import.timer",
      state: "unknown",
      signal: "VM içi systemd durumu GCP/SSH API bağlanınca canlı okunacak",
    },
  ]
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

async function resolveDnsToIp(hostname: string) {
  const startedAt = Date.now()
  try {
    const addresses = await resolve4(hostname)
    return {
      resolvedIp: addresses[0] ?? null,
      error: null,
      latencyMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      resolvedIp: null,
      error: error instanceof Error ? error.message : "DNS kontrolü başarısız",
      latencyMs: Date.now() - startedAt,
    }
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
  const { data: registryRows, error: registryError } = await supabase
    .from("dicom_modalities")
    .select(
      "id, ae_title, modality, description, last_seen_at, last_store_at, last_accession_number, received_study_count, received_instance_count"
    )
    .eq("organization_id", organizationId)
    .order("last_seen_at", { ascending: false, nullsFirst: false })

  if (!registryError && registryRows?.length) {
    const modalities = ((registryRows ?? []) as ModalityRegistryRow[]).map((row) => ({
      key: row.id,
      aeTitle: row.ae_title,
      modality: row.modality?.trim().toUpperCase() || "DICOM",
      studies: row.received_study_count ?? 0,
      instances: row.received_instance_count ?? 0,
      lastReceivedAt: row.last_store_at ?? row.last_seen_at,
      lastDescription:
        row.description || row.last_accession_number || "Kayıtlı DICOM modalitesi",
      status: classifyModalityStatus(row.last_store_at ?? row.last_seen_at),
    }))

    return {
      lastImportAt: modalities[0]?.lastReceivedAt ?? null,
      modalities,
    }
  }

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

async function getImportJobs(organizationId: string): Promise<ImportJobSummary[]> {
  if (!isSupabaseConfigured) {
    return [
      {
        id: "demo-job",
        jobKey: "demo",
        status: "completed",
        source: "demo",
        sourceAeTitle: "Demo AE",
        modality: "DX",
        patientDicomId: "DEMO-001",
        accessionNumber: "DEMO-ACC",
        expectedInstances: 1,
        importedInstances: 1,
        failedInstances: 0,
        startedAt: null,
        completedAt: null,
        lastSeenAt: null,
        errorMessage: null,
      },
    ]
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("dicom_import_jobs")
    .select(
      "id, job_key, status, source, source_ae_title, modality, patient_dicom_id, accession_number, expected_instances, imported_instances, failed_instances, started_at, completed_at, last_seen_at, error_message"
    )
    .eq("organization_id", organizationId)
    .order("last_seen_at", { ascending: false })
    .limit(12)

  if (error) return []

  return ((data ?? []) as ImportJobRow[]).map((row) => ({
    id: row.id,
    jobKey: row.job_key,
    status: row.status,
    source: row.source,
    sourceAeTitle: row.source_ae_title,
    modality: row.modality,
    patientDicomId: row.patient_dicom_id,
    accessionNumber: row.accession_number,
    expectedInstances: row.expected_instances ?? 0,
    importedInstances: row.imported_instances ?? 0,
    failedInstances: row.failed_instances ?? 0,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lastSeenAt: row.last_seen_at,
    errorMessage: row.error_message,
  }))
}

async function getRecentStudies(organizationId: string): Promise<RecentDicomStudy[]> {
  if (!isSupabaseConfigured) {
    return [
      {
        id: "demo-study",
        patientName: "Demo Hasta",
        patientNumber: "DEMO-001",
        accessionNumber: "DEMO-ACC",
        modality: "DX",
        sourceAeTitle: "Demo AE",
        description: "Demo DICOM akışı",
        receivedAt: null,
        status: "received",
        instanceCount: 1,
      },
    ]
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("studies")
    .select(
      "id, accession_number, modality, source_ae_title, description, received_at, study_at, status, patients(patient_number, first_name, last_name)"
    )
    .eq("organization_id", organizationId)
    .order("received_at", { ascending: false })
    .limit(12)

  if (error) return []

  const rows = (data ?? []) as RecentStudyRow[]
  const studyIds = rows.map((study) => study.id)
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

  return rows.map((study) => {
    const patient = Array.isArray(study.patients)
      ? study.patients[0]
      : study.patients
    const patientName = [patient?.first_name, patient?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim()

    return {
      id: study.id,
      patientName: patientName || "Bilinmeyen hasta",
      patientNumber: patient?.patient_number || "-",
      accessionNumber: study.accession_number || "-",
      modality: study.modality?.toUpperCase() || "DICOM",
      sourceAeTitle: study.source_ae_title || "AE bilinmiyor",
      description: study.description || "Açıklama yok",
      receivedAt: study.received_at ?? study.study_at,
      status: study.status || "received",
      instanceCount: instancesByStudy.get(study.id) ?? 0,
    }
  })
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
