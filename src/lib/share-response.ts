import { headers } from "next/headers"
import { NextResponse } from "next/server"

import { verifyExternalStudyShareToken } from "@/lib/external-share"
import { hasOhifLaunchSecret } from "@/lib/ohif-launch"
import { createOhifDicomJsonViewerUrl } from "@/lib/ohif-viewer"
import { createServiceClient, isSupabaseServiceConfigured } from "@/lib/supabase/service"

type ShareLookup = {
  shareId?: string
  token?: string
}

type ExternalShareRow = {
  expires_at: string
  token: string
}

export type ShareViewerData = {
  expiresAt: string
  instances: Array<{
    id: string
    instanceNumber: number | null
    seriesDescription: string | null
    seriesId: string
    seriesModality: string
    seriesNumber: number | null
    sopInstanceUid: string
  }>
  ohifViewerUrl: string
  shareToken: string
  study: {
    accessionNumber: string
    description: string
    modality: string
    patientName: string
    patientNumber: string
    studyAt: string
  }
  studyId: string
}

type ShareViewerResult =
  | { data: ShareViewerData; ok: true }
  | { error: string; ok: false; status: number }

export async function getShareViewerData(lookup: ShareLookup | string): Promise<ShareViewerResult> {
  const input = typeof lookup === "string" ? { token: lookup } : lookup

  if (!input.shareId && !input.token) {
    return { error: "Paylaşım token bulunamadı.", ok: false, status: 400 }
  }

  if (!isSupabaseServiceConfigured()) {
    return { error: "Paylaşım servisi yapılandırılmamış.", ok: false, status: 500 }
  }

  if (!hasOhifLaunchSecret()) {
    return { error: "Viewer launch secret tanımlı değil.", ok: false, status: 500 }
  }

  const supabase = createServiceClient()
  const shareToken = input.shareId
    ? await resolveStoredShareToken(supabase, input.shareId)
    : input.token

  if (!shareToken) {
    return { error: "Paylaşım linki geçersiz veya süresi dolmuş.", ok: false, status: 401 }
  }

  const share = verifyExternalStudyShareToken(shareToken)

  if (!share) {
    return { error: "Paylaşım linki geçersiz veya süresi dolmuş.", ok: false, status: 401 }
  }

  const { data: study, error } = await supabase
    .from("studies")
    .select(
      "id, accession_number, modality, description, study_at, patients(id, patient_number, first_name, last_name)"
    )
    .eq("id", share.studyId)
    .eq("organization_id", share.organizationId)
    .maybeSingle()

  if (error) return { error: error.message, ok: false, status: 500 }
  if (!study) return { error: "Tetkik bulunamadı.", ok: false, status: 404 }

  const [{ data: series, error: seriesError }, { data: instances, error: instancesError }] =
    await Promise.all([
      supabase
        .from("series")
        .select("id, series_number, modality, description")
        .eq("study_id", study.id)
        .eq("organization_id", share.organizationId)
        .order("series_number", { ascending: true }),
      supabase
        .from("instances")
        .select("id, series_id, sop_instance_uid, instance_number")
        .eq("study_id", study.id)
        .eq("organization_id", share.organizationId)
        .order("instance_number", { ascending: true }),
    ])

  if (seriesError) return { error: seriesError.message, ok: false, status: 500 }
  if (instancesError) return { error: instancesError.message, ok: false, status: 500 }

  const patient = Array.isArray(study.patients) ? study.patients[0] : study.patients
  const seriesById = new Map((series ?? []).map((item) => [item.id, item]))
  const requestHeaders = await headers()
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https"
  const origin = host ? `${protocol}://${host}` : "https://app.raipacs.com"

  return {
    data: {
      expiresAt: new Date(share.exp * 1000).toISOString(),
      ohifViewerUrl: createOhifDicomJsonViewerUrl({
        origin,
        organizationId: share.organizationId,
        studyId: study.id,
        userId: "external-share",
      }),
      shareToken,
      studyId: study.id,
      study: {
        accessionNumber: study.accession_number,
        description: study.description ?? "DICOM görüntüleme",
        modality: study.modality,
        patientName: patient ? `${patient.first_name} ${patient.last_name}` : "",
        patientNumber: patient?.patient_number ?? "",
        studyAt: study.study_at,
      },
      instances: (instances ?? []).map((instance) => ({
        id: instance.id,
        seriesId: instance.series_id,
        seriesNumber: seriesById.get(instance.series_id)?.series_number ?? null,
        seriesDescription: seriesById.get(instance.series_id)?.description ?? null,
        seriesModality: seriesById.get(instance.series_id)?.modality ?? study.modality,
        instanceNumber: instance.instance_number,
        sopInstanceUid: instance.sop_instance_uid,
      })),
    },
    ok: true,
  }
}

export async function buildShareResponse(lookup: ShareLookup | string) {
  const result = await getShareViewerData(lookup)

  if (!result.ok) return jsonError(result.error, result.status)

  return NextResponse.json(result.data, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  })
}

async function resolveStoredShareToken(
  supabase: ReturnType<typeof createServiceClient>,
  shareId: string
) {
  const { data, error } = await supabase
    .from("external_study_shares")
    .select("expires_at, token")
    .eq("id", shareId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()

  if (error || !data) return null

  return (data as ExternalShareRow).token
}

function jsonError(error: string, status: number) {
  return NextResponse.json(
    { error },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
      status,
    }
  )
}
