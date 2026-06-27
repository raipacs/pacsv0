import Link from "next/link"
import { headers } from "next/headers"
import { notFound } from "next/navigation"

import { finalizeReport, saveReportDraft } from "@/app/actions/reports"
import {
  MaskedPatientId,
  MaskedPatientName,
  PrivacyToggle,
} from "@/components/privacy-mode"
import { AiLaunchControl } from "@/components/ai-launch-control"
import { ExternalShareButton } from "@/components/external-share-button"
import { RaiDicomViewer } from "@/components/rai-dicom-viewer"
import { aiJobStatusLabel, isMissingAiTableError, type AiProviderOption } from "@/lib/ai-reporting"
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
  searchParams: Promise<{ aiJob?: string; patientId?: string }>
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

  const [
    { data: series, error: seriesError },
    { data: instances, error: instancesError },
    aiViewerState,
    { data: latestReport, error: latestReportError },
  ] = await Promise.all([
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
      loadAiViewerState(supabase, user.organizationId, study.id),
      supabase
        .from("reports")
        .select("id, status, findings, impression, version, finalized_at, updated_at")
        .eq("organization_id", user.organizationId)
        .eq("study_id", study.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

  if (seriesError) {
    throw new Error(`Viewer seri listesi alınamadı: ${seriesError.message}`)
  }

  if (instancesError) {
    throw new Error(`Viewer instance listesi alınamadı: ${instancesError.message}`)
  }

  if (latestReportError) {
    throw new Error(`Rapor bilgisi alınamadı: ${latestReportError.message}`)
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
  const returnTo = query.patientId
    ? `/viewer/${studyId}?patientId=${encodeURIComponent(query.patientId)}`
    : `/viewer/${studyId}`

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
          <PrivacyToggle />
          <AiLaunchControl
            latestJob={aiViewerState.latestJob}
            providers={aiViewerState.providers}
            returnTo={returnTo}
            studyId={studyId}
            unavailableReason={aiViewerState.unavailableReason}
          />
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
          <ExternalShareButton studyId={studyId} />
        </nav>
      </header>
      {aiViewerState.latestJob?.status === "failed" ? (
        <section className="ai-job-alert" aria-label="AI son çalışma durumu">
          <strong>{aiViewerState.latestJob.providerName}</strong>
          <span>
            {aiViewerState.latestJob.modelName || "model seçilmedi"} · Ön rapor üretimi başarısız.
          </span>
          <small>{aiViewerState.latestJob.errorMessage || "AI sağlayıcı hatası kaydedildi."}</small>
        </section>
      ) : null}
      <ReportEditorPanel
        isNewAiDraft={Boolean(query.aiJob && query.aiJob === aiViewerState.latestDraft?.jobId)}
        latestDraft={aiViewerState.latestDraft}
        report={latestReport}
        returnTo={returnTo}
        studyId={studyId}
      />
      <RaiDicomViewer
        studyId={studyId}
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

type ReportRow = {
  finalized_at: string | null
  findings: string | null
  id: string
  impression: string | null
  status: string
  updated_at: string
  version: number
} | null

function ReportEditorPanel({
  isNewAiDraft,
  latestDraft,
  report,
  returnTo,
  studyId,
}: {
  isNewAiDraft: boolean
  latestDraft: AiDraftView | null
  report: ReportRow
  returnTo: string
  studyId: string
}) {
  const defaultFindings = report?.findings || latestDraft?.findings || ""
  const defaultImpression = report?.impression || latestDraft?.impression || ""
  const isFinal = report?.status === "final"

  return (
    <details className="report-editor-strip" open={Boolean(latestDraft || report)}>
      <summary>
        <span>Rapor</span>
        <strong>
          {report
            ? `${report.status === "final" ? "Nihai rapor" : "Taslak rapor"} v${report.version}`
            : latestDraft
              ? "AI ön rapordan taslak"
              : "Manuel rapor"}
        </strong>
        {latestDraft ? (
          <small>
            <span className="health-badge ok">
              {isNewAiDraft ? "Yeni ön rapor hazır" : aiJobStatusLabel(latestDraft.jobStatus)}
            </span>
            {latestDraft.providerName} · {latestDraft.modelName || "model seçilmedi"} · Güven skoru{" "}
            {formatConfidence(latestDraft.confidenceScore)}
          </small>
        ) : null}
      </summary>
      <form className="report-editor-form">
        <input name="studyId" type="hidden" value={studyId} />
        <input name="reportId" type="hidden" value={report?.id ?? ""} />
        <input name="returnTo" type="hidden" value={returnTo} />
        <label>
          Bulgular
          <textarea
            defaultValue={defaultFindings}
            name="findings"
            placeholder="Bulgular..."
            readOnly={isFinal}
            rows={5}
            required
          />
        </label>
        <label>
          İzlenim
          <textarea
            defaultValue={defaultImpression}
            name="impression"
            placeholder="İzlenim..."
            readOnly={isFinal}
            rows={3}
            required
          />
        </label>
        <div className="report-editor-actions">
          <small>
            {isFinal
              ? `Onaylandı: ${formatDateTime(report.finalized_at)}`
              : "AI taslağı hekim tarafından düzenlenip onaylanınca nihai rapora dönüşür."}
          </small>
          <button
            className="button subtle"
            disabled={isFinal}
            formAction={saveReportDraft}
            type="submit"
          >
            Taslak kaydet
          </button>
          <button
            className="button primary"
            disabled={isFinal}
            formAction={finalizeReport}
            type="submit"
          >
            Nihai rapor onayla
          </button>
        </div>
      </form>
    </details>
  )
}

type AiDraftView = {
  confidenceScore: number | null
  findings: string
  impression: string
  jobStatus: string
  jobId: string
  modelName: string | null
  providerName: string
}

type AiJobView = {
  completedAt: string | null
  createdAt: string
  errorMessage: string | null
  modelName: string | null
  providerName: string
  status: string
}

async function loadAiViewerState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  studyId: string
): Promise<{
  latestJob: AiJobView | null
  latestDraft: AiDraftView | null
  providers: AiProviderOption[]
  unavailableReason?: string
}> {
  const { data: providers, error: providersError } = await supabase
    .from("ai_service_providers")
    .select("id, name, slug, provider_type, default_model, is_active, is_default, requires_credentials")
    .eq("organization_id", organizationId)
    .order("is_default", { ascending: false })
    .order("name", { ascending: true })

  if (providersError) {
    if (isMissingAiTableError(providersError)) {
      return {
        latestJob: null,
        latestDraft: null,
        providers: [],
        unavailableReason: "AI tabloları Supabase üzerinde hazır değil.",
      }
    }

    throw new Error(`AI servisleri alınamadı: ${providersError.message}`)
  }

  const { data: latestDraft, error: draftError } = await supabase
    .from("ai_report_drafts")
    .select("id, job_id, findings, impression, confidence_score, created_at")
    .eq("organization_id", organizationId)
    .eq("study_id", studyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (draftError) {
    if (isMissingAiTableError(draftError)) {
      return {
        latestJob: null,
        latestDraft: null,
        providers: mapAiProviders(providers ?? []),
        unavailableReason: "AI tabloları Supabase üzerinde hazır değil.",
      }
    }

    throw new Error(`AI ön raporu alınamadı: ${draftError.message}`)
  }

  const latestJob = await loadLatestAiJob(supabase, organizationId, studyId)

  if (!latestDraft) {
    return {
      latestJob,
      latestDraft: null,
      providers: mapAiProviders(providers ?? []),
    }
  }

  const { data: job, error: jobError } = await supabase
    .from("ai_jobs")
    .select("status, provider_slug, model_name, ai_service_providers(name)")
    .eq("id", latestDraft.job_id)
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (jobError) throw new Error(`AI iş bilgisi alınamadı: ${jobError.message}`)

  const provider = Array.isArray(job?.ai_service_providers)
    ? job?.ai_service_providers[0]
    : job?.ai_service_providers

  return {
    latestJob,
    latestDraft: {
      confidenceScore: latestDraft.confidence_score,
      findings: latestDraft.findings,
      impression: latestDraft.impression,
      jobStatus: job?.status ?? "draft_ready",
      jobId: latestDraft.job_id,
      modelName: job?.model_name ?? null,
      providerName: provider?.name ?? job?.provider_slug ?? "AI",
    },
    providers: mapAiProviders(providers ?? []),
  }
}

async function loadLatestAiJob(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  studyId: string
): Promise<AiJobView | null> {
  const { data: job, error } = await supabase
    .from("ai_jobs")
    .select(
      "status, provider_slug, model_name, error_message, created_at, completed_at, ai_service_providers(name)"
    )
    .eq("organization_id", organizationId)
    .eq("study_id", studyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (isMissingAiTableError(error)) return null
    throw new Error(`Son AI iş bilgisi alınamadı: ${error.message}`)
  }

  if (!job) return null

  const provider = Array.isArray(job.ai_service_providers)
    ? job.ai_service_providers[0]
    : job.ai_service_providers

  return {
    completedAt: job.completed_at ?? null,
    createdAt: job.created_at,
    errorMessage: job.error_message,
    modelName: job.model_name ?? null,
    providerName: provider?.name ?? job.provider_slug ?? "AI",
    status: job.status,
  }
}

function mapAiProviders(rows: Array<Record<string, unknown>>): AiProviderOption[] {
  return rows.map((row) => ({
    defaultModel: String(row.default_model ?? "") || null,
    id: String(row.id),
    isActive: row.is_active === true,
    isDefault: row.is_default === true,
    name: String(row.name ?? "AI"),
    providerType: String(row.provider_type ?? "custom"),
    requiresCredentials: row.requires_credentials === true,
    slug: String(row.slug ?? ""),
  }))
}

function formatConfidence(value: number | null) {
  if (typeof value !== "number") return "-"
  return `%${Math.round(value * 100)}`
}

function formatDateTime(value: string | null) {
  if (!value) return "-"
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value))
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
