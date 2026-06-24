import Link from "next/link"
import { headers } from "next/headers"
import { notFound } from "next/navigation"

import { RaiDicomViewer } from "@/components/rai-dicom-viewer"
import { verifyExternalStudyShareToken } from "@/lib/external-share"
import { hasOhifLaunchSecret } from "@/lib/ohif-launch"
import { createOhifDicomJsonViewerUrl } from "@/lib/ohif-viewer"
import { createServiceClient, isSupabaseServiceConfigured } from "@/lib/supabase/service"

export const metadata = { title: "RAI PACS Paylaşım" }

export default async function ExternalSharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const share = verifyExternalStudyShareToken(decodeURIComponent(token))

  if (!share) {
    return <ShareError message="Paylaşım linki geçersiz veya süresi dolmuş." />
  }

  if (!isSupabaseServiceConfigured()) {
    return <ShareError message="Paylaşım servisi yapılandırılmamış." />
  }

  if (!hasOhifLaunchSecret()) {
    return <ShareError message="Viewer launch secret tanımlı değil." />
  }

  const supabase = createServiceClient()
  const { data: study, error } = await supabase
    .from("studies")
    .select(
      "id, accession_number, modality, description, study_at, patients(id, patient_number, first_name, last_name)"
    )
    .eq("id", share.studyId)
    .eq("organization_id", share.organizationId)
    .maybeSingle()

  if (error) throw new Error(`Paylaşım tetkiki alınamadı: ${error.message}`)
  if (!study) notFound()

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

  if (seriesError) {
    throw new Error(`Paylaşım seri listesi alınamadı: ${seriesError.message}`)
  }

  if (instancesError) {
    throw new Error(`Paylaşım instance listesi alınamadı: ${instancesError.message}`)
  }

  const patient = Array.isArray(study.patients) ? study.patients[0] : study.patients
  const seriesById = new Map((series ?? []).map((item) => [item.id, item]))
  const requestHeaders = await headers()
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https"
  const origin = host ? `${protocol}://${host}` : "https://app.raipacs.com"
  const ohifViewerUrl = createOhifDicomJsonViewerUrl({
    origin,
    organizationId: share.organizationId,
    studyId: study.id,
    userId: "external-share",
  })
  const expiresAt = new Date(share.exp * 1000)

  return (
    <main className="external-share-page">
      <header className="rai-viewer-bar external-share-bar">
        <div>
          <p className="eyebrow">RAI PACS güvenli paylaşım</p>
          <h1>{study.description ?? "DICOM görüntüleme"}</h1>
          <p>
            {patient
              ? `${patient.first_name} ${patient.last_name} · ${patient.patient_number}`
              : "Hasta bilgisi yok"}{" "}
            · {study.modality} · {study.accession_number}
          </p>
          <p className="external-share-expiry">
            Link geçerlilik bitişi:{" "}
            {new Intl.DateTimeFormat("tr-TR", {
              dateStyle: "short",
              timeStyle: "short",
            }).format(expiresAt)}
          </p>
        </div>
        <nav aria-label="Paylaşım viewer navigasyonu">
          <a
            className="button primary"
            href={ohifViewerUrl}
            rel="noreferrer"
            target="_blank"
          >
            OHIF yeni sekme
          </a>
        </nav>
      </header>
      <RaiDicomViewer
        shareToken={decodeURIComponent(token)}
        studyId={study.id}
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
    </main>
  )
}

function ShareError({ message }: { message: string }) {
  return (
    <main className="external-share-page external-share-error-page">
      <section className="data-panel viewer-error-panel">
        <div className="panel-heading">
          <h1>Paylaşım açılamadı</h1>
        </div>
        <p className="empty-state">{message}</p>
        <div className="form-actions">
          <Link className="button primary" href="/login">
            RAI PACS giriş
          </Link>
        </div>
      </section>
    </main>
  )
}
