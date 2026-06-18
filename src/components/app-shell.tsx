import Link from "next/link"

import { signOut } from "@/app/actions/auth"
import type { CurrentUser } from "@/lib/auth"

const mainLinks = [
  { href: "/worklist", label: "Worklist" },
  { href: "/patients", label: "Hastalar" },
]

export function AppShell({
  user,
  children,
}: {
  user: CurrentUser
  children: React.ReactNode
}) {
  const links =
    user.role === "admin"
      ? [...mainLinks, { href: "/admin/users", label: "Kullanıcılar" }]
      : mainLinks

  return (
    <div className="app-frame">
      <header className="app-header">
        <Link className="brand" href="/worklist">
          <span className="brand-mark">RAI</span>
          <span>
            <strong>RAI PACS</strong>
            <small>{user.organizationName}</small>
          </span>
        </Link>
        <nav className="main-nav" aria-label="Ana navigasyon">
          {links.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="account">
          <div>
            <strong>{user.fullName}</strong>
            <span>{user.role === "admin" ? "Admin" : "Doktor"}</span>
          </div>
          <form action={signOut}>
            <button className="button subtle" type="submit">
              Çıkış
            </button>
          </form>
        </div>
      </header>
      {user.demo ? (
        <div className="demo-banner">
          Demo modu: Supabase ortam değişkenleri tanımlandığında gerçek oturum
          ve veritabanı devreye girer.
        </div>
      ) : null}
      <main className="app-content">{children}</main>
    </div>
  )
}
