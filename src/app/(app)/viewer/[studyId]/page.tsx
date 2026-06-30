import Link from "next/link"
import { headers } from "next/headers"
import { notFound } from "next/navigation"

import { CopyErrorButton } from "@/components/copy-error-button"
import {
  MaskedPatientId,
  MaskedPatientName,
  PrivacyToggle,
} from "@/components/privacy-mode"
import { AiLaunchControl } from "@/components/ai-launch-control"
import { ExternalShareButton } from "@/components/external-share-button"
import { RaiDicomViewer } from "@/components/rai-dicom-viewer"
import {
  ReportEditorPanel,
  type ReportEditorAiDraft,
  type ReportEditorReport,
} from "@/components/report-editor-panel"
import { isMissingAiTableError, type AiProviderOption } from "@/lib/ai-reporting"
import { requireUser } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/config"
import { hasOhifLaunchSecret } from "@/lib/ohif-launch"
import { createOhifDicomJsonViewerUrl } from "@/lib/ohif-viewer"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "RAI Viewer" }
export const maxDuration = 240

export default async function RaiViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ studyId: string }>
  searchParams: Promise<{
    aiDraft?: string
    aiJob?: string
    aiProvider?: string
    aiReuse?: string
    patientId?: string
    reportId?: string
  }>
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
    { data: reports, error: reportsError },
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
        .limit(12),
    ])

  if (seriesError) {
    throw new Error(`Viewer seri listesi alınamadı: ${seriesError.message}`)
  }

  if (instancesError) {
    throw new Error(`Viewer instance listesi alınamadı: ${instancesError.message}`)
  }

  if (reportsError) {
    throw new Error(`Rapor bilgisi alınamadı: ${reportsError.message}`)
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
  const latestJobErrorText =
    aiViewerState.latestJob?.status === "failed"
      ? [
          aiViewerState.latestJob.providerName,
          aiViewerState.latestJob.modelName,
          "Ön rapor üretimi başarısız.",
          aiViewerState.latestJob.errorMessage || "AI sağlayıcı hatası kaydedildi.",
        ]
          .filter(Boolean)
          .join("\n")
      : ""

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
            initialProviderId={query.aiProvider}
            latestJob={aiViewerState.latestJob}
            providers={aiViewerState.providers}
            reuseProviderId={query.aiReuse}
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
          <CopyErrorButton text={latestJobErrorText} />
        </section>
      ) : null}
      <ReportEditorPanel
        aiDrafts={aiViewerState.drafts}
        initialSourceId={resolveInitialReportSourceId(
          query.aiDraft,
          query.reportId,
          reports ?? [],
          aiViewerState.drafts
        )}
        isNewAiDraft={Boolean(query.aiJob && query.aiJob === aiViewerState.latestDraft?.jobId)}
        reports={mapReportsForEditor(reports ?? [])}
        returnTo={returnTo}
        studyId={studyId}
        template={createRadiologyReportTemplate({
          accessionNumber: study.accession_number,
          description: study.description,
          modality: study.modality,
        })}
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
}

type AiDraftView = {
  confidenceScore: number | null
  createdAt: string
  findings: string
  id: string
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
  drafts: AiDraftView[]
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
        drafts: [],
        latestJob: null,
        latestDraft: null,
        providers: [],
        unavailableReason: "AI tabloları Supabase üzerinde hazır değil.",
      }
    }

    throw new Error(`AI servisleri alınamadı: ${providersError.message}`)
  }

  const { data: aiDrafts, error: draftError } = await supabase
    .from("ai_report_drafts")
    .select(
      "id, job_id, findings, impression, confidence_score, created_at, ai_jobs(status, provider_slug, model_name, ai_service_providers(name))"
    )
    .eq("organization_id", organizationId)
    .eq("study_id", studyId)
    .order("created_at", { ascending: false })
    .limit(8)

  if (draftError) {
    if (isMissingAiTableError(draftError)) {
      return {
        drafts: [],
        latestJob: null,
        latestDraft: null,
        providers: mapAiProviders(providers ?? []),
        unavailableReason: "AI tabloları Supabase üzerinde hazır değil.",
      }
    }

    throw new Error(`AI ön raporu alınamadı: ${draftError.message}`)
  }

  const latestJob = await loadLatestAiJob(supabase, organizationId, studyId)
  const drafts = mapAiDraftsForEditor(aiDrafts ?? [])

  return {
    drafts,
    latestJob,
    latestDraft: drafts[0] ?? null,
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

function mapReportsForEditor(rows: ReportRow[]): ReportEditorReport[] {
  return rows.map((row) => ({
    finalizedAt: row.finalized_at,
    findings: row.findings ?? "",
    id: row.id,
    impression: row.impression ?? "",
    status: row.status,
    updatedAt: row.updated_at,
    version: row.version,
  }))
}

function mapAiDraftsForEditor(rows: Array<Record<string, unknown>>): ReportEditorAiDraft[] {
  return rows.map((row) => {
    const job = firstRelation(row.ai_jobs as Record<string, unknown> | Record<string, unknown>[] | null)
    const provider = firstRelation(
      job?.ai_service_providers as Record<string, unknown> | Record<string, unknown>[] | null
    )

    return {
      confidenceScore:
        typeof row.confidence_score === "number"
          ? row.confidence_score
          : row.confidence_score
            ? Number(row.confidence_score)
            : null,
      createdAt: String(row.created_at ?? ""),
      findings: String(row.findings ?? ""),
      id: String(row.id),
      impression: String(row.impression ?? ""),
      jobId: String(row.job_id ?? ""),
      jobStatus: String(job?.status ?? "draft_ready"),
      modelName: String(job?.model_name ?? "") || null,
      providerName: String(provider?.name ?? job?.provider_slug ?? "AI"),
    }
  })
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function resolveInitialReportSourceId(
  aiDraftId: string | undefined,
  reportId: string | undefined,
  reports: ReportRow[],
  aiDrafts: ReportEditorAiDraft[]
) {
  if (aiDraftId && aiDrafts.some((draft) => draft.id === aiDraftId)) return `ai:${aiDraftId}`

  if (reportId && reports.some((report) => report.id === reportId)) return `report:${reportId}`

  const latestDraft = reports.find((report) => report.status === "draft")
  if (latestDraft) return `report:${latestDraft.id}`

  if (aiDrafts[0]) return `ai:${aiDrafts[0].id}`

  const latestReport = reports[0]
  if (latestReport) return `report:${latestReport.id}`

  return "template:new"
}

function createRadiologyReportTemplate({
  accessionNumber,
  description,
  modality,
}: {
  accessionNumber: string
  description: string | null
  modality: string
}) {
  const studyName = description || `${modality} tetkiki`

  return {
    findings: [
      `Tetkik: ${studyName}`,
      `Accession: ${accessionNumber || "-"}`,
      "Teknik: DICOM görüntüleri klinik endikasyon doğrultusunda incelendi.",
      "Karşılaştırma: Önceki tetkik mevcutsa karşılaştırıldı.",
      "",
      "Bulgular:",
      "- İnceleme alanına giren anatomik yapılar sistematik olarak değerlendirildi.",
      "- Patolojik bulgu, ölçüm ve lokalizasyon bilgileri bu alana yazılacaktır.",
    ].join("\n"),
    impression: [
      "Sonuç:",
      "1. Klinik ve görüntüleme bulguları birlikte değerlendirilerek nihai izlenim yazılacaktır.",
      "2. Gerekirse takip/ek inceleme önerisi bu alana eklenecektir.",
    ].join("\n"),
  }
}

function ViewerError({ message }: { message: string }) {
  return (
    <section className="data-panel viewer-error-panel">
      <div className="panel-heading">
        <h1>Viewer açılamadı</h1>
      </div>
      <div className="empty-state-with-copy">
        <p className="empty-state">{message}</p>
        <CopyErrorButton text={message} />
      </div>
      <div className="form-actions">
        <Link className="button primary" href="/worklist">
          Worklist&apos;e dön
        </Link>
      </div>
    </section>
  )
}
