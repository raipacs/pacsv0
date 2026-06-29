#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"

const envFile = process.env.RAI_LLM_ENV_FILE || "rai-llm-vercel.env"
const fileEnv = existsSync(envFile) ? parseEnvFile(readFileSync(envFile, "utf8")) : {}

const values = {
  RAI_LLM_ENDPOINT: process.env.RAI_LLM_ENDPOINT || fileEnv.RAI_LLM_ENDPOINT,
  RAI_LLM_API_KEY: process.env.RAI_LLM_API_KEY || fileEnv.RAI_LLM_API_KEY,
  RAI_LLM_ENDPOINT_MODE:
    process.env.RAI_LLM_ENDPOINT_MODE || fileEnv.RAI_LLM_ENDPOINT_MODE || "openai-compatible",
  RAI_LLM_MODEL_ID:
    process.env.RAI_LLM_MODEL_ID || fileEnv.RAI_LLM_MODEL_ID || "Qwen/Qwen2.5-VL-7B-Instruct",
}

if (!values.RAI_LLM_ENDPOINT) {
  console.error("RAI_LLM_ENDPOINT tanımlı değil. Env olarak verin veya rai-llm-vercel.env dosyasını üretin.")
  process.exit(1)
}

if (!values.RAI_LLM_ENDPOINT.endsWith("/v1/chat/completions")) {
  console.error("RAI_LLM_ENDPOINT /v1/chat/completions ile bitmeli.")
  process.exit(1)
}

for (const [name, value] of Object.entries(values)) {
  if (!value && name !== "RAI_LLM_API_KEY") continue
  upsertVercelEnv(name, value)
}

console.log("\nRAI LLM Vercel production env hazır.")
console.log("Sonraki adımlar:")
console.log("1. npx vercel --prod")
console.log("2. Admin > AI Servisleri > RAI LLM > Canlı test et")
console.log("3. Viewer içinde provider olarak RAI LLM seçip AI akışını test et")

if (process.env.VERCEL_DEPLOY === "1") {
  run("npx", ["vercel", "--prod"], { input: null })
}

function upsertVercelEnv(name, value) {
  run("npx", ["vercel", "env", "rm", name, "production", "--yes"], {
    allowFailure: true,
    input: null,
    quiet: true,
  })
  run("npx", ["vercel", "env", "add", name, "production"], {
    input: `${value}\n`,
  })
  console.log(`${name}=production tanımlandı.`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input: options.input ?? undefined,
    stdio: options.quiet ? ["pipe", "pipe", "pipe"] : ["pipe", "inherit", "inherit"],
  })

  if (result.status !== 0 && !options.allowFailure) {
    process.exit(result.status || 1)
  }
}

function parseEnvFile(content) {
  const entries = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const separatorIndex = trimmed.indexOf("=")
    if (separatorIndex < 0) continue
    const key = trimmed.slice(0, separatorIndex).trim()
    let value = trimmed.slice(separatorIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    entries[key] = value
  }
  return entries
}
