import { NextResponse } from "next/server"

import { OHIF_CORS_HEADERS } from "@/lib/ohif-dicom-json"
import { verifyOhifLaunchToken } from "@/lib/ohif-launch"
import { createServiceClient, isSupabaseServiceConfigured } from "@/lib/supabase/service"

type RouteContext = {
  params: Promise<{ instanceId: string }>
}

const CORS_HEADERS = {
  ...OHIF_CORS_HEADERS,
  "Cross-Origin-Resource-Policy": "cross-origin",
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS })
}

export async function HEAD(request: Request, context: RouteContext) {
  return proxyDicomInstance(request, context, "HEAD")
}

export async function GET(request: Request, context: RouteContext) {
  return proxyDicomInstance(request, context, "GET")
}

async function proxyDicomInstance(
  request: Request,
  context: RouteContext,
  method: "GET" | "HEAD"
) {
  const { instanceId } = await context.params
  const requestUrl = new URL(request.url)
  const studyId = requestUrl.searchParams.get("studyId") ?? ""
  const token = requestUrl.searchParams.get("token") ?? ""
  const launch = verifyOhifLaunchToken(token, studyId)

  if (!launch) {
    return jsonError("OHIF launch token geçersiz veya süresi doldu.", 401)
  }

  if (!isSupabaseServiceConfigured()) {
    return jsonError("Supabase service istemcisi yapılandırılmamış.", 500)
  }

  const supabase = createServiceClient()
  const { data: instance, error } = await supabase
    .from("instances")
    .select("id, organization_id, study_id, storage_bucket, storage_key")
    .eq("id", instanceId)
    .eq("study_id", studyId)
    .eq("organization_id", launch.organizationId)
    .maybeSingle()

  if (error) return jsonError(error.message, 500)
  if (!instance) return jsonError("DICOM instance bulunamadı.", 404)

  const { data: signedUrl, error: signedUrlError } = await supabase.storage
    .from(instance.storage_bucket)
    .createSignedUrl(instance.storage_key, 10 * 60, { download: true })

  if (signedUrlError) return jsonError(signedUrlError.message, 500)

  const upstream = await fetch(signedUrl.signedUrl, {
    headers: copyRangeHeader(request),
    method,
  })

  if (!upstream.ok && upstream.status !== 206) {
    return jsonError(`DICOM indirilemedi: ${upstream.status}`, upstream.status)
  }

  const headers = new Headers(CORS_HEADERS)
  headers.set("Content-Type", upstream.headers.get("content-type") ?? "application/dicom")
  headers.set("Accept-Ranges", upstream.headers.get("accept-ranges") ?? "bytes")

  copyHeader(upstream.headers, headers, "content-length")
  copyHeader(upstream.headers, headers, "content-range")

  return new NextResponse(method === "HEAD" ? null : upstream.body, {
    headers,
    status: upstream.status,
  })
}

function copyRangeHeader(request: Request) {
  const range = request.headers.get("range")
  return range ? { Range: range } : undefined
}

function copyHeader(source: Headers, target: Headers, name: string) {
  const value = source.get(name)
  if (value) target.set(name, value)
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: CORS_HEADERS })
}
