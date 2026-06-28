import Link from "next/link"
import type { ReactNode } from "react"

import { upsertDicomModality } from "@/app/actions/admin"
import { BranchFilter } from "@/components/branch-filter"
import { CopyErrorButton } from "@/components/copy-error-button"
import { requireAdmin } from "@/lib/auth"
import { resolveSelectedBranch, type BranchOption } from "@/lib/branches"
import {
  formatDateTime,
  getDicomServerDashboard,
  type CloudInfrastructureItem,
  type DicomConnectionEvent,
  type DicomConnectionEventType,
  type HealthItem,
  type HealthState,
  type ImportJobStatus,
  type ImportJobSummary,
  type ModalityConnection,
  type RecentDicomStudy,
} from "@/lib/dicom-server-status"

export const dynamic = "force-dynamic"
export const metadata = { title: "DICOM Server" }

type DicomServerAdminPageProps = {
  searchParams?: Promise<{ branch?: string }>
}

export default async function DicomServerAdminPage({
  searchParams,
}: DicomServerAdminPageProps) {
  const user = await requireAdmin()
  const params = (await searchParams) ?? {}
  const { branches, selectedBranch } = await resolveSelectedBranch(
    user.organizationId,
    params.branch
  )
  const currentReturnTo = params.branch
    ? `/admin/dicom-server?branch=${encodeURIComponent(params.branch)}`
    : "/admin/dicom-server"
  const branchNameById = new Map(branches.map((branch) => [branch.id, branch.name]))
  const dashboard = await getDicomServerDashboard(
    user.organizationId,
    selectedBranch?.id
  )
  const healthyServices = [...dashboard.services, ...dashboard.apis].filter(
    (item) => item.state === "ok"
  ).length
  const totalChecks = dashboard.services.length + dashboard.apis.length
  const activeJobs = dashboard.importJobs.filter((job) =>
    ["received", "importing", "retrying"].includes(job.status)
  )
  const failedJobs = dashboard.importJobs.filter(
    (job) => job.status === "failed" || job.failedInstances > 0
  )
  const completedJobs = dashboard.importJobs.filter((job) => job.status === "completed")
  const totalInstances = dashboard.modalities.reduce(
    (sum, modality) => sum + modality.instances,
    0
  )
  const silentModalities = dashboard.modalities.filter(
    (item) => item.status === "Sessiz"
  ).length
  const operationWarningCount = failedJobs.length + silentModalities
  const servicesWarningCount = countHealthWarnings(dashboard.services)
  const apiWarningCount = countHealthWarnings(dashboard.apis)
  const cloudWarningCount = countHealthWarnings(dashboard.cloudInfrastructure)
  const modalityWarningCount = dashboard.modalities.filter(
    (item) => statusClass(item.status) !== "ok"
  ).length
  const connectionEventWarningCount = dashboard.connectionEvents.filter(
    (event) => eventStatusClass(event.status) !== "ok"
  ).length
  const importQueueWarningCount = dashboard.importJobs.filter(
    (job) => jobStatusClass(job.status) !== "ok"
  ).length
  const activeQueueWarningCount = activeJobs.filter(
    (job) => jobStatusClass(job.status) !== "ok"
  ).length

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">DICOM Gateway</p>
          <h1>DICOM Server</h1>
          <p>Gateway, Orthanc, Storage ve modalite bağlantılarını izleyin.</p>
        </div>
        <div className="page-actions">
          <Link className="button subtle" href="/admin/users">
            Admin
          </Link>
          <Link className="button subtle" href="/admin/his-integration">
            HIS Entegrasyonu
          </Link>
          <Link className="button subtle" href="/admin/ai-services">
            AI Servisleri
          </Link>
          <Link className="button primary" href="/worklist/upload">
            DICOM yükle
          </Link>
        </div>
      </header>

      <BranchFilter
        basePath="/admin/dicom-server"
        branches={branches}
        selectedBranch={selectedBranch}
      />

      <section className="metric-row">
        <article>
          <span>Endpoint</span>
          <strong>{dashboard.endpoint.aeTitle}</strong>
        </article>
        <article>
          <span>Servis sağlığı</span>
          <strong>
            {healthyServices}/{totalChecks}
          </strong>
        </article>
        <article>
          <span>Modalite</span>
          <strong>{dashboard.modalities.length}</strong>
        </article>
        <article>
          <span>Aktif import</span>
          <strong>{activeJobs.length}</strong>
        </article>
      </section>

      <CollapsiblePanel
        detail={
          operationWarningCount
            ? `${operationWarningCount} operasyon uyarısı var`
            : "Operasyon göstergeleri normal"
        }
        open={operationWarningCount > 0}
        title="Operasyon özeti"
        warningCount={operationWarningCount}
      >
        <div className="operation-summary-grid">
          <SummaryTile
            label="Son tetkik"
            value={formatDateTime(dashboard.recentStudies[0]?.receivedAt ?? null)}
            detail={dashboard.recentStudies[0]?.description ?? "Henüz tetkik yok"}
          />
          <SummaryTile
            label="Toplam instance"
            value={String(totalInstances)}
            detail="Modalite registry üzerinden"
          />
          <SummaryTile
            label="Başarısız import"
            value={String(failedJobs.length)}
            detail={failedJobs[0]?.errorMessage ?? "Açık hata yok"}
            tone={failedJobs.length ? "error" : "ok"}
          />
          <SummaryTile
            label="Tamamlanan import"
            value={String(completedJobs.length)}
            detail="Geçmiş import kuyruğunda"
            tone="ok"
          />
          <SummaryTile
            label="Sessiz modalite"
            value={String(dashboard.modalities.filter((item) => item.status === "Sessiz").length)}
            detail="72 saatten uzun süredir sinyal yok"
            tone={
              dashboard.modalities.some((item) => item.status === "Sessiz")
                ? "warning"
                : "ok"
            }
          />
        </div>
      </CollapsiblePanel>

      <section className="dicom-admin-grid">
        <CollapsiblePanel
          detail="Cihazlara girilecek DICOM endpoint bilgileri"
          title="Bağlantı bilgileri"
        >
          <dl className="connection-info-list">
            <div>
              <dt>Host</dt>
              <dd>{dashboard.endpoint.host}</dd>
            </div>
            <div>
              <dt>Port</dt>
              <dd>{dashboard.endpoint.port}</dd>
            </div>
            <div>
              <dt>Called AE Title</dt>
              <dd>{dashboard.endpoint.aeTitle}</dd>
            </div>
            <div>
              <dt>Protokol</dt>
              <dd>{dashboard.endpoint.protocol}</dd>
            </div>
            <div>
              <dt>TLS</dt>
              <dd>{dashboard.endpoint.tls}</dd>
            </div>
          </dl>
        </CollapsiblePanel>

        <CollapsiblePanel
          detail={
            servicesWarningCount
              ? `${servicesWarningCount} uyarı / müdahale gerektiriyor`
              : "Tüm servis kontrolleri normal"
          }
          open={servicesWarningCount > 0}
          title="Servisler"
          warningCount={servicesWarningCount}
        >
          <div className="health-list">
            {dashboard.services.map((item) => (
              <HealthRow item={item} key={item.name} />
            ))}
          </div>
        </CollapsiblePanel>
      </section>

      <CollapsiblePanel
        detail={
          apiWarningCount
            ? `${apiWarningCount} uyarı / müdahale gerektiriyor`
            : "Tüm API kontrolleri normal"
        }
        open={apiWarningCount > 0}
        title="API durumu"
        warningCount={apiWarningCount}
      >
        <div className="health-list">
          {dashboard.apis.map((item) => (
            <HealthRow item={item} key={item.name} />
          ))}
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel
        detail={
          cloudWarningCount
            ? `${cloudWarningCount} uyarı / müdahale gerektiriyor`
            : "Tüm Google Cloud kontrolleri normal"
        }
        open={cloudWarningCount > 0}
        title="Google Cloud altyapısı"
        warningCount={cloudWarningCount}
      >
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Obje</th>
                <th>Tip</th>
                <th>Detay</th>
                <th>Sinyal</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.cloudInfrastructure.map((item) => (
                <CloudInfrastructureRow item={item} key={`${item.kind}-${item.name}`} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="panel-note">
          Firewall ve VM satırları mevcut RAI konfigürasyonu ve dış erişim sinyaliyle
          izlenir. GCP Service Account bağlandığında gerçek firewall kuralı, VM
          state ve systemd timer durumu doğrudan okunabilir.
        </p>
      </CollapsiblePanel>

      <CollapsiblePanel
        detail={`${dashboard.modalities.length} modalite bağlantısı izleniyor`}
        open
        title="Modalite bağlantıları"
        warningCount={modalityWarningCount}
      >
        <section className="modality-definition-panel">
          <div className="panel-heading compact">
            <div>
              <h3>Yeni modalite tanımı</h3>
              <small>AE Title, IP ve hedef AE bilgisini şubeye bağlayın.</small>
            </div>
          </div>
          <ModalityDefinitionForm
            branches={branches}
            returnTo={currentReturnTo}
            selectedBranchId={selectedBranch?.id ?? null}
          />
        </section>
        {dashboard.modalities.length ? (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>AE Title</th>
                  <th>Şube</th>
                  <th>Kaynak IP</th>
                  <th>Called AE</th>
                  <th>Modalite</th>
                  <th>Son tetkik</th>
                  <th>Study</th>
                  <th>Instance</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.modalities.map((modality) => (
                  <tr key={modality.key}>
                    <td>
                      <strong>{modality.aeTitle}</strong>
                      <span>{modality.lastDescription}</span>
                    </td>
                    <td>
                      <strong>
                        {modality.branchId
                          ? branchNameById.get(modality.branchId) ?? "Şube yok"
                          : "Şube yok"}
                      </strong>
                      <span>{modality.location || "Konum yok"}</span>
                    </td>
                    <td>{modality.sourceIp || "-"}</td>
                    <td>{modality.calledAeTitle || dashboard.endpoint.aeTitle}</td>
                    <td>
                      <span className="modality">{modality.modality}</span>
                    </td>
                    <td>
                      {formatDateTime(modality.lastReceivedAt)}
                    </td>
                    <td>{modality.studies}</td>
                    <td>{modality.instances}</td>
                    <td>
                      <span className={`health-badge ${statusClass(modality.status)}`}>
                        {modality.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">
            Henüz DICOM alan bir modalite görünmüyor. İlk C-STORE başarılı
            olduğunda bu liste otomatik dolacak.
          </p>
        )}
        {dashboard.modalities.length ? (
          <div className="modality-definition-list">
            <h3>Mevcut modalite tanımlarını düzenle</h3>
            {dashboard.modalities.map((modality) => (
              <ModalityDefinitionForm
                branches={branches}
                key={`edit-${modality.key}`}
                modality={modality}
                returnTo={currentReturnTo}
                selectedBranchId={selectedBranch?.id ?? null}
              />
            ))}
          </div>
        ) : null}
      </CollapsiblePanel>

      <CollapsiblePanel
        detail={`${dashboard.modalities.length} cihaz aktivitesi`}
        open={modalityWarningCount > 0}
        title="Cihaz aktivitesi"
        warningCount={modalityWarningCount}
      >
        {dashboard.modalities.length ? (
          <div className="modality-activity-list">
            {dashboard.modalities.map((modality) => (
              <ModalityActivity item={modality} key={modality.key} />
            ))}
          </div>
        ) : (
          <p className="empty-state">Henüz cihaz aktivitesi yok.</p>
        )}
      </CollapsiblePanel>

      <CollapsiblePanel
        detail={`${dashboard.connectionEvents.length} bağlantı/log olayı`}
        open={connectionEventWarningCount > 0}
        title="Son bağlantı/log olayları"
        warningCount={connectionEventWarningCount}
      >
        {dashboard.connectionEvents.length ? (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Olay</th>
                  <th>Kaynak</th>
                  <th>Hedef</th>
                  <th>Tetkik</th>
                  <th>Zaman</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.connectionEvents.map((event) => (
                  <ConnectionEventRow event={event} key={event.id} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">
            Henüz bağlantı/log olayı yok. Yeni DICOM gateway denemeleri, import
            başlangıcı ve hata kayıtları burada görünecek.
          </p>
        )}
        <p className="panel-note">
          C-ECHO/Verify ve C-STORE olayları ayrı izlenir. Gateway log forwarder
          bağlandığında kaynak IP ve cihaz AE Title bilgisi test anında bu alana düşer.
        </p>
      </CollapsiblePanel>

      <CollapsiblePanel
        detail={`${dashboard.recentStudies.length} son tetkik`}
        title="Son gelen tetkikler"
      >
        {dashboard.recentStudies.length ? (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Hasta</th>
                  <th>Tetkik</th>
                  <th>Kaynak AE</th>
                  <th>Instance</th>
                  <th>Geliş</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.recentStudies.map((study) => (
                  <RecentStudyRow study={study} key={study.id} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">Son gelen tetkik görünmüyor.</p>
        )}
      </CollapsiblePanel>

      <CollapsiblePanel
        detail={
          failedJobs.length
            ? `${failedJobs.length} başarısız import var`
            : "Açık başarısız import kaydı yok"
        }
        open={failedJobs.length > 0}
        title="Başarısız importlar"
        warningCount={failedJobs.length}
      >
        {failedJobs.length ? (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Kaynak</th>
                  <th>Hasta / Accession</th>
                  <th>Instance</th>
                  <th>Son hareket</th>
                  <th>Hata</th>
                </tr>
              </thead>
              <tbody>
                {failedJobs.map((job) => (
                  <FailedJobRow job={job} key={job.id} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">Açık başarısız import kaydı yok.</p>
        )}
      </CollapsiblePanel>

      <CollapsiblePanel
        detail={
          activeJobs.length
            ? `${activeJobs.length} aktif/bekleyen import`
            : "Anlık bekleyen import yok"
        }
        open
        title="Anlık import kuyruğu"
        warningCount={activeQueueWarningCount}
      >
        {activeJobs.length ? (
          <ImportJobsTable jobs={activeJobs} mode="active" />
        ) : (
          <p className="empty-state">
            Anlık bekleyen veya çalışan import yok. Yeni C-STORE/import işlemi
            başladığında bu bölüm canlı kuyruk olarak dolacak.
          </p>
        )}
      </CollapsiblePanel>

      <CollapsiblePanel
        detail={`${dashboard.importJobs.length} geçmiş import job kaydı`}
        open
        title="Import kuyruğu geçmişi"
        warningCount={importQueueWarningCount}
      >
        {dashboard.importJobs.length ? (
          <ImportJobsTable jobs={dashboard.importJobs} mode="history" />
        ) : (
          <p className="empty-state">
            Import job kaydı yok. Migration uygulandıktan sonra Orthanc ve upload
            importları burada izlenir.
          </p>
        )}
      </CollapsiblePanel>
    </>
  )
}

function SummaryTile({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string
  value: string
  detail: string
  tone?: "neutral" | "ok" | "warning" | "error"
}) {
  return (
    <article className={`operation-summary-tile ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}

function ModalityDefinitionForm({
  branches,
  modality,
  returnTo,
  selectedBranchId,
}: {
  branches: BranchOption[]
  modality?: ModalityConnection
  returnTo: string
  selectedBranchId: string | null
}) {
  const defaultBranchId =
    modality?.branchId ??
    selectedBranchId ??
    branches.find((branch) => branch.slug === "dev")?.id ??
    branches[0]?.id ??
    ""
  const registryId = modality && isUuid(modality.key) ? modality.key : null

  return (
    <form action={upsertDicomModality} className="admin-form compact-modality-form">
      {registryId ? (
        <input name="modalityId" type="hidden" value={registryId} />
      ) : null}
      <input name="returnTo" type="hidden" value={returnTo} />
      <div className="form-grid two modality-form-grid">
        <label>
          AE Title
          <input
            name="aeTitle"
            defaultValue={modality?.aeTitle ?? ""}
            placeholder="US_KOSOVA_01"
            required
          />
        </label>
        <label>
          Şube
          <select name="branchId" defaultValue={defaultBranchId}>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Modalite
          <input name="modality" defaultValue={modality?.modality ?? "DICOM"} required />
        </label>
        <label>
          Called AE Title
          <input
            name="calledAeTitle"
            defaultValue={modality?.calledAeTitle ?? "RAIPACS"}
            placeholder="RAIPACS"
          />
        </label>
        <label>
          Kaynak IP
          <input
            name="ipAddress"
            defaultValue={modality?.sourceIp ?? ""}
            inputMode="numeric"
            placeholder="46.19.228.194"
          />
        </label>
        <label>
          Konum
          <input
            name="location"
            defaultValue={modality?.location ?? ""}
            placeholder="Kosova US odası"
          />
        </label>
        <label className="wide">
          Açıklama
          <input
            name="description"
            defaultValue={modality?.lastDescription ?? ""}
            placeholder="Ultrason cihazı / canlı bağlantı"
          />
        </label>
      </div>
      <button className="button primary" type="submit">
        {modality ? "Tanımı güncelle" : "Modalite tanımı ekle"}
      </button>
    </form>
  )
}

function CollapsiblePanel({
  children,
  detail,
  open = false,
  title,
  warningCount = 0,
}: {
  children: ReactNode
  detail: string
  open?: boolean
  title: string
  warningCount?: number
}) {
  return (
    <details
      className="data-panel admin-section collapsible-panel"
      open={open}
    >
      <summary className="panel-heading">
        <div>
          <h2>{title}</h2>
          <small>{detail}</small>
        </div>
        <span className={`panel-toggle ${warningCount ? "warning" : ""}`}>
          {formatWarningCount(warningCount)}
        </span>
      </summary>
      {children}
    </details>
  )
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  )
}

function countHealthWarnings(items: Array<{ state: HealthState }>) {
  return items.filter((item) => item.state !== "ok").length
}

function formatWarningCount(count: number) {
  return count ? `${count} uyarı` : "OK"
}

function ModalityActivity({ item }: { item: ModalityConnection }) {
  const percent = Math.min(100, Math.max(8, item.instances ? item.instances / 2 : 8))

  return (
    <article className="modality-activity">
      <div>
        <strong>{item.aeTitle}</strong>
        <span>
          {item.modality} / {item.studies} study / {item.instances} instance
        </span>
      </div>
      <div className="modality-activity-meter" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="health-row-status">
        <small>{formatDateTime(item.lastReceivedAt)}</small>
        <span className={`health-badge ${statusClass(item.status)}`}>{item.status}</span>
      </div>
    </article>
  )
}

function RecentStudyRow({ study }: { study: RecentDicomStudy }) {
  return (
    <tr>
      <td>
        <strong>{study.patientName}</strong>
        <span>{study.patientNumber}</span>
      </td>
      <td>
        <strong>{study.description}</strong>
        <span>
          {study.modality} / {study.accessionNumber}
        </span>
      </td>
      <td>{study.sourceAeTitle}</td>
      <td>{study.instanceCount}</td>
      <td>{formatDateTime(study.receivedAt)}</td>
      <td>
        <span className="health-badge unknown">{study.status}</span>
      </td>
    </tr>
  )
}

function ConnectionEventRow({ event }: { event: DicomConnectionEvent }) {
  return (
    <tr>
      <td>
        <strong>{connectionEventLabel(event.eventType)}</strong>
        <span>{event.message}</span>
      </td>
      <td>
        <strong>{event.sourceAeTitle || "AE bilinmiyor"}</strong>
        <span>{event.sourceIp || event.source}</span>
      </td>
      <td>
        <strong>{event.calledAeTitle || "RAIPACS"}</strong>
        <span>{event.modality || "DICOM"}</span>
      </td>
      <td>
        <strong>{event.patientDicomId || "-"}</strong>
        <span>{event.accessionNumber || shortStudyUid(event.studyInstanceUid)}</span>
      </td>
      <td>{formatDateTime(event.occurredAt)}</td>
      <td>
        <span className={`health-badge ${eventStatusClass(event.status)}`}>
          {eventStatusLabel(event.status)}
        </span>
      </td>
    </tr>
  )
}

function FailedJobRow({ job }: { job: ImportJobSummary }) {
  return (
    <tr>
      <td>
        <strong>{job.sourceAeTitle || job.source}</strong>
        <span>{job.modality || job.source}</span>
      </td>
      <td>
        <strong>{job.patientDicomId || "-"}</strong>
        <span>{job.accessionNumber || job.jobKey}</span>
      </td>
      <td>
        {job.importedInstances}/{job.expectedInstances || "-"}
      </td>
      <td>{formatDateTime(job.lastSeenAt)}</td>
      <td>
        <span className="inline-error-with-copy">
          <span className="table-note">{job.errorMessage || "Import hata aldı"}</span>
          <CopyErrorButton text={job.errorMessage || "Import hata aldı"} />
        </span>
      </td>
    </tr>
  )
}

function CloudInfrastructureRow({ item }: { item: CloudInfrastructureItem }) {
  return (
    <tr>
      <td>
        <strong>{item.name}</strong>
        {typeof item.latencyMs === "number" ? <span>{item.latencyMs} ms</span> : null}
      </td>
      <td>{item.kind}</td>
      <td>{item.detail}</td>
      <td>{item.signal}</td>
      <td>
        <span className={`health-badge ${healthClass(item.state)}`}>
          {healthLabel(item.state)}
        </span>
      </td>
    </tr>
  )
}

function ImportJobsTable({
  jobs,
  mode,
}: {
  jobs: ImportJobSummary[]
  mode: "active" | "history"
}) {
  return (
    <div className="responsive-table">
      <table>
        <thead>
          <tr>
            <th>Kaynak</th>
            <th>Hasta / Accession</th>
            <th>Instance</th>
            <th>Başlangıç</th>
            {mode === "history" ? <th>Bitiş</th> : null}
            <th>Son hareket</th>
            <th>Durum</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <ImportJobRow job={job} key={job.id} mode={mode} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ImportJobRow({
  job,
  mode,
}: {
  job: ImportJobSummary
  mode: "active" | "history"
}) {
  return (
    <tr>
      <td>
        <strong>{job.sourceAeTitle || job.source}</strong>
        <span>{job.modality || job.source}</span>
      </td>
      <td>
        <strong>{job.patientDicomId || "-"}</strong>
        <span>{job.accessionNumber || job.jobKey}</span>
      </td>
      <td>
        <strong>
          {job.importedInstances}/{job.expectedInstances || "-"}
        </strong>
        {job.failedInstances ? <span>{job.failedInstances} hata</span> : null}
      </td>
      <td>{formatDateTime(job.startedAt)}</td>
      {mode === "history" ? <td>{formatDateTime(job.completedAt)}</td> : null}
      <td>{formatDateTime(job.lastSeenAt)}</td>
      <td>
        <span className={`health-badge ${jobStatusClass(job.status)}`}>
          {jobStatusLabel(job.status)}
        </span>
        {job.errorMessage ? (
          <span className="inline-error-with-copy">
            <span className="table-note">{job.errorMessage}</span>
            <CopyErrorButton text={job.errorMessage} />
          </span>
        ) : null}
      </td>
    </tr>
  )
}

function HealthRow({ item }: { item: HealthItem }) {
  return (
    <article className="health-row">
      <div>
        <strong>{item.name}</strong>
        <span>{item.detail}</span>
      </div>
      <div className="health-row-status">
        {typeof item.latencyMs === "number" ? <small>{item.latencyMs} ms</small> : null}
        <span className={`health-badge ${healthClass(item.state)}`}>
          {healthLabel(item.state)}
        </span>
      </div>
    </article>
  )
}

function healthLabel(state: HealthState) {
  if (state === "ok") return "OK"
  if (state === "warning") return "Uyarı"
  if (state === "error") return "Hata"
  return "Bilinmiyor"
}

function healthClass(state: HealthState) {
  if (state === "ok") return "ok"
  if (state === "warning") return "warning"
  if (state === "error") return "error"
  return "unknown"
}

function statusClass(status: string) {
  if (status === "Yeni") return "ok"
  if (status === "Aktif") return "warning"
  return "unknown"
}

function connectionEventLabel(type: DicomConnectionEventType) {
  if (type === "association") return "Association"
  if (type === "echo") return "C-ECHO"
  if (type === "store") return "C-STORE"
  if (type === "stable_study") return "Stable Study"
  if (type === "import_started") return "Import başladı"
  if (type === "import_completed") return "Import tamamlandı"
  if (type === "import_failed") return "Import hata"
  return "Uyarı"
}

function eventStatusLabel(status: string) {
  if (status === "success") return "Başarılı"
  if (status === "failed") return "Hata"
  if (status === "warning") return "Uyarı"
  if (status === "received") return "Alındı"
  return "Gözlendi"
}

function eventStatusClass(status: string) {
  if (status === "success" || status === "received" || status === "observed") return "ok"
  if (status === "warning") return "warning"
  if (status === "failed") return "error"
  return "unknown"
}

function shortStudyUid(value: string | null) {
  if (!value) return "-"
  if (value.length <= 18) return value
  return `${value.slice(0, 8)}...${value.slice(-8)}`
}

function jobStatusLabel(status: ImportJobStatus) {
  if (status === "received") return "Alındı"
  if (status === "importing") return "İşleniyor"
  if (status === "completed") return "Tamamlandı"
  if (status === "failed") return "Hata"
  return "Tekrar"
}

function jobStatusClass(status: ImportJobStatus) {
  if (status === "completed") return "ok"
  if (status === "failed") return "error"
  if (status === "retrying") return "warning"
  return "unknown"
}
