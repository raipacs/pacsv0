import Link from "next/link"

import { requireAdmin } from "@/lib/auth"

export const metadata = { title: "Admin" }

const users = [
  {
    name: "RAI PACS Admin",
    email: "admin@raipacs.com",
    role: "Admin",
    status: "Aktif",
  },
  {
    name: "Dr. Selin Aras",
    email: "selin.aras@raipacs.com",
    role: "Doktor",
    status: "Aktif",
  },
  {
    name: "supervisor",
    email: "supervisor@raipacs.com",
    role: "Supervisor",
    status: "Supervisors grubu",
  },
  {
    name: "doctor",
    email: "doctor@raipacs.com",
    role: "Doctor",
    status: "Doctors grubu",
  },
  {
    name: "Dr. Murat Önal",
    email: "murat.onal@raipacs.com",
    role: "Doktor",
    status: "Davet gönderildi",
  },
]

export default async function UsersPage() {
  await requireAdmin()

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Yönetim</p>
          <h1>Admin</h1>
          <p>Kullanıcı, grup ve kurum yönetimi ekranlarını buradan yönetin.</p>
        </div>
        <div className="page-actions">
          <Link className="button subtle" href="/admin/branches">
            Şubeler
          </Link>
          <Link className="button subtle" href="/admin/dicom-server">
            DICOM Server
          </Link>
          <Link className="button subtle" href="/admin/his-integration">
            HIS Entegrasyonu
          </Link>
          <button className="button primary" type="button">
            Kullanıcı davet et
          </button>
        </div>
      </header>
      <section className="data-panel">
        <div className="panel-heading">
          <h2>Kullanıcılar</h2>
        </div>
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Kullanıcı</th>
                <th>Rol</th>
                <th>Durum</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.email}>
                  <td>
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                  </td>
                  <td>{user.role}</td>
                  <td>{user.status}</td>
                  <td>
                    <button className="button subtle" type="button">
                      Yönet
                    </button>
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
