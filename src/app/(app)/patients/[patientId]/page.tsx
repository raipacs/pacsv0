import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth"
import { getPatient, getWorklist } from "@/lib/data"

export const metadata = { title: "Hasta detayi" }

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ patientId: string }>
}) {
  const { patientId } = await params
  const user = await requireUser()
  const patient = await getPatient(user.organizationId, patientId)
  if (!patient) notFound()

  const studies = (await getWorklist(user.organizationId)).filter(
    (study) => study.patientNumber === patient.patientNumber
  )

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">{patient.patientNumber}</p>
          <h1>
            {patient.firstName} {patient.lastName}
          </h1>
          <p>Hasta bilgileri ve goruntuleme gecmisi.</p>
        </div>
        <button className="button primary" type="button">
          Bilgileri duzenle
        </button>
      </header>
      <section className="detail-grid">
        <article className="info-panel">
          <h2>Demografik bilgiler</h2>
          <dl>
            <div>
              <dt>Dogum tarihi</dt>
              <dd>{new Intl.DateTimeFormat("tr-TR").format(new Date(patient.birthDate))}</dd>
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
          <h2>Tetkik ozeti</h2>
          <p className="big-number">{patient.studyCount}</p>
          <p className="muted">Toplam kayitli tetkik</p>
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
                  <th>Aciklama</th>
                  <th>Modalite</th>
                  <th>Tarih</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {studies.map((study) => (
                  <tr key={study.id}>
                    <td>{study.description}</td>
                    <td>{study.modality}</td>
                    <td>{study.date}</td>
                    <td>{study.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">Bu hasta icin demo tetkik bulunmuyor.</p>
        )}
      </section>
    </>
  )
}
