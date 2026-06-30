"use client"

import type { ReactNode } from "react"
import { useMemo, useState } from "react"

import { finalizeReport, saveReportDraft } from "@/app/actions/reports"
import { aiJobStatusLabel } from "@/lib/ai-reporting"

export type ReportEditorReport = {
  finalizedAt: string | null
  findings: string
  id: string
  impression: string
  status: string
  updatedAt: string
  version: number
}

export type ReportEditorAiDraft = {
  confidenceScore: number | null
  createdAt: string
  findings: string
  id: string
  impression: string
  jobId: string
  jobStatus: string
  modelName: string | null
  providerName: string
}

export function ReportEditorPanel({
  aiDrafts,
  aiControl,
  fullPageHref,
  initialSourceId,
  isFullPage,
  isNewAiDraft,
  reports,
  returnTo,
  shareControl,
  studyId,
  template,
}: {
  aiDrafts: ReportEditorAiDraft[]
  aiControl?: ReactNode
  fullPageHref?: string
  initialSourceId: string
  isFullPage?: boolean
  isNewAiDraft: boolean
  reports: ReportEditorReport[]
  returnTo: string
  shareControl?: ReactNode
  studyId: string
  template: { findings: string; impression: string }
}) {
  const sources = useMemo(
    () => [
      ...reports.map((report) => ({
        createdAt: report.updatedAt,
        finalizedAt: report.finalizedAt,
        findings: report.findings,
        id: `report:${report.id}`,
        impression: report.impression,
        kind: "report" as const,
        reportId: report.id,
        sourceAiDraftId: "",
        status: report.status,
        subtitle:
          report.status === "final"
            ? `Onaylandı · ${formatDateTime(report.finalizedAt)}`
            : report.status === "amended"
              ? `Revize edildi · ${formatDateTime(report.updatedAt)}`
              : `Kaydedildi · ${formatDateTime(report.updatedAt)}`,
        title: `${report.status === "final" ? "Nihai rapor" : report.status === "amended" ? "Revize rapor" : "Taslak"} v${report.version}`,
      })),
      ...aiDrafts.map((draft, index) => ({
        createdAt: draft.createdAt,
        finalizedAt: null,
        findings: draft.findings,
        id: `ai:${draft.id}`,
        impression: draft.impression,
        kind: "ai" as const,
        reportId: "",
        sourceAiDraftId: draft.id,
        status: "ai-draft",
        subtitle: `${draft.providerName} · ${draft.modelName || "model seçilmedi"} · ${formatConfidence(
          draft.confidenceScore
        )}`,
        title: `${index === 0 && isNewAiDraft ? "Yeni AI taslağı" : "AI taslağı"} · ${aiJobStatusLabel(
          draft.jobStatus
        )}`,
      })),
      {
        createdAt: "",
        finalizedAt: null,
        findings: template.findings,
        id: "template:new",
        impression: template.impression,
        kind: "template" as const,
        reportId: "",
        sourceAiDraftId: "",
        status: "template",
        subtitle: "Radyoloji rapor şablonu",
        title: "Yeni manuel taslak",
      },
    ],
    [aiDrafts, isNewAiDraft, reports, template.findings, template.impression]
  )
  const firstDraft =
    sources.find((source) => source.status === "draft") ??
    sources.find((source) => source.kind === "ai") ??
    sources[0]
  const [selectedSourceId, setSelectedSourceId] = useState(
    sources.some((source) => source.id === initialSourceId)
      ? initialSourceId
      : firstDraft?.id ?? "template:new"
  )
  const selected = sources.find((source) => source.id === selectedSourceId) ?? sources[0]
  const [findings, setFindings] = useState(selected?.findings ?? template.findings)
  const [impression, setImpression] = useState(selected?.impression ?? template.impression)
  const selectedIsFinal = selected?.status === "final"

  function selectSource(sourceId: string) {
    const nextSource = sources.find((source) => source.id === sourceId)
    if (!nextSource) return

    setSelectedSourceId(sourceId)
    setFindings(nextSource.findings)
    setImpression(nextSource.impression)
  }

  return (
    <details
      className={`report-editor-strip${isFullPage ? " is-full-page" : ""}`}
      open={isFullPage || sources.length > 1 || Boolean(findings || impression)}
    >
      <summary>
        <div className="report-editor-summary-text">
          <span>Rapor</span>
          <strong>{selected?.title ?? "Manuel rapor"}</strong>
        </div>
        {selected ? (
          <small>
            <span className={`health-badge ${selectedBadgeClass(selected.status)}`}>
              {selectedStatusLabel(selected.status)}
            </span>
            {selected.subtitle}
          </small>
        ) : null}
        <div
          className="report-editor-summary-actions"
          onClick={(event) => event.stopPropagation()}
        >
          {fullPageHref ? (
            <a
              aria-label="Raporu yeni sayfada aç"
              className="button subtle report-icon-button"
              href={fullPageHref}
              rel="noreferrer"
              target="_blank"
              title="Raporu yeni sayfada aç"
            >
              ↗
            </a>
          ) : null}
          <button
            className="button subtle"
            onClick={() => window.print()}
            type="button"
          >
            PDF / Yazdır
          </button>
          {shareControl}
        </div>
        <span className="report-editor-summary-caret" aria-hidden="true">
          ↓
        </span>
      </summary>
      <div className="report-editor-toolbar">
        <div className="report-editor-ai-slot" aria-label="AI rapor işlemleri">
          {aiControl}
        </div>
      </div>
      <div className="report-editor-layout">
        <aside className="report-source-list" aria-label="Rapor taslakları">
          {sources.map((source) => (
            <button
              className={`report-source-card${source.id === selectedSourceId ? " active" : ""}`}
              key={source.id}
              onClick={() => selectSource(source.id)}
              type="button"
            >
              <strong>{source.title}</strong>
              <span>{source.subtitle}</span>
            </button>
          ))}
        </aside>
        <form className="report-editor-form">
          <input name="studyId" type="hidden" value={studyId} />
          <input name="reportId" type="hidden" value={selected?.reportId ?? ""} />
          <input name="sourceAiDraftId" type="hidden" value={selected?.sourceAiDraftId ?? ""} />
          <input name="returnTo" type="hidden" value={returnTo} />
          <label>
            <span>
              Bulgular
              <small>Klinik bulgular, ölçümler ve karşılaştırma notları</small>
            </span>
            <textarea
              name="findings"
              onChange={(event) => setFindings(event.target.value)}
              placeholder="Bulgular..."
              rows={5}
              required
              value={findings}
            />
          </label>
          <label>
            <span>
              İzlenim
              <small>Kısa sonuç, tanısal değerlendirme ve öneri</small>
            </span>
            <textarea
              name="impression"
              onChange={(event) => setImpression(event.target.value)}
              placeholder="İzlenim..."
              rows={3}
              required
              value={impression}
            />
          </label>
          <div className="report-editor-actions">
            <small>
              {selectedIsFinal
                ? "Final rapor üzerinde değişiklik yaparsanız yeni bir final/revizyon versiyonu oluşur."
                : "Seçili taslak düzenlenebilir; kaydetmek yeni taslak versiyonu oluşturur."}
            </small>
            <button className="button subtle" formAction={saveReportDraft} type="submit">
              Taslağı kaydet
            </button>
            <button className="button primary" formAction={finalizeReport} type="submit">
              Nihai rapor onayla
            </button>
          </div>
        </form>
      </div>
    </details>
  )
}

function selectedStatusLabel(status: string) {
  switch (status) {
    case "final":
      return "Final"
    case "amended":
      return "Revize"
    case "ai-draft":
      return "AI"
    case "template":
      return "Yeni"
    default:
      return "Taslak"
  }
}

function selectedBadgeClass(status: string) {
  if (status === "final") return "ok"
  if (status === "amended") return "warning"
  if (status === "ai-draft") return "ok"
  return "unknown"
}

function formatConfidence(value: number | null) {
  if (typeof value !== "number") return "-"
  return `%${Math.round(value * 100)}`
}

function formatDateTime(value: string | null) {
  if (!value) return "-"
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value))
}
