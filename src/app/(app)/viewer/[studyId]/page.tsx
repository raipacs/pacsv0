import Link from "next/link"
import { headers } from "next/headers"
import { notFound } from "next/navigation"

import { MaskedPatientId, MaskedPatientName } from "@/components/privacy-mode"
import { RaiDicomViewer } from "@/components/rai-dicom-viewer"
import { requireUser } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/config"
import { hasOhifLaunchSecret } from "@/lib/ohif-launch"
import { createOhifDicomJsonViewerUrl } from "@/lib/ohif-viewer"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "RAI Viewer" }

export default async function RaiViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ studyId: string }>
  searchParams: Promise<{ patientId?: string }>
}) {
  const [{ studyId }, query, user] = await Promise.all([
    params,
    searchParams,
    requireUser(),
  ])

  if (!isSupabaseConfigured) {
    return <ViewerError message="Demo modda viewer açılamaz." />
  }

  if (!hasOhifLaunchSecret()) {
    return <ViewerError message="OHIF launch secret tanımlı değil." />
  }

  const supabase = await createClient()
  const { data: study, error } = await supabase
    .from("studies")
    .select(
      "id, accession_number, modality, description, study_at, patients(id, patient_number, first_name, last_name)"
    )
    .eq("id", studyId)
    .eq("organization_id", user.organizationId)
    .maybeSingle()

  if (error) throw new Error(`Viewer tetkiki alınamadı: ${error.message}`)
  if (!study) notFound()

  const [{ data: series, error: seriesError }, { data: instances, error: instancesError }] =
    await Promise.all([
      supabase
        .from("series")
        .select("id, series_number, modality, description")
        .eq("study_id", study.id)
        .eq("organization_id", user.organizationId)
        .order("series_number", { ascending: true }),
      supabase
        .from("instances")
        .select("id, series_id, sop_instance_uid, instance_number")
        .eq("study_id", study.id)
        .eq("organization_id", user.organizationId)
        .order("instance_number", { ascending: true }),
    ])

  if (seriesError) {
    throw new Error(`Viewer seri listesi alınamadı: ${seriesError.message}`)
  }

  if (instancesError) {
    throw new Error(`Viewer instance listesi alınamadı: ${instancesError.message}`)
  }

  const patient = Array.isArray(study.patients) ? study.patients[0] : study.patients
  const requestHeaders = await headers()
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https"
  const origin = host ? `${protocol}://${host}` : "https://app.raipacs.com"
  const viewerUrl = createOhifDicomJsonViewerUrl({
    origin,
    organizationId: user.organizationId,
    studyId,
    userId: user.id,
  })
  const patientHref = query.patientId
    ? `/patients/${query.patientId}`
    : patient?.id
      ? `/patients/${patient.id}`
      : null

  const seriesById = new Map((series ?? []).map((item) => [item.id, item]))

  return (
    <section className="rai-viewer-page">
      <header className="rai-viewer-bar">
        <div>
          <p className="eyebrow">RAI Viewer</p>
          <h1>{study.description ?? "DICOM görüntüleme"}</h1>
          <p>
            {patient ? (
              <>
                <MaskedPatientName
                  value={`${patient.first_name} ${patient.last_name}`}
                />{" "}
                · <MaskedPatientId value={patient.patient_number} />
              </>
            ) : (
              "Hasta bilgisi yok"
            )}{" "}
            · {study.modality} · {study.accession_number}
          </p>
        </div>
        <nav aria-label="Viewer navigasyonu">
          <Link className="button subtle" href="/worklist">
            Worklist
          </Link>
          {patientHref ? (
            <Link className="button subtle" href={patientHref}>
              Hasta detayı
            </Link>
          ) : null}
          <a
            className="button primary"
            href={viewerUrl}
            rel="noreferrer"
            target="_blank"
          >
            OHIF yeni sekme
          </a>
        </nav>
      </header>
      <RaiDicomViewer
        study={{
          accessionNumber: study.accession_number,
          description: study.description ?? "DICOM görüntüleme",
          modality: study.modality,
          patientName: patient ? `${patient.first_name} ${patient.last_name}` : "",
          patientNumber: patient?.patient_number ?? "",
          studyAt: study.study_at,
        }}
        instances={(instances ?? []).map((instance) => ({
          id: instance.id,
          seriesId: instance.series_id,
          seriesNumber: seriesById.get(instance.series_id)?.series_number ?? null,
          seriesDescription: seriesById.get(instance.series_id)?.description ?? null,
          seriesModality: seriesById.get(instance.series_id)?.modality ?? study.modality,
          instanceNumber: instance.instance_number,
          sopInstanceUid: instance.sop_instance_uid,
        }))}
      />
    </section>
  )
}

function ViewerError({ message }: { message: string }) {
  return (
    <section className="data-panel viewer-error-panel">
      <div className="panel-heading">
        <h1>Viewer açılamadı</h1>
      </div>
      <p className="empty-state">{message}</p>
      <div className="form-actions">
        <Link className="button primary" href="/worklist">
          Worklist&apos;e dön
        </Link>
      </div>
    </section>
  )
}
