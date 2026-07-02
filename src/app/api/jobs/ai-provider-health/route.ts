import {
  runAiProviderHealthCheck,
  sendAiProviderHealthEmail,
} from "@/lib/ai-provider-health"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(request: Request) {
  const authError = authorizeJobRequest(request)
  if (authError) return authError

  const summary = await runAiProviderHealthCheck({ source: "vercel-cron" })
  const email = await sendAiProviderHealthEmail(summary)

  return Response.json(
    {
      email,
      ok: summary.failedCount === 0,
      summary,
    },
    { status: summary.failedCount === 0 ? 200 : 207 }
  )
}

export async function POST(request: Request) {
  return GET(request)
}

function authorizeJobRequest(request: Request) {
  const configuredSecret = process.env.CRON_SECRET?.trim()
  if (!configuredSecret) return null

  const requestUrl = new URL(request.url)
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim()
  const token = requestUrl.searchParams.get("token")?.trim()

  if (bearer === configuredSecret || token === configuredSecret) return null

  return Response.json({ error: "Unauthorized" }, { status: 401 })
}
