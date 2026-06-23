import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import { createClient } from "@supabase/supabase-js"

const execFileAsync = promisify(execFile)
const rootDir = process.cwd()
const envFile =
  process.env.RAI_PACS_GATEWAY_ENV_FILE ||
  path.join(rootDir, "dicom-gateway", "production", ".env")
const stateFile =
  process.env.RAI_PACS_ORTHANC_LOG_STATE_FILE ||
  path.join(rootDir, "dicom-gateway", "production", ".orthanc-log-state.json")
const composeFile =
  process.env.RAI_PACS_ORTHANC_COMPOSE_FILE ||
  path.join(rootDir, "dicom-gateway", "production", "docker-compose.yml")

await loadEnvFile(envFile)

const REQUIRED_ENV = [
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

const branchSlug = process.env.RAI_PACS_BRANCH_SLUG ?? "merkez"
const calledAeTitle = process.env.RAI_PACS_DICOM_AE_TITLE ?? "RAIPACS"
const logSince = process.env.RAI_PACS_ORTHANC_LOG_SINCE ?? "3m"

const supabase = createClient(
  process.env.RAI_PACS_SUPABASE_URL,
  process.env.RAI_PACS_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "rai-pacs-orthanc-log-sync" } },
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
state.seen ??= {}

const logs = await readOrthancLogs()
const lines = logs.split(/\r?\n/).filter(Boolean)
let inserted = 0

for (const line of lines) {
  const event = parseLogLine(line)
  if (!event) continue

  const hash = createHash("sha256").update(line).digest("hex")
  if (state.seen[hash]) continue

  await recordConnectionEvent({
    ...event,
    message: event.message || line.slice(0, 600),
    metadata: { logLine: line },
  })
  state.seen[hash] = new Date().toISOString()
  inserted += 1
}

state.seen = Object.fromEntries(Object.entries(state.seen).slice(-500))
await writeState(state)

console.log(
  JSON.stringify(
    {
      status: "synced",
      composeFile,
      since: logSince,
      scannedLines: lines.length,
      inserted,
    },
    null,
    2
  )
)

async function readOrthancLogs() {
  try {
    const { stdout, stderr } = await execFileAsync("docker", [
      "compose",
      "-f",
      composeFile,
      "logs",
      "--since",
      logSince,
      "--no-color",
      "orthanc",
    ])
    return `${stdout}\n${stderr}`.trim()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await recordConnectionEvent({
      eventType: "warning",
      status: "warning",
      message: `Orthanc container log okunamadı: ${message}`,
      metadata: { composeFile, since: logSince },
    })
    return ""
  }
}

function parseLogLine(line) {
  const lower = line.toLowerCase()
  const isAssociation = lower.includes("association")
  const isEcho = lower.includes("c-echo") || lower.includes("echo")
  const isStore = lower.includes("c-store") || lower.includes("store")
  const isFailure =
    lower.includes("fail") ||
    lower.includes("reject") ||
    lower.includes("denied") ||
    lower.includes("error")

  if (!isAssociation && !isEcho && !isStore && !isFailure) return null

  return {
    eventType: isEcho ? "echo" : isStore ? "store" : isAssociation ? "association" : "warning",
    status: isFailure ? "failed" : isEcho ? "success" : "observed",
    sourceIp: extractIp(line),
    sourceAeTitle: extractAeTitle(line),
    message: summarizeLogLine(line, { isAssociation, isEcho, isStore, isFailure }),
  }
}

function extractIp(line) {
  const match = line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)
  return match?.[0] ?? null
}

function extractAeTitle(line) {
  const match =
    line.match(/\b(?:calling|remote|source)\s+(?:ae|aet|ae title)\s*[:=]?\s*([A-Za-z0-9_.-]+)/i) ||
    line.match(/\bAET\s*[:=]\s*([A-Za-z0-9_.-]+)/i)
  return match?.[1] ?? null
}

function summarizeLogLine(line, { isAssociation, isEcho, isStore, isFailure }) {
  if (isEcho && !isFailure) return "DICOM Verify/C-ECHO başarılı görünüyor"
  if (isEcho && isFailure) return "DICOM Verify/C-ECHO hata aldı"
  if (isStore && !isFailure) return "DICOM C-STORE log olayı yakalandı"
  if (isStore && isFailure) return "DICOM C-STORE hata aldı"
  if (isAssociation && !isFailure) return "DICOM association denemesi yakalandı"
  if (isAssociation && isFailure) return "DICOM association reddedildi veya hata aldı"
  return line.slice(0, 600)
}

async function recordConnectionEvent({
  eventType,
  status,
  message,
  sourceIp = null,
  sourceAeTitle = null,
  metadata = {},
}) {
  const { error } = await supabase.from("dicom_connection_events").insert({
    organization_id: membership.organization_id,
    ...(branchId ? { branch_id: branchId } : {}),
    event_type: eventType,
    source: "orthanc-log",
    source_ip: sourceIp,
    source_ae_title: sourceAeTitle,
    called_ae_title: calledAeTitle,
    message,
    status,
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

async function readState() {
  try {
    return JSON.parse(await fs.readFile(stateFile, "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT") return { seen: {} }
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
