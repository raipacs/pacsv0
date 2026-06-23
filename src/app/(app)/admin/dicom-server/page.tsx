import Link from "next/link"

import { BranchFilter } from "@/components/branch-filter"
import { requireAdmin } from "@/lib/auth"
import { resolveSelectedBranch } from "@/lib/branches"
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
  ).length
  const failedJobs = dashboard.importJobs.filter(
    (job) => job.status === "failed" || job.failedInstances > 0
  )
  const totalInstances = dashboard.modalities.reduce(
    (sum, modality) => sum + modality.instances,
    0
  )

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
          <strong>{activeJobs}</strong>
        </article>
      </section>

      <section className="data-panel admin-section">
        <div className="panel-heading">
          <h2>Operasyon özeti</h2>
        </div>
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
      </section>

      <section className="dicom-admin-grid">
        <article className="info-panel">
          <h2>Bağlantı bilgileri</h2>
          <dl>
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
        </article>

        <section className="data-panel">
          <div className="panel-heading">
            <h2>Servisler</h2>
          </div>
          <div className="health-list">
            {dashboard.services.map((item) => (
              <HealthRow item={item} key={item.name} />
            ))}
          </div>
        </section>
      </section>

      <section className="data-panel admin-section">
        <div className="panel-heading">
          <h2>API durumu</h2>
        </div>
        <div className="health-list">
          {dashboard.apis.map((item) => (
            <HealthRow item={item} key={item.name} />
          ))}
        </div>
      </section>

      <section className="data-panel admin-section">
        <div className="panel-heading">
          <h2>Google Cloud altyapısı</h2>
        </div>
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
      </section>

      <section className="data-panel admin-section">
        <div className="panel-heading">
          <h2>Modalite bağlantıları</h2>
        </div>
        {dashboard.modalities.length ? (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>AE Title</th>
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
                      <span className="modality">{modality.modality}</span>
                    </td>
                    <td>{formatDateTime(modality.lastReceivedAt)}</td>
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
      </section>

      <section className="data-panel admin-section">
        <div className="panel-heading">
          <h2>Cihaz aktivitesi</h2>
        </div>
        {dashboard.modalities.length ? (
          <div className="modality-activity-list">
            {dashboard.modalities.map((modality) => (
              <ModalityActivity item={modality} key={modality.key} />
            ))}
          </div>
        ) : (
          <p className="empty-state">Henüz cihaz aktivitesi yok.</p>
        )}
      </section>

      <section className="data-panel admin-section">
        <div className="panel-heading">
          <h2>Son bağlantı/log olayları</h2>
        </div>
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
      </section>

      <section className="data-panel admin-section">
        <div className="panel-heading">
          <h2>Son gelen tetkikler</h2>
        </div>
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
      </section>

      <section className="data-panel admin-section">
        <div className="panel-heading">
          <h2>Başarısız importlar</h2>
        </div>
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
      </section>

      <section className="data-panel admin-section">
        <div className="panel-heading">
          <h2>Import kuyruğu</h2>
        </div>
        {dashboard.importJobs.length ? (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Kaynak</th>
                  <th>Hasta / Accession</th>
                  <th>Instance</th>
                  <th>Son hareket</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.importJobs.map((job) => (
                  <ImportJobRow job={job} key={job.id} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">
            Import job kaydı yok. Migration uygulandıktan sonra Orthanc ve upload
            importları burada izlenir.
          </p>
        )}
      </section>
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
        <span className="table-note">{job.errorMessage || "Import hata aldı"}</span>
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

function ImportJobRow({ job }: { job: ImportJobSummary }) {
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
      <td>{formatDateTime(job.lastSeenAt)}</td>
      <td>
        <span className={`health-badge ${jobStatusClass(job.status)}`}>
          {jobStatusLabel(job.status)}
        </span>
        {job.errorMessage ? <span className="table-note">{job.errorMessage}</span> : null}
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
