import Link from "next/link"

import { requireAdmin } from "@/lib/auth"
import {
  formatDateTime,
  getDicomServerDashboard,
  type HealthItem,
  type HealthState,
} from "@/lib/dicom-server-status"

export const dynamic = "force-dynamic"
export const metadata = { title: "DICOM Server" }

export default async function DicomServerAdminPage() {
  const user = await requireAdmin()
  const dashboard = await getDicomServerDashboard(user.organizationId)
  const healthyServices = [...dashboard.services, ...dashboard.apis].filter(
    (item) => item.state === "ok"
  ).length
  const totalChecks = dashboard.services.length + dashboard.apis.length

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
          <span>Son import</span>
          <strong className="metric-small">{formatDateTime(dashboard.lastImportAt)}</strong>
        </article>
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
    </>
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
