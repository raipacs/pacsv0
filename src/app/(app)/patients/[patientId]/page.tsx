import { notFound } from "next/navigation"

import { DicomInstanceActions } from "@/components/dicom-instance-actions"
import { MaskedPatientId, MaskedPatientName } from "@/components/privacy-mode"
import { requireUser } from "@/lib/auth"
import { getPatient, getPatientStudies } from "@/lib/data"

export const metadata = { title: "Hasta detayı" }

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ patientId: string }>
}) {
  const { patientId } = await params
  const user = await requireUser()
  const patient = await getPatient(user.organizationId, patientId)
  if (!patient) notFound()

  const studies = await getPatientStudies(user.organizationId, patient.id)
  const storageInstanceCount = studies.reduce(
    (total, study) => total + study.instances.length,
    0
  )

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">
            <MaskedPatientId value={patient.patientNumber} />
          </p>
          <h1>
            <MaskedPatientName value={`${patient.firstName} ${patient.lastName}`} />
          </h1>
          <p>Hasta bilgileri ve görüntüleme geçmişi.</p>
        </div>
        <button className="button primary" type="button">
          Bilgileri düzenle
        </button>
      </header>
      <section className="detail-grid">
        <article className="info-panel">
          <h2>Demografik bilgiler</h2>
          <dl>
            <div>
              <dt>Doğum tarihi</dt>
              <dd>{formatDate(patient.birthDate)}</dd>
            </div>
            <div>
              <dt>Cinsiyet</dt>
              <dd>{patient.sex}</dd>
            </div>
            <div>
              <dt>Telefon</dt>
              <dd>{patient.phone ?? "-"}</dd>
            </div>
            <div>
              <dt>E-posta</dt>
              <dd>{patient.email ?? "-"}</dd>
            </div>
          </dl>
        </article>
        <article className="info-panel">
          <h2>Tetkik özeti</h2>
          <p className="big-number">{patient.studyCount}</p>
          <p className="muted">Toplam kayıtlı tetkik</p>
        </article>
      </section>
      <section className="data-panel">
        <div className="panel-heading">
          <h2>Tetkikler</h2>
        </div>
        {studies.length ? (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Açıklama</th>
                  <th>Modalite</th>
                  <th>Tarih</th>
                  <th>DICOM</th>
                  <th>Durum</th>
                  <th>Görüntü</th>
                </tr>
              </thead>
              <tbody>
                {studies.map((study) => {
                  const firstInstance = study.instances[0]

                  return (
                    <tr key={study.id}>
                      <td>{study.description}</td>
                      <td>{study.modality}</td>
                      <td>{study.date}</td>
                      <td>
                        <strong>{study.instanceCount}</strong>
                        <span>instance</span>
                      </td>
                      <td>{study.status}</td>
                      <td>
                        {firstInstance ? (
                          <DicomInstanceActions
                            instanceId={firstInstance.id}
                            studyId={study.id}
                            instances={study.instances.map((instance) => ({
                              id: instance.id,
                              instanceNumber: instance.instanceNumber,
                              sopInstanceUid: instance.sopInstanceUid,
                            }))}
                            viewerLabel="Göster"
                            showSignedUrl={false}
                          />
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">Bu hasta için demo tetkik bulunmuyor.</p>
        )}
      </section>
      <details className="data-panel storage-panel collapsible-panel">
        <summary className="panel-heading">
          <div>
            <h2>Storage instance referansları</h2>
            <small>Teknik DICOM dosya referansları</small>
          </div>
          <span className="panel-toggle">
            {storageInstanceCount ? `${storageInstanceCount} kayıt` : "Kayıt yok"}
          </span>
        </summary>
        {storageInstanceCount > 0 ? (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Accession</th>
                  <th>SOP Instance UID</th>
                  <th>Boyut</th>
                  <th>Storage key</th>
                  <th>Erişim</th>
                </tr>
              </thead>
              <tbody>
                {studies.flatMap((study) =>
                  study.instances.map((instance) => (
                    <tr key={instance.id}>
                      <td>{study.accessionNumber}</td>
                      <td>{instance.sopInstanceUid}</td>
                      <td>{formatBytes(instance.sizeBytes)}</td>
                      <td>
                        <code>{instance.storageKey}</code>
                      </td>
                      <td>
                        <DicomInstanceActions instanceId={instance.id} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">
            Bu hasta için Storage kayıtlı DICOM instance henüz yok.
          </p>
        )}
      </details>
    </>
  )
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(value: string) {
  if (!value) return "-"

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"

  return new Intl.DateTimeFormat("tr-TR").format(date)
}
