import { requireAdmin } from "@/lib/auth"

export const metadata = { title: "Kullanicilar" }

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
    name: "Dr. Murat Onal",
    email: "murat.onal@raipacs.com",
    role: "Doktor",
    status: "Davet gonderildi",
  },
]

export default async function UsersPage() {
  await requireAdmin()

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Kullanicilar</h1>
          <p>Doktor ve yonetici hesaplarini kurum bazinda yonetin.</p>
        </div>
        <button className="button primary" type="button">
          Kullanici davet et
        </button>
      </header>
      <section className="data-panel">
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Kullanici</th>
                <th>Rol</th>
                <th>Durum</th>
                <th>Islem</th>
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
                      Yonet
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
