import { NextResponse } from "next/server"

import {
  readOhifInstanceMetadata,
  type OhifInstanceMetadata,
} from "@/lib/dicom-metadata"
import { verifyOhifLaunchToken } from "@/lib/ohif-launch"
import { createServiceClient, isSupabaseServiceConfigured } from "@/lib/supabase/service"

type RouteContext = {
  params: Promise<{ studyId: string }>
}

type InstanceRow = {
  id: string
  series_id: string
  sop_instance_uid: string
  sop_class_uid: string | null
  transfer_syntax_uid: string | null
  instance_number: number | null
  storage_bucket: string
  storage_key: string
}

type OhifInstanceRow = InstanceRow & {
  ohifMetadata: OhifInstanceMetadata
}

const CORS_HEADERS = {
  "Access-Control-Allow-Headers":
    "accept, authorization, content-type, origin, range, x-requested-with",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Origin": "https://viewer.ohif.org",
  "Access-Control-Expose-Headers":
    "accept-ranges, content-length, content-range, content-type",
  "Cache-Control": "private, no-store",
}
const DICOM_HEADER_RANGE_BYTES = 512 * 1024
const METADATA_CACHE_LIMIT = 2000
const METADATA_FETCH_CONCURRENCY = 32
const METADATA_FETCH_TIMEOUT_MS = 5000

const metadataCache = new Map<string, OhifInstanceMetadata>()

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS })
}

export async function GET(request: Request, context: RouteContext) {
  const { studyId } = await context.params
  const requestUrl = new URL(request.url)
  const token = requestUrl.searchParams.get("token") ?? ""
  const launch = verifyOhifLaunchToken(token, studyId)
  const origin = requestUrl.origin

  if (!launch) {
    return jsonError("OHIF launch token geçersiz veya süresi doldu.", 401)
  }

  if (!isSupabaseServiceConfigured()) {
    return jsonError("Supabase service istemcisi yapılandırılmamış.", 500)
  }

  const supabase = createServiceClient()
  const { data: study, error: studyError } = await supabase
    .from("studies")
    .select(
      "id, organization_id, study_instance_uid, accession_number, modality, description, study_at, patients(patient_number, first_name, last_name, birth_date, sex)"
    )
    .eq("id", studyId)
    .eq("organization_id", launch.organizationId)
    .maybeSingle()

  if (studyError) return jsonError(studyError.message, 500)
  if (!study) return jsonError("Tetkik bulunamadı.", 404)

  const [{ data: series, error: seriesError }, { data: instances, error: instancesError }] =
    await Promise.all([
      supabase
        .from("series")
        .select("id, series_instance_uid, series_number, modality, description")
        .eq("study_id", study.id)
        .eq("organization_id", launch.organizationId)
        .order("series_number", { ascending: true }),
      supabase
        .from("instances")
        .select(
          "id, series_id, sop_instance_uid, sop_class_uid, transfer_syntax_uid, instance_number, storage_bucket, storage_key"
        )
        .eq("study_id", study.id)
        .eq("organization_id", launch.organizationId)
        .order("instance_number", { ascending: true }),
    ])

  if (seriesError) return jsonError(seriesError.message, 500)
  if (instancesError) return jsonError(instancesError.message, 500)

  const studyInstances = await attachOhifMetadata(
    supabase,
    (instances ?? []) as InstanceRow[]
  )
  const patient = Array.isArray(study.patients) ? study.patients[0] : study.patients
  const modalities = Array.from(
    new Set((series ?? []).map((item) => item.modality).filter(Boolean))
  )
  const studyDate = formatDicomDate(study.study_at)
  const studyTime = formatDicomTime(study.study_at)
  const patientName = patient
    ? `${patient.last_name || ""}^${patient.first_name || ""}`.trim()
    : ""

  return NextResponse.json(
    {
      studies: [
        {
          StudyInstanceUID: study.study_instance_uid,
          StudyDate: studyDate,
          StudyTime: studyTime,
          PatientName: patientName,
          PatientID: patient?.patient_number ?? "",
          PatientBirthDate: formatDicomDate(patient?.birth_date ?? null),
          PatientSex: patient?.sex ?? "",
          AccessionNumber: study.accession_number,
          StudyDescription: study.description ?? "",
          NumInstances: studyInstances.length,
          Modalities: modalities.join("\\"),
          series: (series ?? []).map((seriesItem) => {
            const seriesInstances = studyInstances.filter(
              (instance) => instance.series_id === seriesItem.id
            )

            return {
              SeriesInstanceUID: seriesItem.series_instance_uid,
              SeriesNumber: seriesItem.series_number ?? undefined,
              Modality: seriesItem.modality,
              SeriesDescription: seriesItem.description ?? "",
              instances: seriesInstances.map((instance) => ({
                metadata: {
                  ...instance.ohifMetadata,
                  AccessionNumber: study.accession_number,
                  InstanceNumber:
                    instance.instance_number ??
                    instance.ohifMetadata.InstanceNumber ??
                    undefined,
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
        },
      ],
    },
    { headers: CORS_HEADERS }
  )
}

async function attachOhifMetadata(
  supabase: ReturnType<typeof createServiceClient>,
  instances: InstanceRow[]
): Promise<OhifInstanceRow[]> {
  const signedUrls = new Map<string, string>()
  const instancesByBucket = instances.reduce((groups, instance) => {
    const bucketInstances = groups.get(instance.storage_bucket) ?? []
    bucketInstances.push(instance)
    groups.set(instance.storage_bucket, bucketInstances)
    return groups
  }, new Map<string, InstanceRow[]>())

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
      if (item.path && item.signedUrl) {
        signedUrls.set(`${bucket}/${item.path}`, item.signedUrl)
      }
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

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: CORS_HEADERS })
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
