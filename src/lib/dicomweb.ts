import { NextResponse } from "next/server"

import {
  readOhifInstanceMetadata,
  type OhifInstanceMetadata,
} from "@/lib/dicom-metadata"
import { getCurrentUser } from "@/lib/auth"
import { getOhifLaunchStudyIds, verifyOhifLaunchToken } from "@/lib/ohif-launch"
import { createServiceClient, isSupabaseServiceConfigured } from "@/lib/supabase/service"

type SupabaseServiceClient = ReturnType<typeof createServiceClient>

type DicomwebAccess = {
  allowedStudyIds: string[] | null
  organizationId: string
  userId: string
}

type StudyRow = {
  accession_number: string
  description: string | null
  id: string
  modality: string
  organization_id: string
  patient_id: string
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
  referring_physician: string | null
  study_at: string | null
  study_instance_uid: string
}

type SeriesRow = {
  description: string | null
  id: string
  instance_count: number | null
  modality: string
  series_instance_uid: string
  series_number: number | null
  study_id: string
}

type InstanceRow = {
  id: string
  instance_number: number | null
  series_id: string
  sha256: string
  size_bytes: number
  sop_class_uid: string | null
  sop_instance_uid: string
  storage_bucket: string
  storage_key: string
  study_id: string
  transfer_syntax_uid: string | null
}

type DicomJsonElement = {
  BulkDataURI?: string
  Value?: Array<number | string | { Alphabetic: string }>
  vr: string
}

type InstanceMetadataContext = {
  accessToken: string | null
  header: OhifInstanceMetadata
  instance: InstanceRow
  origin: string
  series: SeriesRow
  study: StudyRow
}

const DICOMWEB_ALLOWED_ORIGINS = new Set([
  "https://app.raipacs.com",
  "https://dev.raipacs.com",
  "https://ohif.raipacs.com",
  "https://viewer.ohif.org",
  "http://localhost:4174",
  "http://127.0.0.1:4174",
])

const DICOM_HEADER_RANGE_BYTES = 512 * 1024
const METADATA_FETCH_CONCURRENCY = 24
const METADATA_FETCH_TIMEOUT_MS = 5000
const metadataCache = new Map<string, OhifInstanceMetadata>()

export function dicomwebOptions(request: Request) {
  return new NextResponse(null, { headers: dicomwebCorsHeaders(request) })
}

export async function handleQidoStudies(request: Request) {
  const context = await createDicomwebContext(request)
  if (context.error) return context.error

  const { access, supabase } = context
  const searchParams = new URL(request.url).searchParams
  const patientIds = await resolvePatientIds(supabase, access.organizationId, searchParams)

  if (patientIds && !patientIds.length) {
    return dicomwebJson([], request)
  }

  let query = supabase
    .from("studies")
    .select(
      "id, organization_id, patient_id, study_instance_uid, accession_number, modality, description, referring_physician, study_at, patients(patient_number, first_name, last_name, birth_date, sex)"
    )
    .eq("organization_id", access.organizationId)
    .order("study_at", { ascending: false })
    .limit(parseLimit(searchParams))

  if (access.allowedStudyIds) query = query.in("id", access.allowedStudyIds)
  if (patientIds) query = query.in("patient_id", patientIds)
  query = applyStudyFilters(query, searchParams)

  const { data, error } = await query
  if (error) return dicomwebError(error.message, 500, request)

  const studies = (data ?? []) as StudyRow[]
  if (!studies.length) return dicomwebJson([], request)

  const studyIds = studies.map((study) => study.id)
  const [seriesCounts, instanceCounts, modalitiesByStudy] = await Promise.all([
    countRowsByStudy(supabase, "series", access.organizationId, studyIds),
    countRowsByStudy(supabase, "instances", access.organizationId, studyIds),
    loadModalitiesByStudy(supabase, access.organizationId, studyIds),
  ])

  return dicomwebJson(
    studies.map((study) =>
      mapStudyQido(study, {
        instanceCount: instanceCounts.get(study.id) ?? 0,
        modalities: modalitiesByStudy.get(study.id) ?? [study.modality],
        seriesCount: seriesCounts.get(study.id) ?? 0,
      })
    ),
    request
  )
}

export async function handleQidoSeries(request: Request, studyInstanceUid: string) {
  const context = await createDicomwebContext(request)
  if (context.error) return context.error

  const { access, supabase } = context
  const study = await loadStudyByUid(supabase, access, studyInstanceUid)
  if (!study) return dicomwebJson([], request)

  const searchParams = new URL(request.url).searchParams
  let query = supabase
    .from("series")
    .select("id, study_id, series_instance_uid, series_number, modality, description, instance_count")
    .eq("organization_id", access.organizationId)
    .eq("study_id", study.id)
    .order("series_number", { ascending: true })
    .limit(parseLimit(searchParams))

  const modality = readQueryValue(searchParams, "Modality", "00080060")
  const seriesInstanceUid = readQueryValue(searchParams, "SeriesInstanceUID", "0020000E")
  if (modality) query = query.eq("modality", modality)
  if (seriesInstanceUid) query = query.eq("series_instance_uid", seriesInstanceUid)

  const { data, error } = await query
  if (error) return dicomwebError(error.message, 500, request)

  return dicomwebJson(
    ((data ?? []) as SeriesRow[]).map((series) => mapSeriesQido(study, series)),
    request
  )
}

export async function handleQidoInstances(
  request: Request,
  studyInstanceUid: string,
  seriesInstanceUid: string
) {
  const context = await createDicomwebContext(request)
  if (context.error) return context.error

  const { access, supabase } = context
  const study = await loadStudyByUid(supabase, access, studyInstanceUid)
  if (!study) return dicomwebJson([], request)

  const series = await loadSeriesByUid(
    supabase,
    access.organizationId,
    study.id,
    seriesInstanceUid
  )
  if (!series) return dicomwebJson([], request)

  const searchParams = new URL(request.url).searchParams
  let query = supabase
    .from("instances")
    .select(
      "id, study_id, series_id, sop_instance_uid, sop_class_uid, transfer_syntax_uid, instance_number, storage_bucket, storage_key, size_bytes, sha256"
    )
    .eq("organization_id", access.organizationId)
    .eq("study_id", study.id)
    .eq("series_id", series.id)
    .order("instance_number", { ascending: true })
    .limit(parseLimit(searchParams))

  const sopInstanceUid = readQueryValue(searchParams, "SOPInstanceUID", "00080018")
  if (sopInstanceUid) query = query.eq("sop_instance_uid", sopInstanceUid)

  const { data, error } = await query
  if (error) return dicomwebError(error.message, 500, request)

  return dicomwebJson(
    ((data ?? []) as InstanceRow[]).map((instance) =>
      mapInstanceQido(study, series, instance)
    ),
    request
  )
}

export async function handleStudyMetadata(request: Request, studyInstanceUid: string) {
  return handleMetadata(request, { studyInstanceUid })
}

export async function handleSeriesMetadata(
  request: Request,
  studyInstanceUid: string,
  seriesInstanceUid: string
) {
  return handleMetadata(request, { seriesInstanceUid, studyInstanceUid })
}

export async function handleInstanceMetadata(
  request: Request,
  studyInstanceUid: string,
  seriesInstanceUid: string,
  sopInstanceUid: string
) {
  return handleMetadata(request, { seriesInstanceUid, sopInstanceUid, studyInstanceUid })
}

export async function handleRetrieveInstance(
  request: Request,
  params: {
    seriesInstanceUid: string
    sopInstanceUid: string
    studyInstanceUid: string
  },
  method: "GET" | "HEAD"
) {
  const context = await createDicomwebContext(request)
  if (context.error) return context.error

  const { access, supabase } = context
  const resolved = await loadResolvedInstance(supabase, access, params)
  if (!resolved) return dicomwebError("DICOM instance not found.", 404, request)

  const { instance } = resolved
  const { data: signedUrl, error } = await supabase.storage
    .from(instance.storage_bucket)
    .createSignedUrl(instance.storage_key, 10 * 60, { download: true })

  if (error) return dicomwebError(error.message, 500, request)

  const upstream = await fetch(signedUrl.signedUrl, {
    headers: copyRangeHeader(request),
    method,
  })

  if (!upstream.ok && upstream.status !== 206) {
    return dicomwebError(`DICOM retrieve failed: ${upstream.status}`, upstream.status, request)
  }

  const headers = new Headers(dicomwebCorsHeaders(request))
  headers.set("Accept-Ranges", upstream.headers.get("accept-ranges") ?? "bytes")
  headers.set("Content-Type", "application/dicom")
  copyHeader(upstream.headers, headers, "content-length")
  copyHeader(upstream.headers, headers, "content-range")

  return new NextResponse(method === "HEAD" ? null : upstream.body, {
    headers,
    status: upstream.status,
  })
}

async function handleMetadata(
  request: Request,
  params: {
    seriesInstanceUid?: string
    sopInstanceUid?: string
    studyInstanceUid: string
  }
) {
  const context = await createDicomwebContext(request)
  if (context.error) return context.error

  const { access, accessToken, supabase } = context
  const study = await loadStudyByUid(supabase, access, params.studyInstanceUid)
  if (!study) return dicomwebJson([], request)

  const seriesRows = params.seriesInstanceUid
    ? await loadSingleSeriesList(supabase, access.organizationId, study.id, params.seriesInstanceUid)
    : await loadStudySeries(supabase, access.organizationId, study.id)

  if (!seriesRows.length) return dicomwebJson([], request)

  const seriesById = new Map(seriesRows.map((series) => [series.id, series]))
  let query = supabase
    .from("instances")
    .select(
      "id, study_id, series_id, sop_instance_uid, sop_class_uid, transfer_syntax_uid, instance_number, storage_bucket, storage_key, size_bytes, sha256"
    )
    .eq("organization_id", access.organizationId)
    .eq("study_id", study.id)
    .in(
      "series_id",
      seriesRows.map((series) => series.id)
    )
    .order("instance_number", { ascending: true })
    .limit(1000)

  if (params.sopInstanceUid) query = query.eq("sop_instance_uid", params.sopInstanceUid)

  const { data, error } = await query
  if (error) return dicomwebError(error.message, 500, request)

  const instances = ((data ?? []) as InstanceRow[]).filter((instance) =>
    seriesById.has(instance.series_id)
  )
  const headersByInstanceId = await readInstanceHeaders(supabase, instances)
  const origin = new URL(request.url).origin

  return dicomwebJson(
    instances.map((instance) =>
      mapInstanceMetadata({
        accessToken,
        header: headersByInstanceId.get(instance.id) ?? {},
        instance,
        origin,
        series: seriesById.get(instance.series_id) as SeriesRow,
        study,
      })
    ),
    request
  )
}

async function createDicomwebContext(request: Request): Promise<
  | {
      access: DicomwebAccess
      accessToken: string | null
      error: null
      supabase: SupabaseServiceClient
    }
  | { error: NextResponse }
> {
  if (!isSupabaseServiceConfigured()) {
    return { error: dicomwebError("Supabase service client is not configured.", 500, request) }
  }

  const accessToken = readAccessToken(request)
  if (accessToken) {
    const launch = verifyOhifLaunchToken(accessToken)
    if (!launch) return { error: dicomwebError("DICOMweb token is invalid or expired.", 401, request) }

    return {
      access: {
        allowedStudyIds: getOhifLaunchStudyIds(launch),
        organizationId: launch.organizationId,
        userId: launch.userId,
      },
      accessToken,
      error: null,
      supabase: createServiceClient(),
    }
  }

  const user = await getCurrentUser()
  if (!user || user.demo) {
    return { error: dicomwebError("DICOMweb authorization required.", 401, request) }
  }

  return {
    access: {
      allowedStudyIds: null,
      organizationId: user.organizationId,
      userId: user.id,
    },
    accessToken: null,
    error: null,
    supabase: createServiceClient(),
  }
}

function readAccessToken(request: Request) {
  const url = new URL(request.url)
  const queryToken = url.searchParams.get("token") || url.searchParams.get("access_token")
  if (queryToken) return queryToken

  const authorization = request.headers.get("authorization")
  if (!authorization) return null
  const [scheme, token] = authorization.split(/\s+/, 2)
  return scheme?.toLowerCase() === "bearer" && token ? token : null
}

async function resolvePatientIds(
  supabase: SupabaseServiceClient,
  organizationId: string,
  searchParams: URLSearchParams
) {
  const patientId = readQueryValue(searchParams, "PatientID", "00100020")
  const patientName = readQueryValue(searchParams, "PatientName", "00100010")
  if (!patientId && !patientName) return null

  let query = supabase
    .from("patients")
    .select("id")
    .eq("organization_id", organizationId)
    .limit(200)

  if (patientId) query = query.ilike("patient_number", wildcardToIlike(patientId))
  if (patientName) {
    const normalized = wildcardToIlike(patientName.replace(/\^/g, " "))
    query = query.or(`first_name.ilike.${normalized},last_name.ilike.${normalized}`)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => row.id)
}

function applyStudyFilters<
  TQuery extends {
    eq(column: string, value: string): TQuery
    ilike(column: string, pattern: string): TQuery
  },
>(query: TQuery, searchParams: URLSearchParams) {
  const accession = readQueryValue(searchParams, "AccessionNumber", "00080050")
  const studyInstanceUid = readQueryValue(searchParams, "StudyInstanceUID", "0020000D")
  const modality =
    readQueryValue(searchParams, "ModalitiesInStudy", "00080061") ||
    readQueryValue(searchParams, "Modality", "00080060")

  if (accession) query = query.ilike("accession_number", wildcardToIlike(accession))
  if (studyInstanceUid) query = query.eq("study_instance_uid", studyInstanceUid)
  if (modality) query = query.ilike("modality", wildcardToIlike(modality))
  return query
}

async function loadStudyByUid(
  supabase: SupabaseServiceClient,
  access: DicomwebAccess,
  studyInstanceUid: string
) {
  const { data, error } = await supabase
    .from("studies")
    .select(
      "id, organization_id, patient_id, study_instance_uid, accession_number, modality, description, referring_physician, study_at, patients(patient_number, first_name, last_name, birth_date, sex)"
    )
    .eq("organization_id", access.organizationId)
    .eq("study_instance_uid", decodeURIComponent(studyInstanceUid))
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null

  const study = data as StudyRow
  if (access.allowedStudyIds && !access.allowedStudyIds.includes(study.id)) return null
  return study
}

async function loadSeriesByUid(
  supabase: SupabaseServiceClient,
  organizationId: string,
  studyId: string,
  seriesInstanceUid: string
) {
  const { data, error } = await supabase
    .from("series")
    .select("id, study_id, series_instance_uid, series_number, modality, description, instance_count")
    .eq("organization_id", organizationId)
    .eq("study_id", studyId)
    .eq("series_instance_uid", decodeURIComponent(seriesInstanceUid))
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as SeriesRow | null) ?? null
}

async function loadStudySeries(
  supabase: SupabaseServiceClient,
  organizationId: string,
  studyId: string
) {
  const { data, error } = await supabase
    .from("series")
    .select("id, study_id, series_instance_uid, series_number, modality, description, instance_count")
    .eq("organization_id", organizationId)
    .eq("study_id", studyId)
    .order("series_number", { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as SeriesRow[]
}

async function loadSingleSeriesList(
  supabase: SupabaseServiceClient,
  organizationId: string,
  studyId: string,
  seriesInstanceUid: string
) {
  const series = await loadSeriesByUid(supabase, organizationId, studyId, seriesInstanceUid)
  return series ? [series] : []
}

async function loadResolvedInstance(
  supabase: SupabaseServiceClient,
  access: DicomwebAccess,
  params: {
    seriesInstanceUid: string
    sopInstanceUid: string
    studyInstanceUid: string
  }
) {
  const study = await loadStudyByUid(supabase, access, params.studyInstanceUid)
  if (!study) return null
  const series = await loadSeriesByUid(
    supabase,
    access.organizationId,
    study.id,
    params.seriesInstanceUid
  )
  if (!series) return null

  const { data, error } = await supabase
    .from("instances")
    .select(
      "id, study_id, series_id, sop_instance_uid, sop_class_uid, transfer_syntax_uid, instance_number, storage_bucket, storage_key, size_bytes, sha256"
    )
    .eq("organization_id", access.organizationId)
    .eq("study_id", study.id)
    .eq("series_id", series.id)
    .eq("sop_instance_uid", decodeURIComponent(params.sopInstanceUid))
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null

  return { instance: data as InstanceRow, series, study }
}

async function countRowsByStudy(
  supabase: SupabaseServiceClient,
  table: "instances" | "series",
  organizationId: string,
  studyIds: string[]
) {
  const { data, error } = await supabase
    .from(table)
    .select("study_id")
    .eq("organization_id", organizationId)
    .in("study_id", studyIds)

  if (error) throw new Error(error.message)
  return countBy((data ?? []) as Array<{ study_id: string }>, (row) => row.study_id)
}

async function loadModalitiesByStudy(
  supabase: SupabaseServiceClient,
  organizationId: string,
  studyIds: string[]
) {
  const { data, error } = await supabase
    .from("series")
    .select("study_id, modality")
    .eq("organization_id", organizationId)
    .in("study_id", studyIds)

  if (error) throw new Error(error.message)

  const modalities = new Map<string, string[]>()
  for (const row of (data ?? []) as Array<{ modality: string; study_id: string }>) {
    const values = modalities.get(row.study_id) ?? []
    if (row.modality && !values.includes(row.modality)) values.push(row.modality)
    modalities.set(row.study_id, values)
  }
  return modalities
}

async function readInstanceHeaders(
  supabase: SupabaseServiceClient,
  instances: InstanceRow[]
) {
  const result = new Map<string, OhifInstanceMetadata>()
  const signedUrls = new Map<string, string>()
  const instancesByBucket = groupBy(instances, (instance) => instance.storage_bucket)

  for (const [bucket, bucketInstances] of instancesByBucket.entries()) {
    const uncached = bucketInstances.filter((instance) => !metadataCache.has(instance.id))
    if (!uncached.length) continue

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrls(
        uncached.map((instance) => instance.storage_key),
        5 * 60
      )

    if (error) continue

    for (const item of data ?? []) {
      if (item.path && item.signedUrl) signedUrls.set(`${bucket}/${item.path}`, item.signedUrl)
    }
  }

  await mapWithConcurrency(instances, METADATA_FETCH_CONCURRENCY, async (instance) => {
    const cached = metadataCache.get(instance.id)
    if (cached) {
      result.set(instance.id, cached)
      return
    }

    const signedUrl = signedUrls.get(`${instance.storage_bucket}/${instance.storage_key}`)
    const metadata = signedUrl ? await readSignedDicomMetadata(signedUrl) : {}
    metadataCache.set(instance.id, metadata)
    result.set(instance.id, metadata)
  })

  return result
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

function mapStudyQido(
  study: StudyRow,
  summary: { instanceCount: number; modalities: string[]; seriesCount: number }
) {
  const patient = firstRelation(study.patients)

  return compactDicomJson({
    "00080020": attr("DA", formatDicomDate(study.study_at)),
    "00080030": attr("TM", formatDicomTime(study.study_at)),
    "00080050": attr("SH", study.accession_number),
    "00080056": attr("CS", "ONLINE"),
    "00080061": attr("CS", summary.modalities),
    "00080090": pnAttr(study.referring_physician),
    "00081030": attr("LO", study.description),
    "00100010": pnAttr(formatPatientName(patient)),
    "00100020": attr("LO", patient?.patient_number),
    "00100030": attr("DA", formatDicomDate(patient?.birth_date ?? null)),
    "00100040": attr("CS", patient?.sex),
    "0020000D": attr("UI", study.study_instance_uid),
    "00200010": attr("SH", study.accession_number),
    "00201206": attr("IS", summary.seriesCount),
    "00201208": attr("IS", summary.instanceCount),
  })
}

function mapSeriesQido(study: StudyRow, series: SeriesRow) {
  return compactDicomJson({
    "00080060": attr("CS", series.modality),
    "0008103E": attr("LO", series.description),
    "0020000D": attr("UI", study.study_instance_uid),
    "0020000E": attr("UI", series.series_instance_uid),
    "00200011": attr("IS", series.series_number),
    "00201209": attr("IS", series.instance_count ?? 0),
  })
}

function mapInstanceQido(study: StudyRow, series: SeriesRow, instance: InstanceRow) {
  return compactDicomJson({
    "00080016": attr("UI", instance.sop_class_uid),
    "00080018": attr("UI", instance.sop_instance_uid),
    "00080060": attr("CS", series.modality),
    "0020000D": attr("UI", study.study_instance_uid),
    "0020000E": attr("UI", series.series_instance_uid),
    "00200013": attr("IS", instance.instance_number),
    "00280010": attr("US", undefined),
    "00280011": attr("US", undefined),
  })
}

function mapInstanceMetadata({
  accessToken,
  header,
  instance,
  origin,
  series,
  study,
}: InstanceMetadataContext) {
  const patient = firstRelation(study.patients)
  const retrieveUrl = createDicomwebInstanceUrl({
    accessToken,
    instance,
    origin,
    series,
    study,
  })

  return compactDicomJson({
    "00080005": attr("CS", "ISO_IR 192"),
    "00080016": attr("UI", instance.sop_class_uid ?? header.SOPClassUID),
    "00080018": attr("UI", instance.sop_instance_uid),
    "00080020": attr("DA", formatDicomDate(study.study_at)),
    "00080021": attr("DA", header.SeriesDate),
    "00080030": attr("TM", formatDicomTime(study.study_at)),
    "00080031": attr("TM", header.SeriesTime),
    "00080050": attr("SH", study.accession_number),
    "00080060": attr("CS", series.modality || header.Modality),
    "00081030": attr("LO", study.description ?? header.StudyDescription),
    "0008103E": attr("LO", series.description ?? header.SeriesDescription),
    "00081190": attr("UR", retrieveUrl),
    "00100010": pnAttr(formatPatientName(patient)),
    "00100020": attr("LO", patient?.patient_number),
    "00100030": attr("DA", formatDicomDate(patient?.birth_date ?? null)),
    "00100040": attr("CS", patient?.sex),
    "0020000D": attr("UI", study.study_instance_uid),
    "0020000E": attr("UI", series.series_instance_uid),
    "00200011": attr("IS", series.series_number ?? header.SeriesNumber),
    "00200013": attr("IS", instance.instance_number ?? header.InstanceNumber),
    "00200032": attr("DS", header.ImagePositionPatient),
    "00200037": attr("DS", header.ImageOrientationPatient),
    "00200052": attr("UI", header.FrameOfReferenceUID),
    "00280002": attr("US", header.SamplesPerPixel),
    "00280004": attr("CS", header.PhotometricInterpretation),
    "00280008": attr("IS", header.NumberOfFrames),
    "00280010": attr("US", header.Rows),
    "00280011": attr("US", header.Columns),
    "00280030": attr("DS", header.PixelSpacing),
    "00280100": attr("US", header.BitsAllocated),
    "00280101": attr("US", header.BitsStored),
    "00280102": attr("US", header.HighBit),
    "00280103": attr("US", header.PixelRepresentation),
    "00281050": attr("DS", header.WindowCenter),
    "00281051": attr("DS", header.WindowWidth),
    "00281052": attr("DS", header.RescaleIntercept),
    "00281053": attr("DS", header.RescaleSlope),
    "7FE00010": bulkDataAttr(retrieveUrl),
  })
}

function createDicomwebInstanceUrl({
  accessToken,
  instance,
  origin,
  series,
  study,
}: {
  accessToken: string | null
  instance: InstanceRow
  origin: string
  series: SeriesRow
  study: StudyRow
}) {
  const url = new URL(
    `/dicomweb/studies/${encodeURIComponent(
      study.study_instance_uid
    )}/series/${encodeURIComponent(series.series_instance_uid)}/instances/${encodeURIComponent(
      instance.sop_instance_uid
    )}`,
    origin
  )
  if (accessToken) url.searchParams.set("token", accessToken)
  return url.toString()
}

function dicomwebJson(data: unknown, request: Request) {
  const headers = new Headers(dicomwebCorsHeaders(request))
  headers.set("Content-Type", "application/dicom+json; charset=utf-8")
  return new NextResponse(JSON.stringify(data), { headers })
}

function dicomwebError(message: string, status: number, request: Request) {
  const headers = new Headers(dicomwebCorsHeaders(request))
  headers.set("Content-Type", "application/json; charset=utf-8")
  return new NextResponse(JSON.stringify({ error: message }), { headers, status })
}

function dicomwebCorsHeaders(request: Request) {
  const origin = request.headers.get("origin")
  const allowOrigin =
    origin && (DICOMWEB_ALLOWED_ORIGINS.has(origin) || origin.startsWith("http://localhost:"))
      ? origin
      : "https://app.raipacs.com"

  return {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers":
      "accept, authorization, content-type, origin, range, x-requested-with",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Expose-Headers":
      "accept-ranges, content-length, content-range, content-type",
    "Cache-Control": "private, no-store",
    "Vary": "Origin",
  }
}

function parseLimit(searchParams: URLSearchParams) {
  const raw = searchParams.get("limit") ?? searchParams.get("Limit") ?? "100"
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return 100
  return Math.max(1, Math.min(parsed, 200))
}

function readQueryValue(searchParams: URLSearchParams, ...keys: string[]) {
  for (const key of keys) {
    const value = searchParams.get(key)
    if (value) return value
  }
  return ""
}

function wildcardToIlike(value: string) {
  return value.replace(/\*/g, "%").replace(/\?/g, "_")
}

function attr(vr: string, value: null | number | string | Array<number | string> | undefined) {
  if (value === null || value === undefined || value === "") return undefined
  const values = Array.isArray(value) ? value : [value]
  if (!values.length) return undefined
  return { Value: values, vr } satisfies DicomJsonElement
}

function pnAttr(value: null | string | undefined) {
  if (!value) return undefined
  return { Value: [{ Alphabetic: value }], vr: "PN" } satisfies DicomJsonElement
}

function bulkDataAttr(uri: string) {
  return { BulkDataURI: uri, vr: "OB" } satisfies DicomJsonElement
}

function compactDicomJson<T extends Record<string, DicomJsonElement | undefined>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, element]) => {
      if (!element) return false
      if ("Value" in element && (!element.Value || element.Value.length === 0)) return false
      return true
    })
  )
}

function formatPatientName(
  patient:
    | {
        first_name?: string | null
        last_name?: string | null
      }
    | null
    | undefined
) {
  if (!patient) return ""
  return `${patient.last_name || ""}^${patient.first_name || ""}`.trim()
}

function formatDicomDate(value: string | null | undefined) {
  if (!value) return ""
  if (/^\d{8}$/.test(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}${String(date.getUTCDate()).padStart(2, "0")}`
}

function formatDicomTime(value: string | null | undefined) {
  if (!value) return ""
  if (/^\d{2,6}(\.\d+)?$/.test(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return `${String(date.getUTCHours()).padStart(2, "0")}${String(
    date.getUTCMinutes()
  ).padStart(2, "0")}${String(date.getUTCSeconds()).padStart(2, "0")}`
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function copyRangeHeader(request: Request) {
  const range = request.headers.get("range")
  return range ? { Range: range } : undefined
}

function copyHeader(source: Headers, target: Headers, name: string) {
  const value = source.get(name)
  if (value) target.set(name, value)
}

function countBy<T>(items: T[], keyForItem: (item: T) => string) {
  return items.reduce((counts, item) => {
    const key = keyForItem(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
    return counts
  }, new Map<string, number>())
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

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<void>
) {
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      await mapper(items[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  )
}
