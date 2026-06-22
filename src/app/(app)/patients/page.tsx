import Link from "next/link"

import { DeletePatientButton } from "@/components/admin-delete-button"
import { MaskedPatientId, MaskedPatientName } from "@/components/privacy-mode"
import { canManagePatients, requireUser } from "@/lib/auth"
import { getPatients } from "@/lib/data"

export const metadata = { title: "Hastalar" }

export default async function PatientsPage() {
  const user = await requireUser()
  const patients = await getPatients(user.organizationId)
  const canCreatePatient = await canManagePatients(user, "insert")
  const canDeletePatients = user.role === "admin"

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Hasta yönetimi</p>
          <h1>Hastalar</h1>
          <p>Demografik bilgiler ve tetkik geçmişine kontrollü erişim.</p>
        </div>
        {canCreatePatient ? (
          <Link className="button primary" href="/patients/new">
            Yeni hasta
          </Link>
        ) : null}
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
                {canDeletePatients ? <th>Admin</th> : null}
              </tr>
            </thead>
            <tbody>
              {patients.map((patient) => (
                <tr key={patient.id}>
                  <td>
                    <Link href={`/patients/${patient.id}`}>
                      <strong>
                        <MaskedPatientName
                          value={`${patient.firstName} ${patient.lastName}`}
                        />
                      </strong>
                    </Link>
                    <span>
                      <MaskedPatientId value={patient.patientNumber} />
                    </span>
                  </td>
                  <td>{formatDate(patient.birthDate)}</td>
                  <td>{patient.sex}</td>
                  <td>
                    <strong>{patient.phone ?? "-"}</strong>
                    <span>{patient.email ?? "E-posta yok"}</span>
                  </td>
                  <td>{patient.studyCount}</td>
                  <td>
                    {formatDate(patient.lastStudyAt, { dateStyle: "medium" })}
                  </td>
                  {canDeletePatients ? (
                    <td>
                      <DeletePatientButton patientId={patient.id} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function formatDate(
  value: string | null,
  options?: Intl.DateTimeFormatOptions
) {
  if (!value) return "-"

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"

  return new Intl.DateTimeFormat("tr-TR", options).format(date)
}
