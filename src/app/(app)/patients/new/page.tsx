import Link from "next/link"

import { PatientForm } from "@/components/patient-form"
import { requirePatientManager } from "@/lib/auth"

export const metadata = { title: "Yeni hasta" }

export default async function NewPatientPage() {
  await requirePatientManager()

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Hasta yönetimi</p>
          <h1>Yeni hasta</h1>
          <p>Demografik hasta kaydını oluşturun.</p>
        </div>
        <Link className="button subtle" href="/patients">
          Hastalar
        </Link>
      </header>
      <section className="upload-layout">
        <div className="data-panel upload-panel">
          <div className="panel-heading">
            <h2>Hasta bilgileri</h2>
          </div>
          <PatientForm />
        </div>
        <aside className="info-panel">
          <h2>Kayıt ilkesi</h2>
          <p className="muted">
            Hasta verisi kurum bazında saklanır. Hasta numarası boş bırakılırsa
            sistem benzersiz bir numara üretir.
          </p>
          <dl>
            <div>
              <dt>Yetki</dt>
              <dd>Admin / Supervisors / Doctors</dd>
            </div>
            <div>
              <dt>Arama</dt>
              <dd>Türkçe uyumlu</dd>
            </div>
            <div>
              <dt>Audit</dt>
              <dd>patient.created</dd>
            </div>
          </dl>
        </aside>
      </section>
    </>
  )
}
