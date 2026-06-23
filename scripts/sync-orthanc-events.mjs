import fs from "node:fs/promises"
import path from "node:path"

import { createClient } from "@supabase/supabase-js"

const rootDir = process.cwd()
const envFile =
  process.env.RAI_PACS_GATEWAY_ENV_FILE ||
  path.join(rootDir, "dicom-gateway", "production", ".env")
const stateFile =
  process.env.RAI_PACS_ORTHANC_EVENT_STATE_FILE ||
  path.join(rootDir, "dicom-gateway", "production", ".orthanc-event-state.json")

await loadEnvFile(envFile)

const REQUIRED_ENV = [
  "RAI_PACS_ORTHANC_URL",
  "RAI_PACS_ORTHANC_USERNAME",
  "RAI_PACS_ORTHANC_PASSWORD",
  "RAI_PACS_SUPABASE_URL",
  "RAI_PACS_SUPABASE_PUBLISHABLE_KEY",
  "RAI_PACS_IMPORT_EMAIL",
  "RAI_PACS_IMPORT_PASSWORD",
]

for (const name of REQUIRED_ENV) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
}

const orthancUrl = process.env.RAI_PACS_ORTHANC_URL.replace(/\/+$/, "")
const orthancAuthHeader = `Basic ${Buffer.from(
  `${process.env.RAI_PACS_ORTHANC_USERNAME}:${process.env.RAI_PACS_ORTHANC_PASSWORD}`
).toString("base64")}`
const calledAeTitle = process.env.RAI_PACS_DICOM_AE_TITLE ?? "RAIPACS"
const branchSlug = process.env.RAI_PACS_BRANCH_SLUG ?? "merkez"

const supabase = createClient(
  process.env.RAI_PACS_SUPABASE_URL,
  process.env.RAI_PACS_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "rai-pacs-orthanc-event-sync" } },
  }
)

const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
  email: process.env.RAI_PACS_IMPORT_EMAIL,
  password: process.env.RAI_PACS_IMPORT_PASSWORD,
})

if (authError) throw new Error(`Importer auth failed: ${authError.message}`)

const { data: membership, error: membershipError } = await supabase
  .from("organization_members")
  .select("organization_id,user_id,role,is_active")
  .eq("user_id", authData.user.id)
  .eq("is_active", true)
  .single()

if (membershipError) {
  throw new Error(`Importer membership lookup failed: ${membershipError.message}`)
}

const branchId = await resolveBranchId()
const state = await readState()
const since = Number.isInteger(state.lastSeq) ? state.lastSeq : 0
const changes = await orthancJson(`/changes?since=${since}&limit=100`)
const done = Array.isArray(changes.Changes) ? changes.Changes : []
let inserted = 0

for (const change of done) {
  const seq = Number(change.Seq)
  if (!Number.isInteger(seq) || seq <= since) continue

  const event = await buildEventFromChange(change)
  if (event) {
    await recordConnectionEvent(event)
    inserted += 1
  }
  state.lastSeq = Math.max(state.lastSeq ?? 0, seq)
}

await writeState(state)

console.log(
  JSON.stringify(
    {
      status: "synced",
      orthancUrl,
      stateFile,
      since,
      latestSeq: state.lastSeq ?? since,
      changes: done.length,
      inserted,
    },
    null,
    2
  )
)

async function buildEventFromChange(change) {
  const changeType = String(change.ChangeType || "")
  const resourceType = String(change.ResourceType || "")
  const orthancId = String(change.ID || "")

  if (!["NewInstance", "NewStudy", "StableStudy"].includes(changeType)) return null

  let study = null
  let instance = null
  if (resourceType === "Study") {
    study = await orthancJson(`/studies/${encodeURIComponent(orthancId)}`).catch(() => null)
  }
  if (resourceType === "Instance") {
    instance = await orthancJson(`/instances/${encodeURIComponent(orthancId)}`).catch(() => null)
    const parentStudyId = instance?.ParentStudy
    if (parentStudyId) {
      study = await orthancJson(`/studies/${encodeURIComponent(parentStudyId)}`).catch(() => null)
    }
  }

  const studyTags = study?.MainDicomTags ?? {}
  const patientTags = study?.PatientMainDicomTags ?? {}
  const instanceTags = instance?.MainDicomTags ?? {}
  const modality = instanceTags.Modality || studyTags.Modality || null
  const studyInstanceUid = studyTags.StudyInstanceUID || null
  const accessionNumber = studyTags.AccessionNumber || null
  const patientDicomId = patientTags.PatientID || null

  if (changeType === "StableStudy") {
    return {
      eventType: "stable_study",
      status: "success",
      message: "Orthanc stable study olayı aldı",
      orthancId,
      modality,
      studyInstanceUid,
      accessionNumber,
      patientDicomId,
      occurredAt: change.Date,
      metadata: { change },
    }
  }

  return {
    eventType: "store",
    status: "received",
    message:
      changeType === "NewInstance"
        ? "Orthanc yeni DICOM instance aldı"
        : "Orthanc yeni DICOM study aldı",
    orthancId,
    modality,
    studyInstanceUid,
    accessionNumber,
    patientDicomId,
    occurredAt: change.Date,
    metadata: { change },
  }
}

async function recordConnectionEvent({
  eventType,
  status,
  message,
  orthancId,
  modality,
  studyInstanceUid,
  accessionNumber,
  patientDicomId,
  occurredAt,
  metadata,
}) {
  const { error } = await supabase.from("dicom_connection_events").insert({
    organization_id: membership.organization_id,
    ...(branchId ? { branch_id: branchId } : {}),
    event_type: eventType,
    source: "orthanc",
    source_ae_title: process.env.RAI_PACS_ORTHANC_SOURCE_AE_TITLE || "ORTHANC",
    called_ae_title: calledAeTitle,
    modality,
    study_instance_uid: studyInstanceUid,
    accession_number: accessionNumber,
    patient_dicom_id: patientDicomId,
    orthanc_id: orthancId,
    message,
    status,
    occurred_at: occurredAt || new Date().toISOString(),
    metadata,
  })

  if (isOptionalDicomOpsError(error)) return
  if (error) throw new Error(`Connection event insert failed: ${error.message}`)
}

async function resolveBranchId() {
  const { data, error } = await supabase
    .from("branches")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("slug", branchSlug)
    .maybeSingle()

  if (isOptionalBranchError(error)) return null
  if (error) throw new Error(`Branch lookup failed: ${error.message}`)
  return data?.id ?? null
}

async function orthancJson(route) {
  const response = await fetch(`${orthancUrl}${route}`, {
    headers: { Authorization: orthancAuthHeader },
  })
  if (!response.ok) {
    throw new Error(`Orthanc ${route} failed: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(stateFile, "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT") return { lastSeq: 0 }
    throw error
  }
}

async function writeState(nextState) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true })
  await fs.writeFile(stateFile, `${JSON.stringify(nextState, null, 2)}\n`, {
    mode: 0o600,
  })
}

function isOptionalDicomOpsError(error) {
  if (!error) return false
  return /dicom_connection_events|schema cache|does not exist|relation/i.test(
    error.message ?? ""
  )
}

function isOptionalBranchError(error) {
  if (!error) return false
  return /branches|branch_id|schema cache|does not exist|relation/i.test(
    error.message ?? ""
  )
}

function loadEnvFile(filePath) {
  return fs
    .readFile(filePath, "utf8")
    .then((content) => {
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const index = trimmed.indexOf("=")
        if (index === -1) continue
        const key = trimmed.slice(0, index).trim()
        const value = trimmed.slice(index + 1).trim()
        if (!process.env[key]) process.env[key] = value
      }
    })
    .catch((error) => {
      if (error?.code !== "ENOENT") throw error
    })
}
