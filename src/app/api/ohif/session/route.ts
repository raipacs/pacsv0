import { NextResponse } from "next/server"

import {
  buildOhifDicomJsonManifest,
  OHIF_CORS_HEADERS,
} from "@/lib/ohif-dicom-json"
import { getOhifLaunchStudyIds, verifyOhifLaunchToken } from "@/lib/ohif-launch"
import { createServiceClient, isSupabaseServiceConfigured } from "@/lib/supabase/service"

export async function OPTIONS() {
  return new NextResponse(null, { headers: OHIF_CORS_HEADERS })
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const token = requestUrl.searchParams.get("token") ?? ""
  const launch = verifyOhifLaunchToken(token)

  if (!launch) {
    return jsonError("OHIF launch token geçersiz veya süresi doldu.", 401)
  }

  const studyIds = getOhifLaunchStudyIds(launch)
  if (!studyIds.length) return jsonError("OHIF oturumu için tetkik bulunamadı.", 400)

  if (!isSupabaseServiceConfigured()) {
    return jsonError("Supabase service istemcisi yapılandırılmamış.", 500)
  }

  try {
    const manifest = await buildOhifDicomJsonManifest({
      organizationId: launch.organizationId,
      origin: requestUrl.origin,
      studyIds,
      supabase: createServiceClient(),
      token,
    })

    if (!manifest.studies.length) {
      return jsonError("OHIF oturumunda gösterilecek tetkik bulunamadı.", 404)
    }

    return NextResponse.json(manifest, { headers: OHIF_CORS_HEADERS })
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "OHIF oturum manifesti hazırlanamadı.",
      500
    )
  }
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: OHIF_CORS_HEADERS })
}
