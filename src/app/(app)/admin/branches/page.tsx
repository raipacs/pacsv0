import Link from "next/link"

import { requireAdmin } from "@/lib/auth"
import { getBranchSummaries } from "@/lib/branches"
import { formatDateTime } from "@/lib/dicom-server-status"

export const dynamic = "force-dynamic"
export const metadata = { title: "Şubeler" }

export default async function BranchesPage() {
  const user = await requireAdmin()
  const branches = await getBranchSummaries(user.organizationId)
  const totalPatients = branches.reduce((sum, branch) => sum + branch.patientCount, 0)
  const totalStudies = branches.reduce((sum, branch) => sum + branch.studyCount, 0)
  const totalModalities = branches.reduce(
    (sum, branch) => sum + branch.modalityCount,
    0
  )

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Tenant ve şube yapısı</p>
          <h1>Şubeler</h1>
          <p>
            Mevcut kayıtlar Merkez şubesine bağlıdır. Yeni hastane/şube modeli bu
            katmandan büyütülecek.
          </p>
        </div>
        <div className="page-actions">
          <Link className="button subtle" href="/admin/users">
            Admin
          </Link>
          <Link className="button subtle" href="/admin/dicom-server">
            DICOM Server
          </Link>
          <button className="button primary" type="button">
            Şube ekle
          </button>
        </div>
      </header>

      <section className="metric-row">
        <article>
          <span>Şube</span>
          <strong>{branches.length}</strong>
        </article>
        <article>
          <span>Hasta</span>
          <strong>{totalPatients}</strong>
        </article>
        <article>
          <span>Tetkik</span>
          <strong>{totalStudies}</strong>
        </article>
        <article>
          <span>Modalite</span>
          <strong>{totalModalities}</strong>
        </article>
      </section>

      <section className="data-panel admin-section">
        <div className="panel-heading">
          <h2>Şube listesi</h2>
        </div>
        {branches.length ? (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Şube</th>
                  <th>Kod</th>
                  <th>Hasta</th>
                  <th>Tetkik</th>
                  <th>Modalite</th>
                  <th>Son tetkik</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {branches.map((branch) => (
                  <tr key={branch.id}>
                    <td>
                      <strong>{branch.name}</strong>
                      <span>{branch.slug}</span>
                    </td>
                    <td>{branch.code || "-"}</td>
                    <td>{branch.patientCount}</td>
                    <td>{branch.studyCount}</td>
                    <td>{branch.modalityCount}</td>
                    <td>{formatDateTime(branch.lastStudyAt)}</td>
                    <td>
                      <span
                        className={`health-badge ${
                          branch.isActive ? "ok" : "unknown"
                        }`}
                      >
                        {branch.isMain ? "Merkez" : branch.isActive ? "Aktif" : "Pasif"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">
            Şube tablosu henüz oluşturulmamış. Migration uygulandığında Merkez
            şubesi otomatik oluşacak.
          </p>
        )}
        <p className="panel-note">
          Bu model tek veritabanı içinde tenant/şube ayrımı sağlar. İleride her
          hastane ayrı müşteri olduğunda organization bazlı fiziksel ayrım veya
          ayrı Supabase projesine taşıma için uyumludur.
        </p>
      </section>
    </>
  )
}
