import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const REQUIRED_ENV = [
  "RAI_PACS_SUPABASE_URL",
  "RAI_PACS_SUPABASE_PUBLISHABLE_KEY",
  "RAI_PACS_IMPORT_EMAIL",
  "RAI_PACS_IMPORT_PASSWORD",
  "RAI_PACS_ORTHANC_URL",
]

for (const name of REQUIRED_ENV) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
}

if (!process.env.RAI_PACS_ORTHANC_STUDY_ID && !process.env.RAI_PACS_ORTHANC_STUDY_UID) {
  throw new Error(
    "Set RAI_PACS_ORTHANC_STUDY_ID or RAI_PACS_ORTHANC_STUDY_UID to import one Orthanc study."
  )
}

const orthancUrl = process.env.RAI_PACS_ORTHANC_URL.replace(/\/+$/, "")
const orthancAuthHeader = createOrthancAuthHeader()
const studyId =
  process.env.RAI_PACS_ORTHANC_STUDY_ID || (await resolveStudyIdByUid())
const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "rai-pacs-orthanc-"))

try {
  const instanceIds = await listStudyInstanceIds(studyId)
  if (!instanceIds.length) {
    throw new Error(`Orthanc study ${studyId} has no instances.`)
  }

  for (const [index, instanceId] of instanceIds.entries()) {
    const buffer = await orthancBinary(`/instances/${encodeURIComponent(instanceId)}/file`)
    const filename = `${String(index + 1).padStart(5, "0")}-${instanceId}.dcm`
    await fs.writeFile(path.join(workDir, filename), buffer)
  }

  await runFolderImport(workDir)

  if (process.env.RAI_PACS_ORTHANC_DELETE_AFTER_IMPORT === "true") {
    await orthancJson(`/studies/${encodeURIComponent(studyId)}`, { method: "DELETE" })
  }

  console.log(
    JSON.stringify(
      {
        status: "imported",
        orthancUrl,
        studyId,
        instanceCount: instanceIds.length,
        stagingDir: workDir,
        deletedFromOrthanc:
          process.env.RAI_PACS_ORTHANC_DELETE_AFTER_IMPORT === "true",
      },
      null,
      2
    )
  )
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status: "failed",
        orthancUrl,
        studyId,
        stagingDir: workDir,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  )
  process.exitCode = 1
}

async function resolveStudyIdByUid() {
  const expectedUid = process.env.RAI_PACS_ORTHANC_STUDY_UID
  const studyIds = await orthancJson("/studies")

  for (const candidateId of studyIds) {
    const study = await orthancJson(`/studies/${encodeURIComponent(candidateId)}`)
    if (study.MainDicomTags?.StudyInstanceUID === expectedUid) return candidateId
  }

  throw new Error(`Orthanc study with StudyInstanceUID ${expectedUid} was not found.`)
}

async function listStudyInstanceIds(id) {
  const study = await orthancJson(`/studies/${encodeURIComponent(id)}`)
  const seriesIds = Array.isArray(study.Series) ? study.Series : []
  const instanceIds = []

  for (const seriesId of seriesIds) {
    const series = await orthancJson(`/series/${encodeURIComponent(seriesId)}`)
    if (Array.isArray(series.Instances)) instanceIds.push(...series.Instances)
  }

  return instanceIds
}

async function orthancJson(route, init = {}) {
  const response = await fetch(`${orthancUrl}${route}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(orthancAuthHeader ? { Authorization: orthancAuthHeader } : {}),
    },
  })

  if (!response.ok) {
    throw new Error(`Orthanc ${route} failed: ${response.status} ${response.statusText}`)
  }

  if (response.status === 204) return null
  return response.json()
}

async function orthancBinary(route) {
  const response = await fetch(`${orthancUrl}${route}`, {
    headers: orthancAuthHeader ? { Authorization: orthancAuthHeader } : {},
  })

  if (!response.ok) {
    throw new Error(`Orthanc ${route} failed: ${response.status} ${response.statusText}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

function createOrthancAuthHeader() {
  const username = process.env.RAI_PACS_ORTHANC_USERNAME
  const password = process.env.RAI_PACS_ORTHANC_PASSWORD
  if (!username && !password) return null
  if (!username || !password) {
    throw new Error(
      "Set both RAI_PACS_ORTHANC_USERNAME and RAI_PACS_ORTHANC_PASSWORD, or neither."
    )
  }

  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

function runFolderImport(dicomDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/import-dicom-folder.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, RAI_PACS_DICOM_DIR: dicomDir },
      stdio: "inherit",
    })

    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Folder import exited with code ${code}`))
    })
  })
}
