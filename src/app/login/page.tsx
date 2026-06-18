import { redirect } from "next/navigation"

import { LoginForm } from "@/app/login/login-form"
import { getCurrentUser } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/config"

export const metadata = { title: "Giris" }

export default async function LoginPage() {
  const user = await getCurrentUser()
  if (user && !user.demo) redirect("/worklist")

  return (
    <main className="login-page">
      <section className="login-brand">
        <div className="brand-mark large">RAI</div>
        <p className="eyebrow">RAI PACS</p>
        <h1>Goruntuleme is akisi, tek guvenli platformda.</h1>
        <p>
          Doktorlar icin worklist ve raporlama, yoneticiler icin kullanici,
          kurum ve audit kontrolu.
        </p>
      </section>
      <section className="login-panel">
        <div>
          <p className="eyebrow">Guvenli erisim</p>
          <h2>Hesabiniza girin</h2>
          <p className="muted">
            {isSupabaseConfigured
              ? "Kurum hesabinizla devam edin."
              : "Supabase baglanana kadar demo modu aktiftir."}
          </p>
        </div>
        <LoginForm demoMode={!isSupabaseConfigured} />
        <p className="security-note">
          Hasta verileri ve DICOM nesneleri kurum bazli erisim kurallariyla
          korunur.
        </p>
      </section>
    </main>
  )
}
