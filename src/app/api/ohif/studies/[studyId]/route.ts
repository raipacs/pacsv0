import { NextResponse } from "next/server"

import { verifyOhifLaunchToken } from "@/lib/ohif-launch"
import { createServiceClient, isSupabaseServiceConfigured } from "@/lib/supabase/service"

type RouteContext = {
  params: Promise<{ studyId: string }>
}

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Origin": "https://viewer.ohif.org",
  "Cache-Control": "private, no-store",
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS })
}

export async function GET(request: Request, context: RouteContext) {
  const { studyId } = await context.params
  const token = new URL(request.url).searchParams.get("token") ?? ""
  const launch = verifyOhifLaunchToken(token, studyId)

  if (!launch) {
    return jsonError("OHIF launch token geçersiz veya süresi doldu.", 401)
  }

  if (!isSupabaseServiceConfigured()) {
    return jsonError("Supabase service istemcisi yapılandırılmamış.", 500)
  }

  const supabase = createServiceClient()
  const { data: study, error: studyError } = await supabase
    .from("studies")
    .select(
      "id, organization_id, study_instance_uid, accession_number, modality, description, study_at, patients(patient_number, first_name, last_name, birth_date, sex)"
    )
    .eq("id", studyId)
    .eq("organization_id", launch.organizationId)
    .maybeSingle()

  if (studyError) return jsonError(studyError.message, 500)
  if (!study) return jsonError("Tetkik bulunamadı.", 404)

  const [{ data: series, error: seriesError }, { data: instances, error: instancesError }] =
    await Promise.all([
      supabase
        .from("series")
        .select("id, series_instance_uid, series_number, modality, description")
        .eq("study_id", study.id)
        .eq("organization_id", launch.organizationId)
        .order("series_number", { ascending: true }),
      supabase
        .from("instances")
        .select(
          "id, series_id, sop_instance_uid, sop_class_uid, transfer_syntax_uid, instance_number, storage_bucket, storage_key"
        )
        .eq("study_id", study.id)
        .eq("organization_id", launch.organizationId)
        .order("instance_number", { ascending: true }),
    ])

  if (seriesError) return jsonError(seriesError.message, 500)
  if (instancesError) return jsonError(instancesError.message, 500)

  const patient = Array.isArray(study.patients) ? study.patients[0] : study.patients
  const signedInstances = await Promise.all(
    (instances ?? []).map(async (instance) => {
      const { data, error } = await supabase.storage
        .from(instance.storage_bucket)
        .createSignedUrl(instance.storage_key, 10 * 60, { download: true })

      if (error) throw new Error(error.message)
      return { ...instance, signedUrl: data.signedUrl }
    })
  )
  const modalities = Array.from(
    new Set((series ?? []).map((item) => item.modality).filter(Boolean))
  )
  const studyDate = formatDicomDate(study.study_at)
  const studyTime = formatDicomTime(study.study_at)
  const patientName = patient
    ? `${patient.last_name || ""}^${patient.first_name || ""}`.trim()
    : ""

  return NextResponse.json(
    {
      studies: [
        {
          StudyInstanceUID: study.study_instance_uid,
          StudyDate: studyDate,
          StudyTime: studyTime,
          PatientName: patientName,
          PatientID: patient?.patient_number ?? "",
          PatientBirthDate: formatDicomDate(patient?.birth_date ?? null),
          PatientSex: patient?.sex ?? "",
          AccessionNumber: study.accession_number,
          StudyDescription: study.description ?? "",
          NumInstances: signedInstances.length,
          Modalities: modalities.join("\\"),
          series: (series ?? []).map((seriesItem) => {
            const seriesInstances = signedInstances.filter(
              (instance) => instance.series_id === seriesItem.id
            )

            return {
              SeriesInstanceUID: seriesItem.series_instance_uid,
              SeriesNumber: seriesItem.series_number ?? undefined,
              Modality: seriesItem.modality,
              SeriesDescription: seriesItem.description ?? "",
              instances: seriesInstances.map((instance) => ({
                metadata: {
                  AccessionNumber: study.accession_number,
                  InstanceNumber: instance.instance_number ?? undefined,
                  Modality: seriesItem.modality,
                  PatientID: patient?.patient_number ?? "",
                  PatientName: patientName,
                  SeriesDescription: seriesItem.description ?? "",
                  SeriesInstanceUID: seriesItem.series_instance_uid,
                  SeriesNumber: seriesItem.series_number ?? undefined,
                  SOPClassUID: instance.sop_class_uid ?? undefined,
                  SOPInstanceUID: instance.sop_instance_uid,
                  StudyDate: studyDate,
                  StudyDescription: study.description ?? "",
                  StudyInstanceUID: study.study_instance_uid,
                  StudyTime: studyTime,
                  TransferSyntaxUID: instance.transfer_syntax_uid ?? undefined,
                },
                url: `dicomweb:${instance.signedUrl}`,
              })),
            }
          }),
        },
      ],
    },
    { headers: CORS_HEADERS }
  )
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: CORS_HEADERS })
}

function formatDicomDate(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}${String(date.getUTCDate()).padStart(2, "0")}`
}

function formatDicomTime(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return `${String(date.getUTCHours()).padStart(2, "0")}${String(
    date.getUTCMinutes()
  ).padStart(2, "0")}${String(date.getUTCSeconds()).padStart(2, "0")}`
}
