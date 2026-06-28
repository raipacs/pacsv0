#!/usr/bin/env node

const endpoint = process.env.RAI_LLM_ENDPOINT
const apiKey = process.env.RAI_LLM_API_KEY
const model = process.env.RAI_LLM_MODEL_ID || "Qwen/Qwen2.5-VL-7B-Instruct"
const timeoutMs = Number(process.env.RAI_LLM_TEST_TIMEOUT_MS || 120000)

if (!endpoint) {
  console.error("RAI_LLM_ENDPOINT tanımlı değil.")
  process.exit(1)
}

const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), timeoutMs)
const startedAt = Date.now()

try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      max_tokens: 450,
      messages: [
        {
          content:
            "Sen RAI PACS RAI LLM sağlık kontrolüsün. Sadece JSON döndür: {\"findings\":\"...\",\"impression\":\"...\",\"recommendations\":\"...\",\"confidenceScore\":0.1,\"criticality\":\"none\"}",
          role: "system",
        },
        {
          content: [
            {
              text: JSON.stringify({
                expectedJson: {
                  confidenceScore: "number 0..1",
                  criticality: "none | low | medium | high",
                  findings: "string",
                  impression: "string",
                  recommendations: "string",
                },
                study: {
                  accessionNumber: "RAI-LLM-SMOKE",
                  description: "RAI LLM endpoint smoke test",
                  instanceCount: 0,
                  modality: "SR",
                  seriesCount: 0,
                },
                task: "radiology_pre_report_smoke_test",
              }),
              type: "text",
            },
          ],
          role: "user",
        },
      ],
      model,
      response_format: { type: "json_object" },
      temperature: 0,
    }),
    signal: controller.signal,
  })

  const rawText = await response.text()
  const elapsedMs = Date.now() - startedAt

  if (!response.ok) {
    console.error(
      JSON.stringify(
        {
          elapsedMs,
          endpoint,
          error: rawText,
          ok: false,
          status: response.status,
        },
        null,
        2
      )
    )
    process.exit(1)
  }

  const payload = safeJson(rawText)
  const content =
    payload?.choices
      ?.map((choice) => choice.message?.content ?? choice.text)
      .filter(Boolean)
      .join("\n")
      .trim() || payload?.output_text || rawText

  console.log(
    JSON.stringify(
      {
        elapsedMs,
        endpoint,
        model: payload?.model || model,
        ok: true,
        responsePreview: content.slice(0, 1000),
        usage: payload?.usage ?? null,
      },
      null,
      2
    )
  )
} catch (error) {
  const elapsedMs = Date.now() - startedAt
  const message = error instanceof Error ? error.message : String(error)
  console.error(JSON.stringify({ elapsedMs, endpoint, error: message, ok: false }, null, 2))
  process.exit(1)
} finally {
  clearTimeout(timeout)
}

function safeJson(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
