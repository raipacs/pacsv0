import Link from "next/link"

import { DicomUploadForm } from "@/components/dicom-upload-form"
import { requireAdmin } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/config"
import { getPatients } from "@/lib/data"
import { MAX_BROWSER_DICOM_UPLOAD_BYTES } from "@/lib/dicom-storage"

export const metadata = { title: "DICOM Yükle" }

export default async function DicomUploadPage() {
  const user = await requireAdmin()
  const patients = await getPatients(user.organizationId)

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Supabase Storage</p>
          <h1>DICOM yükle</h1>
          <p>
            Orijinal DICOM dosyası private Storage bucket alanına, metadata ise
            veritabanı tablolarına yazılır.
          </p>
        </div>
        <Link className="button subtle" href="/worklist">
          Worklist
        </Link>
      </header>
      <section className="upload-layout">
        <div className="data-panel upload-panel">
          <div className="panel-heading">
            <h2>Yeni DICOM instance</h2>
          </div>
          <DicomUploadForm
            patients={patients.map((patient) => ({
              id: patient.id,
              label: `${patient.firstName} ${patient.lastName} - ${patient.patientNumber}`,
            }))}
            supabaseConfigured={isSupabaseConfigured}
          />
        </div>
        <aside className="info-panel">
          <h2>Saklama kuralı</h2>
          <p className="muted">
            Dosya içeriği Postgres veritabanına yazılmaz. Veritabanı sadece
            bucket, storage key, byte boyutu, SHA-256 ve DICOM UID referanslarını
            tutar.
          </p>
          <dl>
            <div>
              <dt>Bucket</dt>
              <dd>dicom-originals</dd>
            </div>
            <div>
              <dt>Erişim</dt>
              <dd>Private</dd>
            </div>
            <div>
              <dt>Yükleme</dt>
              <dd>Admin</dd>
            </div>
            <div>
              <dt>Okuma</dt>
              <dd>Kurum uyeleri</dd>
            </div>
            <div>
              <dt>MVP sınır</dt>
              <dd>{MAX_BROWSER_DICOM_UPLOAD_BYTES / 1024 / 1024} MB</dd>
            </div>
          </dl>
        </aside>
      </section>
    </>
  )
}
