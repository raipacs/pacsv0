import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { createClient } from "@supabase/supabase-js"

const REQUIRED_ENV = [
  "RAI_PACS_SUPABASE_URL",
  "RAI_PACS_SUPABASE_PUBLISHABLE_KEY",
  "RAI_PACS_IMPORT_EMAIL",
  "RAI_PACS_IMPORT_PASSWORD",
  "RAI_PACS_DICOM_DIR",
]

for (const name of REQUIRED_ENV) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
}

const supabase = createClient(
  process.env.RAI_PACS_SUPABASE_URL,
  process.env.RAI_PACS_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "rai-pacs-dicom-folder-import" } },
  }
)

const bucket = process.env.RAI_PACS_STORAGE_BUCKET ?? "dicom-originals"
const sourceDir = process.env.RAI_PACS_DICOM_DIR
const importSource = process.env.RAI_PACS_IMPORT_SOURCE ?? "folder"
const importJobKey =
  process.env.RAI_PACS_IMPORT_JOB_KEY ??
  process.env.RAI_PACS_ORTHANC_STUDY_ID ??
  process.env.RAI_PACS_ORTHANC_STUDY_UID ??
  `folder:${sourceDir}`
const sourceAeTitle =
  process.env.RAI_PACS_SOURCE_AE_TITLE ??
  process.env.RAI_PACS_ORTHANC_SOURCE_AE_TITLE ??
  process.env.RAI_PACS_IMPORT_SOURCE_AE_TITLE ??
  "IMPORTER"

const LONG_VR = new Set(["OB", "OD", "OF", "OL", "OW", "SQ", "UC", "UR", "UT", "UN"])
const NUMERIC_TAGS = new Set(["0020,0011", "0020,0013"])
const WANTED_TAGS = new Map([
  ["0002,0010", "transferSyntaxUid"],
  ["0008,0016", "sopClassUid"],
  ["0008,0018", "sopInstanceUid"],
  ["0008,0020", "studyDate"],
  ["0008,0030", "studyTime"],
  ["0008,0050", "accessionNumber"],
  ["0008,0060", "modality"],
  ["0008,1030", "studyDescription"],
  ["0008,103e", "seriesDescription"],
  ["0010,0010", "patientName"],
  ["0010,0020", "patientDicomId"],
  ["0010,0030", "patientBirthDate"],
  ["0010,0040", "patientSex"],
  ["0018,0015", "bodyPart"],
  ["0020,000d", "studyInstanceUid"],
  ["0020,000e", "seriesInstanceUid"],
  ["0020,0011", "seriesNumber"],
  ["0020,0013", "instanceNumber"],
])

const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
  email: process.env.RAI_PACS_IMPORT_EMAIL,
  password: process.env.RAI_PACS_IMPORT_PASSWORD,
})

if (authError) {
  throw new Error(`Importer auth failed: ${authError.message}`)
}

const { data: membership, error: membershipError } = await supabase
  .from("organization_members")
  .select("organization_id,user_id,role,is_active")
  .eq("user_id", authData.user.id)
  .eq("is_active", true)
  .single()

if (membershipError) {
  throw new Error(`Importer membership lookup failed: ${membershipError.message}`)
}

if (membership.role !== "admin") {
  throw new Error(
    "Direct folder import currently requires a temporarily active admin membership. Deactivate it immediately after import."
  )
}

const filenames = (await fs.readdir(sourceDir))
  .filter((filename) => !filename.startsWith("."))
  .sort()
const results = []
let importJob = await startImportJob({
  expectedInstances: filenames.length,
})

for (const filename of filenames) {
  try {
    const filePath = path.join(sourceDir, filename)
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) continue

    const buffer = await fs.readFile(filePath)
    const metadata = parseDicom(buffer)

    if (
      !metadata.studyInstanceUid ||
      !metadata.seriesInstanceUid ||
      !metadata.sopInstanceUid ||
      !metadata.modality
    ) {
      results.push({ file: filename, status: "skipped", reason: "missing DICOM UID metadata" })
      await touchImportJob({
        status: "importing",
        skippedInstances: countResults("skipped"),
      })
      continue
    }

    const patientName = splitDicomPatientName(metadata.patientName)
    const patientNumber =
      metadata.patientDicomId?.trim() || `DICOM-${shortUid(metadata.studyInstanceUid)}`

    await touchImportJob({
      status: "importing",
      studyInstanceUid: metadata.studyInstanceUid,
      accessionNumber: metadata.accessionNumber,
      patientDicomId: patientNumber,
      modality: metadata.modality.toUpperCase(),
    })

    const { data: patient, error: patientError } = await supabase
      .from("patients")
      .upsert(
        {
          organization_id: membership.organization_id,
          patient_number: patientNumber,
          first_name: patientName.firstName,
          last_name: patientName.lastName,
          birth_date: normalizeDicomDate(metadata.patientBirthDate),
          sex: normalizePatientSex(metadata.patientSex),
          created_by: authData.user.id,
        },
        { onConflict: "organization_id,patient_number" }
      )
      .select("id,patient_number")
      .single()

    if (patientError) throw new Error(`${filename} patient upsert failed: ${patientError.message}`)

    const storageKey = [
      membership.organization_id,
      normalizeStorageSegment(metadata.studyInstanceUid),
      normalizeStorageSegment(metadata.seriesInstanceUid),
      `${normalizeStorageSegment(metadata.sopInstanceUid)}.dcm`,
    ].join("/")
    const sha256 = createHash("sha256").update(buffer).digest("hex")

    const upload = await supabase.storage.from(bucket).upload(storageKey, buffer, {
      contentType: "application/dicom",
      cacheControl: "31536000",
      upsert: false,
    })

    if (upload.error && !/already exists|Duplicate/i.test(upload.error.message)) {
      throw new Error(`${filename} storage upload failed: ${upload.error.message}`)
    }

    const accessionNumber = await resolveAccessionNumber(
      metadata.accessionNumber,
      metadata.studyInstanceUid,
      membership.organization_id
    )
    const description =
      metadata.studyDescription || metadata.seriesDescription || `${metadata.modality} import`

    const { data: study, error: studyError } = await supabase
      .from("studies")
      .upsert(
        {
          organization_id: membership.organization_id,
          patient_id: patient.id,
          study_instance_uid: metadata.studyInstanceUid,
          accession_number: accessionNumber,
          modality: metadata.modality.toUpperCase(),
          body_part: metadata.bodyPart || null,
          description,
          study_at: normalizeDicomDateTime(metadata.studyDate, metadata.studyTime),
          priority: "routine",
          status: "received",
          source_ae_title: sourceAeTitle,
        },
        { onConflict: "organization_id,study_instance_uid" }
      )
      .select("id")
      .single()

    if (studyError) throw new Error(`${filename} study upsert failed: ${studyError.message}`)

    const { data: series, error: seriesError } = await supabase
      .from("series")
      .upsert(
        {
          organization_id: membership.organization_id,
          study_id: study.id,
          series_instance_uid: metadata.seriesInstanceUid,
          series_number: toNullableInteger(metadata.seriesNumber),
          modality: metadata.modality.toUpperCase(),
          description,
        },
        { onConflict: "organization_id,series_instance_uid" }
      )
      .select("id")
      .single()

    if (seriesError) throw new Error(`${filename} series upsert failed: ${seriesError.message}`)

    const { error: instanceError } = await supabase.from("instances").upsert(
      {
        organization_id: membership.organization_id,
        study_id: study.id,
        series_id: series.id,
        sop_instance_uid: metadata.sopInstanceUid,
        sop_class_uid: metadata.sopClassUid || null,
        transfer_syntax_uid: metadata.transferSyntaxUid || null,
        instance_number: toNullableInteger(metadata.instanceNumber),
        storage_bucket: bucket,
        storage_key: storageKey,
        size_bytes: buffer.length,
        sha256,
      },
      { onConflict: "organization_id,sop_instance_uid" }
    )

    if (instanceError) throw new Error(`${filename} instance upsert failed: ${instanceError.message}`)

    const { count } = await supabase
      .from("instances")
      .select("id", { count: "exact", head: true })
      .eq("series_id", series.id)

    if (typeof count === "number") {
      await supabase.from("series").update({ instance_count: count }).eq("id", series.id)
    }

    results.push({
      file: filename,
      status: upload.error ? "metadata-updated-existing-object" : "uploaded",
      modality: metadata.modality,
      patientNumber,
      storageKey,
      sizeBytes: buffer.length,
    })

    await syncModalityRegistry({
      modality: metadata.modality.toUpperCase(),
      studyInstanceUid: metadata.studyInstanceUid,
      accessionNumber,
    })
    await touchImportJob({
      status: "importing",
      importedInstances: countResults("uploaded") + countResults("metadata-updated-existing-object"),
      skippedInstances: countResults("skipped"),
      failedInstances: countResults("failed"),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    results.push({ file: filename, status: "failed", reason: message })
    await touchImportJob({
      status: "retrying",
      failedInstances: countResults("failed"),
      errorMessage: message,
    })
  }
}

const failedInstances = countResults("failed")
await touchImportJob({
  status: failedInstances ? "failed" : "completed",
  importedInstances: countResults("uploaded") + countResults("metadata-updated-existing-object"),
  skippedInstances: countResults("skipped"),
  failedInstances,
  completedAt: new Date().toISOString(),
  errorMessage: failedInstances ? `${failedInstances} instance import edilemedi` : null,
})

console.log(
  JSON.stringify(
    {
      importer: authData.user.email,
      organizationId: membership.organization_id,
      sourceDir,
      results,
    },
    null,
    2
  )
)

if (failedInstances) process.exitCode = 1

async function startImportJob({ expectedInstances }) {
  const { data, error } = await supabase
    .from("dicom_import_jobs")
    .upsert(
      {
        organization_id: membership.organization_id,
        job_key: importJobKey,
        status: "importing",
        source: importSource,
        source_ae_title: sourceAeTitle,
        expected_instances: expectedInstances,
        metadata: {
          sourceDir,
          bucket,
          importer: authData.user.email,
        },
        started_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,job_key" }
    )
    .select("id")
    .single()

  if (isOptionalDicomOpsError(error)) return null
  if (error) throw new Error(`Import job start failed: ${error.message}`)
  return data
}

async function touchImportJob(fields) {
  if (!importJob) return
  const payload = {
    status: fields.status,
    last_seen_at: new Date().toISOString(),
  }
  if (fields.studyInstanceUid) payload.study_instance_uid = fields.studyInstanceUid
  if (fields.accessionNumber) payload.accession_number = fields.accessionNumber
  if (fields.patientDicomId) payload.patient_dicom_id = fields.patientDicomId
  if (fields.modality) payload.modality = fields.modality
  if (typeof fields.importedInstances === "number") payload.imported_instances = fields.importedInstances
  if (typeof fields.skippedInstances === "number") payload.skipped_instances = fields.skippedInstances
  if (typeof fields.failedInstances === "number") payload.failed_instances = fields.failedInstances
  if (fields.completedAt) payload.completed_at = fields.completedAt
  if ("errorMessage" in fields) payload.error_message = fields.errorMessage

  const { error } = await supabase
    .from("dicom_import_jobs")
    .update(payload)
    .eq("id", importJob.id)

  if (isOptionalDicomOpsError(error)) {
    importJob = null
    return
  }
  if (error) throw new Error(`Import job update failed: ${error.message}`)
}

async function syncModalityRegistry({ modality, studyInstanceUid, accessionNumber }) {
  const { count: studyCount } = await supabase
    .from("studies")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", membership.organization_id)
    .eq("source_ae_title", sourceAeTitle)

  const { data: studyRows } = await supabase
    .from("studies")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("source_ae_title", sourceAeTitle)
    .limit(1000)

  const studyIds = (studyRows ?? []).map((study) => study.id)
  const { count: instanceCount } = studyIds.length
    ? await supabase
        .from("instances")
        .select("id", { count: "exact", head: true })
        .in("study_id", studyIds)
    : { count: 0 }

  const { error } = await supabase.from("dicom_modalities").upsert(
    {
      organization_id: membership.organization_id,
      ae_title: sourceAeTitle,
      modality,
      status: "observed",
      last_seen_at: new Date().toISOString(),
      last_store_at: new Date().toISOString(),
      last_study_instance_uid: studyInstanceUid,
      last_accession_number: accessionNumber,
      received_study_count: studyCount ?? 0,
      received_instance_count: instanceCount ?? 0,
      metadata: {
        source: importSource,
        jobKey: importJobKey,
      },
    },
    { onConflict: "organization_id,ae_title" }
  )

  if (isOptionalDicomOpsError(error)) return
  if (error) throw new Error(`Modality registry update failed: ${error.message}`)
}

function countResults(status) {
  return results.filter((result) => result.status === status).length
}

function isOptionalDicomOpsError(error) {
  if (!error) return false
  return /dicom_import_jobs|dicom_modalities|schema cache|does not exist|relation/i.test(
    error.message ?? ""
  )
}

async function resolveAccessionNumber(baseAccessionNumber, studyInstanceUid, organizationId) {
  const candidate = baseAccessionNumber?.trim() || `DCM-${shortUid(studyInstanceUid)}`
  const { data } = await supabase
    .from("studies")
    .select("study_instance_uid")
    .eq("organization_id", organizationId)
    .eq("accession_number", candidate)
    .maybeSingle()

  if (!data || data.study_instance_uid === studyInstanceUid) return candidate
  return `${candidate}-${shortUid(studyInstanceUid)}`
}

function parseDicom(buffer) {
  if (buffer.length < 132 || buffer.subarray(128, 132).toString("ascii") !== "DICM") {
    throw new Error("DICOM preamble signature is missing")
  }

  const metadata = {}
  const datasetOffset = parseExplicitVr(buffer, 132, metadata, true)

  if (metadata.transferSyntaxUid === "1.2.840.10008.1.2") {
    parseImplicitVr(buffer, datasetOffset, metadata)
  } else {
    parseExplicitVr(buffer, datasetOffset, metadata, false)
  }

  return metadata
}

function parseExplicitVr(buffer, offset, metadata, metaOnly) {
  let position = offset

  while (position + 8 <= buffer.length) {
    const group = buffer.readUInt16LE(position)
    const element = buffer.readUInt16LE(position + 2)

    if (metaOnly && group !== 0x0002) break
    if (group === 0x7fe0 && element === 0x0010) break

    position += 4
    const vr = buffer.subarray(position, position + 2).toString("ascii")
    position += 2

    let length
    if (LONG_VR.has(vr)) {
      position += 2
      if (position + 4 > buffer.length) break
      length = buffer.readUInt32LE(position)
      position += 4
    } else {
      if (position + 2 > buffer.length) break
      length = buffer.readUInt16LE(position)
      position += 2
    }

    if (length === 0xffffffff) {
      const sequenceEnd = findUndefinedLengthSequenceEnd(buffer, position)
      if (sequenceEnd < 0) break
      position = sequenceEnd
      continue
    }
    if (position + length > buffer.length) break

    readValue(buffer, position, length, group, element, metadata)
    position += length + (length % 2)
  }

  return position
}

function parseImplicitVr(buffer, offset, metadata) {
  let position = offset

  while (position + 8 <= buffer.length) {
    const group = buffer.readUInt16LE(position)
    const element = buffer.readUInt16LE(position + 2)

    if (group === 0x7fe0 && element === 0x0010) break

    position += 4
    const length = buffer.readUInt32LE(position)
    position += 4

    if (length === 0xffffffff) {
      const sequenceEnd = findUndefinedLengthSequenceEnd(buffer, position)
      if (sequenceEnd < 0) break
      position = sequenceEnd
      continue
    }
    if (position + length > buffer.length) break

    readValue(buffer, position, length, group, element, metadata)
    position += length + (length % 2)
  }
}

function readValue(buffer, offset, length, group, element, metadata) {
  const tag = `${group.toString(16).padStart(4, "0")},${element
    .toString(16)
    .padStart(4, "0")}`
  const field = WANTED_TAGS.get(tag)
  if (!field) return

  if (NUMERIC_TAGS.has(tag) && length === 2) {
    metadata[field] = String(buffer.readUInt16LE(offset))
    return
  }

  if (NUMERIC_TAGS.has(tag) && length === 4) {
    metadata[field] = String(buffer.readUInt32LE(offset))
    return
  }

  metadata[field] = buffer
    .subarray(offset, offset + length)
    .toString("utf8")
    .replace(/\0/g, "")
    .trim()
}

function findUndefinedLengthSequenceEnd(buffer, offset) {
  for (let position = offset; position + 8 <= buffer.length; position += 2) {
    const group = buffer.readUInt16LE(position)
    const element = buffer.readUInt16LE(position + 2)

    if (group === 0xfffe && element === 0xe0dd) {
      return position + 8
    }
  }

  return -1
}

function splitDicomPatientName(value = "") {
  const cleaned = value.trim()
  if (!cleaned) return { firstName: "DICOM", lastName: "Hasta" }

  if (cleaned.includes("^")) {
    const [family, given, middle] = cleaned.split("^")
    return {
      firstName: [given, middle].filter(Boolean).join(" ").trim() || "DICOM",
      lastName: family.trim() || "Hasta",
    }
  }

  const parts = cleaned.split(/\s+/)
  if (parts.length === 1) return { firstName: "DICOM", lastName: parts[0] }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.at(-1) ?? "Hasta",
  }
}

function normalizeDicomDate(value = "") {
  const trimmed = value.trim()
  if (!/^\d{8}$/.test(trimmed)) return null
  return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`
}

function normalizeDicomDateTime(date = "", time = "") {
  if (!/^\d{8}$/.test(date)) return null
  const hour = time.slice(0, 2).padEnd(2, "0") || "00"
  const minute = time.slice(2, 4).padEnd(2, "0") || "00"
  const second = time.slice(4, 6).padEnd(2, "0") || "00"
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${hour}:${minute}:${second}.000Z`
}

function normalizePatientSex(value = "") {
  const normalized = value.trim().toUpperCase()
  if (normalized === "M") return "M"
  if (normalized === "F") return "F"
  if (normalized === "O") return "O"
  return "U"
}

function normalizeStorageSegment(value = "") {
  return value.trim().replace(/[^A-Za-z0-9.=-]/g, "_")
}

function toNullableInteger(value = "") {
  if (!value.trim()) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function shortUid(value = "") {
  return value.trim().replace(/[^A-Za-z0-9]/g, "").slice(-12) || "UNKNOWN"
}
