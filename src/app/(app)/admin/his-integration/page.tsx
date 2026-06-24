import Link from "next/link"

import { createHisIntegration, testHisIntegration } from "@/app/actions/admin"
import { requireAdmin } from "@/lib/auth"
import { getBranchOptions } from "@/lib/branches"
import {
  authTypeLabel,
  directionLabel,
  getHisIntegrationEvents,
  getHisIntegrations,
  integrationStatusLabel,
  protocolLabel,
  type HisIntegrationEvent,
  type HisIntegrationStatus,
  type HisIntegrationSummary,
} from "@/lib/his-integrations"

export const dynamic = "force-dynamic"
export const metadata = { title: "HIS Entegrasyonu" }

const globalFlows = [
  {
    title: "Hasta demografisi",
    standard: "HL7 ADT / FHIR Patient",
    direction: "HIS -> PACS",
    detail: "Hasta kimliği, ad-soyad, doğum tarihi, cinsiyet ve kurum/şube eşleşmesi.",
  },
  {
    title: "Tetkik istemi",
    standard: "HL7 ORM / FHIR ServiceRequest",
    direction: "HIS -> PACS",
    detail: "Accession, modalite, istem tarihi, klinik bilgi ve öncelik bilgisi.",
  },
  {
    title: "Görüntüleme durumu",
    standard: "HL7 ORU / REST callback",
    direction: "PACS -> HIS",
    detail: "DICOM alındı, görüntülenebilir, raporlanıyor, tamamlandı gibi durumlar.",
  },
  {
    title: "Rapor ve sonuç",
    standard: "HL7 ORU / FHIR DiagnosticReport",
    direction: "PACS -> HIS",
    detail: "Radyoloji raporu, sonuç metni, imza zamanı ve rapor bağlantısı.",
  },
]

const messageTypePresets = [
  "ADT^A04",
  "ADT^A08",
  "ORM^O01",
  "ORU^R01",
  "Patient",
  "ServiceRequest",
  "DiagnosticReport",
]

export default async function HisIntegrationPage() {
  const user = await requireAdmin()
  const [branches, integrations, events] = await Promise.all([
    getBranchOptions(user.organizationId),
    getHisIntegrations(user.organizationId),
    getHisIntegrationEvents(user.organizationId),
  ])

  const activeCount = integrations.filter((item) => item.status === "active").length
  const errorCount = integrations.filter((item) => item.status === "error").length

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">HIS entegrasyonu</p>
          <h1>HIS bağlantıları</h1>
          <p>Hastane bilgi sistemi ile hasta, istem, durum ve rapor akışlarını yönetin.</p>
        </div>
        <div className="page-actions">
          <Link className="button subtle" href="/admin/users">
            Admin
          </Link>
          <Link className="button subtle" href="/admin/branches">
            Şubeler
          </Link>
          <Link className="button subtle" href="/admin/dicom-server">
            DICOM Server
          </Link>
          <Link className="button subtle" href="/admin/ai-services">
            AI Servisleri
          </Link>
        </div>
      </header>

      <section className="metric-row">
        <article>
          <span>Tanım</span>
          <strong>{integrations.length}</strong>
        </article>
        <article>
          <span>Aktif</span>
          <strong>{activeCount}</strong>
        </article>
        <article>
          <span>Hata</span>
          <strong>{errorCount}</strong>
        </article>
        <article>
          <span>Kapsam</span>
          <strong>Global</strong>
        </article>
      </section>

      <section className="his-admin-grid">
        <section className="data-panel">
          <div className="panel-heading">
            <h2>Yeni HIS tanımı</h2>
          </div>
          <form action={createHisIntegration} className="admin-form">
            <label>
              <span>Bağlantı adı</span>
              <input name="name" placeholder="Merkez HIS HL7" required />
            </label>
            <label>
              <span>Üretici / sistem</span>
              <input name="vendor" placeholder="Generic HIS, SAP, Medula..." />
            </label>
            <label>
              <span>Şube</span>
              <select name="branchId" defaultValue={branches[0]?.id ?? ""}>
                <option value="">Tüm şubeler</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid two">
              <label>
                <span>Protokol</span>
                <select name="protocol" defaultValue="hl7_v2_mllp">
                  <option value="hl7_v2_mllp">HL7 v2 / MLLP</option>
                  <option value="fhir_r4">FHIR R4</option>
                  <option value="rest_api">REST API</option>
                  <option value="webhook">Webhook</option>
                  <option value="file_drop">Dosya aktarımı</option>
                </select>
              </label>
              <label>
                <span>Yön</span>
                <select name="direction" defaultValue="bidirectional">
                  <option value="bidirectional">Çift yönlü</option>
                  <option value="inbound">HIS -&gt; PACS</option>
                  <option value="outbound">PACS -&gt; HIS</option>
                </select>
              </label>
            </div>
            <div className="form-grid two">
              <label>
                <span>Kimlik doğrulama</span>
                <select name="authType" defaultValue="vpn">
                  <option value="vpn">VPN / IP izinli</option>
                  <option value="basic">Basic Auth</option>
                  <option value="bearer">Bearer token</option>
                  <option value="oauth2_client_credentials">OAuth2 client credentials</option>
                  <option value="mutual_tls">Mutual TLS</option>
                  <option value="none">Yok</option>
                </select>
              </label>
              <label>
                <span>Port</span>
                <input inputMode="numeric" name="port" placeholder="2575" />
              </label>
            </div>
            <label>
              <span>Endpoint URL</span>
              <input name="endpointUrl" placeholder="https://his.example.com/fhir" />
            </label>
            <label>
              <span>Host / IP</span>
              <input name="host" placeholder="10.10.10.20 veya his.hospital.local" />
            </label>
            <div className="form-grid two">
              <label>
                <span>Sending application</span>
                <input name="sendingApplication" placeholder="HIS" />
              </label>
              <label>
                <span>Receiving application</span>
                <input name="receivingApplication" placeholder="RAIPACS" />
              </label>
            </div>
            <div className="form-grid two">
              <label>
                <span>Sending facility</span>
                <input name="sendingFacility" placeholder="MERKEZ" />
              </label>
              <label>
                <span>Receiving facility</span>
                <input name="receivingFacility" placeholder="RAI" />
              </label>
            </div>
            <label>
              <span>Mesaj / kaynak tipleri</span>
              <input
                name="enabledMessageTypes"
                placeholder={messageTypePresets.join(", ")}
              />
            </label>
            <div className="form-grid two">
              <label>
                <span>Hasta ID stratejisi</span>
                <select name="patientIdStrategy" defaultValue="patient_number">
                  <option value="patient_number">Patient ID / hasta no</option>
                  <option value="national_id">T.C./ulusal kimlik</option>
                  <option value="his_master_patient_id">HIS master patient ID</option>
                </select>
              </label>
              <label>
                <span>Accession stratejisi</span>
                <select name="accessionStrategy" defaultValue="his_accession">
                  <option value="his_accession">HIS accession</option>
                  <option value="generated">RAI üretir</option>
                  <option value="order_number">Order number</option>
                </select>
              </label>
            </div>
            <label>
              <span>Not</span>
              <textarea name="notes" placeholder="VPN, IP whitelist, test hasta kapsamı..." />
            </label>
            <button className="button primary" type="submit">
              Tanımı kaydet
            </button>
          </form>
        </section>

        <section className="data-panel">
          <div className="panel-heading">
            <h2>Global akış modeli</h2>
          </div>
          <div className="integration-flow-list">
            {globalFlows.map((flow) => (
              <article className="integration-flow" key={flow.title}>
                <div>
                  <strong>{flow.title}</strong>
                  <span>{flow.standard}</span>
                </div>
                <span className="health-badge unknown">{flow.direction}</span>
                <p>{flow.detail}</p>
              </article>
            ))}
          </div>
        </section>
      </section>

      <section className="data-panel admin-section">
        <div className="panel-heading">
          <h2>Tanımlı HIS bağlantıları</h2>
        </div>
        {integrations.length ? (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Bağlantı</th>
                  <th>Protokol</th>
                  <th>Yön</th>
                  <th>Güvenlik</th>
                  <th>Endpoint</th>
                  <th>Son test</th>
                  <th>Durum</th>
                  <th>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {integrations.map((integration) => (
                  <IntegrationRow integration={integration} key={integration.id} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">
            Henüz HIS entegrasyon tanımı yok. İlk bağlantıyı oluşturduğunuzda burada
            izlenir.
          </p>
        )}
      </section>

      <section className="data-panel admin-section">
        <div className="panel-heading">
          <h2>Son HIS olayları</h2>
        </div>
        {events.length ? (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Olay</th>
                  <th>Akış</th>
                  <th>Hasta / Accession</th>
                  <th>Zaman</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <HisEventRow event={event} key={event.id} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">Henüz HIS olay kaydı yok.</p>
        )}
      </section>
    </>
  )
}

function IntegrationRow({ integration }: { integration: HisIntegrationSummary }) {
  return (
    <tr>
      <td>
        <strong>{integration.name}</strong>
        <span>{[integration.vendor, integration.branchName].filter(Boolean).join(" / ")}</span>
      </td>
      <td>
        <strong>{protocolLabel(integration.protocol)}</strong>
        <span>{integration.messageTypes.join(", ") || "Tip seçilmedi"}</span>
      </td>
      <td>{directionLabel(integration.direction)}</td>
      <td>{authTypeLabel(integration.authType)}</td>
      <td>{integration.endpoint}</td>
      <td>
        <strong>{formatDateTime(integration.lastCheckedAt)}</strong>
        <span>
          {integration.lastSuccessAt
            ? `Başarılı: ${formatDateTime(integration.lastSuccessAt)}`
            : integration.lastErrorAt
              ? `Hata: ${formatDateTime(integration.lastErrorAt)}`
              : "Henüz test yok"}
        </span>
      </td>
      <td>
        <span className={`health-badge ${statusClass(integration.status)}`}>
          {integrationStatusLabel(integration.status)}
        </span>
        {integration.lastErrorMessage ? (
          <span className="table-note">{integration.lastErrorMessage}</span>
        ) : null}
      </td>
      <td>
        <form action={testHisIntegration} className="inline-action-form">
          <input name="integrationId" type="hidden" value={integration.id} />
          <button className="button subtle small" type="submit">
            Test et
          </button>
        </form>
      </td>
    </tr>
  )
}

function HisEventRow({ event }: { event: HisIntegrationEvent }) {
  return (
    <tr>
      <td>
        <strong>{event.eventType}</strong>
        <span>{event.integrationName || "Genel HIS"}</span>
      </td>
      <td>
        <strong>{directionLabel(event.direction)}</strong>
        <span>{event.messageType || "-"}</span>
      </td>
      <td>
        <strong>{event.patientNumber || "-"}</strong>
        <span>{event.accessionNumber || "-"}</span>
      </td>
      <td>{formatDateTime(event.occurredAt)}</td>
      <td>
        <span className={`health-badge ${eventStatusClass(event.status)}`}>
          {eventStatusLabel(event.status)}
        </span>
        <span className="table-note neutral">{event.message}</span>
      </td>
    </tr>
  )
}

function statusClass(status: HisIntegrationStatus) {
  if (status === "active") return "ok"
  if (status === "error") return "error"
  if (status === "paused") return "warning"
  return "unknown"
}

function eventStatusLabel(status: string) {
  if (status === "success") return "Başarılı"
  if (status === "failed") return "Hata"
  if (status === "warning") return "Uyarı"
  return "Gözlendi"
}

function eventStatusClass(status: string) {
  if (status === "success" || status === "observed") return "ok"
  if (status === "warning") return "warning"
  if (status === "failed") return "error"
  return "unknown"
}

function formatDateTime(value: string | null) {
  if (!value) return "-"
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value))
}
