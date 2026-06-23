import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

const rootDir = process.cwd()
const envFile =
  process.env.RAI_PACS_GATEWAY_ENV_FILE ||
  path.join(rootDir, "dicom-gateway", "production", ".env")
const stateFile =
  process.env.RAI_PACS_ORTHANC_IMPORT_STATE_FILE ||
  path.join(rootDir, "dicom-gateway", "production", ".orthanc-import-state.json")

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
const state = await readState()
const studyIds = await orthancJson("/studies")
const imported = []
const failed = []
const skipped = []

for (const studyId of studyIds) {
  if (state.imported?.[studyId]) {
    skipped.push({ studyId, reason: "already-imported" })
    continue
  }

  try {
    const study = await orthancJson(`/studies/${encodeURIComponent(studyId)}`)
    const studyUid = study.MainDicomTags?.StudyInstanceUID
    if (!studyUid) {
      skipped.push({ studyId, reason: "missing-study-instance-uid" })
      continue
    }

    await runStudyImport(studyUid)
    state.imported ??= {}
    state.imported[studyId] = {
      studyInstanceUid: studyUid,
      importedAt: new Date().toISOString(),
    }
    await writeState(state)
    imported.push({ studyId, studyInstanceUid: studyUid })
  } catch (error) {
    failed.push({
      studyId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

console.log(
  JSON.stringify(
    {
      status: failed.length ? "completed-with-errors" : "completed",
      orthancUrl,
      stateFile,
      studyCount: studyIds.length,
      imported,
      skipped,
      failed,
    },
    null,
    2
  )
)

if (failed.length) process.exitCode = 1

async function orthancJson(route) {
  const response = await fetch(`${orthancUrl}${route}`, {
    headers: { Authorization: orthancAuthHeader },
  })
  if (!response.ok) {
    throw new Error(`Orthanc ${route} failed: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

function runStudyImport(studyUid) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/import-orthanc-study.mjs"], {
      cwd: rootDir,
      env: {
        ...process.env,
        RAI_PACS_ORTHANC_STUDY_UID: studyUid,
        RAI_PACS_ORTHANC_STUDY_ID: "",
        RAI_PACS_ORTHANC_DELETE_AFTER_IMPORT:
          process.env.RAI_PACS_ORTHANC_DELETE_AFTER_IMPORT || "false",
      },
      stdio: "inherit",
    })

    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Study import exited with code ${code}`))
    })
  })
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(stateFile, "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT") return { imported: {} }
    throw error
  }
}

async function writeState(nextState) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true })
  await fs.writeFile(stateFile, `${JSON.stringify(nextState, null, 2)}\n`, {
    mode: 0o600,
  })
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
