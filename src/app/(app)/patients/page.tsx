import Link from "next/link"

import { requireUser } from "@/lib/auth"
import { getPatients } from "@/lib/data"

export const metadata = { title: "Hastalar" }

export default async function PatientsPage() {
  const user = await requireUser()
  const patients = await getPatients(user.organizationId)

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Hasta yönetimi</p>
          <h1>Hastalar</h1>
          <p>Demografik bilgiler ve tetkik geçmişine kontrollü erişim.</p>
        </div>
        <button className="button primary" type="button">
          Yeni hasta
        </button>
      </header>
      <section className="data-panel">
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Hasta</th>
                <th>Doğum tarihi</th>
                <th>Cinsiyet</th>
                <th>İletişim</th>
                <th>Tetkik</th>
                <th>Son tetkik</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((patient) => (
                <tr key={patient.id}>
                  <td>
                    <Link href={`/patients/${patient.id}`}>
                      <strong>
                        {patient.firstName} {patient.lastName}
                      </strong>
                    </Link>
                    <span>{patient.patientNumber}</span>
                  </td>
                  <td>{formatDate(patient.birthDate)}</td>
                  <td>{patient.sex}</td>
                  <td>
                    <strong>{patient.phone ?? "-"}</strong>
                    <span>{patient.email ?? "E-posta yok"}</span>
                  </td>
                  <td>{patient.studyCount}</td>
                  <td>
                    {patient.lastStudyAt
                      ? new Intl.DateTimeFormat("tr-TR", {
                          dateStyle: "medium",
                        }).format(new Date(patient.lastStudyAt))
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR").format(new Date(value))
}
