import {
  readOhifInstanceMetadata,
  type OhifInstanceMetadata,
} from "@/lib/dicom-metadata"
import { createServiceClient } from "@/lib/supabase/service"

type SupabaseServiceClient = ReturnType<typeof createServiceClient>

type StudyRow = {
  accession_number: string
  description: string | null
  id: string
  modality: string
  organization_id: string
  patients:
    | {
        birth_date?: string | null
        first_name?: string | null
        last_name?: string | null
        patient_number?: string | null
        sex?: string | null
      }
    | Array<{
        birth_date?: string | null
        first_name?: string | null
        last_name?: string | null
        patient_number?: string | null
        sex?: string | null
      }>
    | null
  study_at: string | null
  study_instance_uid: string
}

type SeriesRow = {
  description: string | null
  id: string
  modality: string
  series_instance_uid: string
  series_number: number | null
  study_id: string
}

type InstanceRow = {
  id: string
  instance_number: number | null
  series_id: string
  sop_class_uid: string | null
  sop_instance_uid: string
  storage_bucket: string
  storage_key: string
  study_id: string
  transfer_syntax_uid: string | null
}

type OhifInstanceRow = InstanceRow & {
  ohifMetadata: OhifInstanceMetadata
}

export const OHIF_CORS_HEADERS = {
  "Access-Control-Allow-Headers":
    "accept, authorization, content-type, origin, range, x-requested-with",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers":
    "accept-ranges, content-length, content-range, content-type",
  "Cache-Control": "private, no-store",
}

const DICOM_HEADER_RANGE_BYTES = 512 * 1024
const METADATA_CACHE_LIMIT = 2000
const METADATA_FETCH_CONCURRENCY = 32
const METADATA_FETCH_TIMEOUT_MS = 5000
const metadataCache = new Map<string, OhifInstanceMetadata>()

export async function buildOhifDicomJsonManifest({
  organizationId,
  origin,
  studyIds,
  supabase,
  token,
}: {
  organizationId: string
  origin: string
  studyIds: string[]
  supabase: SupabaseServiceClient
  token: string
}) {
  const uniqueStudyIds = Array.from(new Set(studyIds.filter(Boolean))).slice(0, 50)
  if (!uniqueStudyIds.length) return { studies: [] }

  const { data: studies, error: studiesError } = await supabase
    .from("studies")
    .select(
      "id, organization_id, study_instance_uid, accession_number, modality, description, study_at, patients(patient_number, first_name, last_name, birth_date, sex)"
    )
    .eq("organization_id", organizationId)
    .in("id", uniqueStudyIds)
    .order("study_at", { ascending: false })

  if (studiesError) throw new Error(studiesError.message)

  const resolvedStudyIds = ((studies ?? []) as StudyRow[]).map((study) => study.id)
  if (!resolvedStudyIds.length) return { studies: [] }

  const [{ data: series, error: seriesError }, { data: instances, error: instancesError }] =
    await Promise.all([
      supabase
        .from("series")
        .select("id, study_id, series_instance_uid, series_number, modality, description")
        .eq("organization_id", organizationId)
        .in("study_id", resolvedStudyIds)
        .order("series_number", { ascending: true }),
      supabase
        .from("instances")
        .select(
          "id, study_id, series_id, sop_instance_uid, sop_class_uid, transfer_syntax_uid, instance_number, storage_bucket, storage_key"
        )
        .eq("organization_id", organizationId)
        .in("study_id", resolvedStudyIds)
        .order("instance_number", { ascending: true }),
    ])

  if (seriesError) throw new Error(seriesError.message)
  if (instancesError) throw new Error(instancesError.message)

  const studyInstances = await attachOhifMetadata(supabase, (instances ?? []) as InstanceRow[])
  const seriesByStudy = groupBy((series ?? []) as SeriesRow[], (item) => item.study_id)
  const instancesBySeries = groupBy(studyInstances, (item) => item.series_id)

  return {
    studies: ((studies ?? []) as StudyRow[]).map((study) =>
      mapStudyToOhifDicomJson({
        instancesBySeries,
        origin,
        series: seriesByStudy.get(study.id) ?? [],
        study,
        token,
      })
    ),
  }
}

function mapStudyToOhifDicomJson({
  instancesBySeries,
  origin,
  series,
  study,
  token,
}: {
  instancesBySeries: Map<string, OhifInstanceRow[]>
  origin: string
  series: SeriesRow[]
  study: StudyRow
  token: string
}) {
  const patient = Array.isArray(study.patients) ? study.patients[0] : study.patients
  const studyInstances = series.flatMap((seriesItem) => instancesBySeries.get(seriesItem.id) ?? [])
  const modalities = Array.from(new Set(series.map((item) => item.modality).filter(Boolean)))
  const studyDate = formatDicomDate(study.study_at)
  const studyTime = formatDicomTime(study.study_at)
  const patientName = patient
    ? `${patient.last_name || ""}^${patient.first_name || ""}`.trim()
    : ""

  return {
    AccessionNumber: study.accession_number,
    Modalities: modalities.join("\\"),
    NumInstances: studyInstances.length,
    PatientBirthDate: formatDicomDate(patient?.birth_date ?? null),
    PatientID: patient?.patient_number ?? "",
    PatientName: patientName,
    PatientSex: patient?.sex ?? "",
    StudyDate: studyDate,
    StudyDescription: study.description ?? "",
    StudyInstanceUID: study.study_instance_uid,
    StudyTime: studyTime,
    series: series.map((seriesItem) => {
      const seriesInstances = instancesBySeries.get(seriesItem.id) ?? []

      return {
        Modality: seriesItem.modality,
        SeriesDescription: seriesItem.description ?? "",
        SeriesInstanceUID: seriesItem.series_instance_uid,
        SeriesNumber: seriesItem.series_number ?? undefined,
        instances: seriesInstances.map((instance) => ({
          metadata: {
            ...instance.ohifMetadata,
            AccessionNumber: study.accession_number,
            InstanceNumber:
              instance.instance_number ?? instance.ohifMetadata.InstanceNumber ?? undefined,
            Modality: seriesItem.modality,
            PatientID: patient?.patient_number ?? "",
            PatientName: patientName,
            SeriesDescription: seriesItem.description ?? "",
            SeriesInstanceUID: seriesItem.series_instance_uid,
            SeriesNumber: seriesItem.series_number ?? undefined,
            SOPClassUID:
              instance.sop_class_uid ?? instance.ohifMetadata.SOPClassUID ?? undefined,
            SOPInstanceUID: instance.sop_instance_uid,
            StudyDate: studyDate,
            StudyDescription: study.description ?? "",
            StudyInstanceUID: study.study_instance_uid,
            StudyTime: studyTime,
            TransferSyntaxUID:
              instance.transfer_syntax_uid ??
              instance.ohifMetadata.TransferSyntaxUID ??
              undefined,
          },
          url: `wadouri:${createProxyInstanceUrl({
            instanceId: instance.id,
            origin,
            studyId: study.id,
            token,
          })}`,
        })),
      }
    }),
  }
}

async function attachOhifMetadata(
  supabase: SupabaseServiceClient,
  instances: InstanceRow[]
): Promise<OhifInstanceRow[]> {
  const signedUrls = new Map<string, string>()
  const instancesByBucket = groupBy(instances, (instance) => instance.storage_bucket)

  for (const [bucket, bucketInstances] of instancesByBucket.entries()) {
    const uncachedInstances = bucketInstances.filter(
      (instance) => !metadataCache.has(instance.id)
    )
    if (!uncachedInstances.length) continue

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrls(
        uncachedInstances.map((instance) => instance.storage_key),
        5 * 60
      )

    if (error) continue

    for (const item of data ?? []) {
      if (item.path && item.signedUrl) signedUrls.set(`${bucket}/${item.path}`, item.signedUrl)
    }
  }

  return mapWithConcurrency(instances, METADATA_FETCH_CONCURRENCY, async (instance) => {
    const cached = metadataCache.get(instance.id)
    if (cached) return { ...instance, ohifMetadata: cached }

    const signedUrl = signedUrls.get(`${instance.storage_bucket}/${instance.storage_key}`)
    const ohifMetadata = signedUrl ? await readSignedDicomMetadata(signedUrl) : {}
    setMetadataCache(instance.id, ohifMetadata)
    return { ...instance, ohifMetadata }
  })
}

function createProxyInstanceUrl({
  instanceId,
  origin,
  studyId,
  token,
}: {
  instanceId: string
  origin: string
  studyId: string
  token: string
}) {
  const url = new URL(`/viewer-data/instances/${instanceId}`, origin)
  url.searchParams.set("studyId", studyId)
  url.searchParams.set("token", token)
  return url.toString()
}

async function readSignedDicomMetadata(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), METADATA_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      headers: { Range: `bytes=0-${DICOM_HEADER_RANGE_BYTES - 1}` },
      signal: controller.signal,
    })
    if (!response.ok && response.status !== 206) return {}
    return readOhifInstanceMetadata(await response.arrayBuffer())
  } catch {
    return {}
  } finally {
    clearTimeout(timeout)
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
) {
  const results: R[] = []
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  )
  return results
}

function setMetadataCache(id: string, metadata: OhifInstanceMetadata) {
  if (metadataCache.size >= METADATA_CACHE_LIMIT) {
    const firstKey = metadataCache.keys().next().value
    if (firstKey) metadataCache.delete(firstKey)
  }
  metadataCache.set(id, metadata)
}

function groupBy<T>(items: T[], keyForItem: (item: T) => string) {
  return items.reduce((groups, item) => {
    const key = keyForItem(item)
    const values = groups.get(key) ?? []
    values.push(item)
    groups.set(key, values)
    return groups
  }, new Map<string, T[]>())
}

function formatDicomDate(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}${String(date.getUTCDate()).padStart(2, "0")}`
}

function formatDicomTime(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return `${String(date.getUTCHours()).padStart(2, "0")}${String(
    date.getUTCMinutes()
  ).padStart(2, "0")}${String(date.getUTCSeconds()).padStart(2, "0")}`
}
