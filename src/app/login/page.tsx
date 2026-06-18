import { redirect } from "next/navigation"

import { LoginForm } from "@/app/login/login-form"
import { getCurrentUser } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/config"

export const metadata = { title: "Giriş" }

export default async function LoginPage() {
  const user = await getCurrentUser()
  if (user && !user.demo) redirect("/worklist")

  return (
    <main className="login-page">
      <section className="login-brand">
        <div className="brand-mark large">RAI</div>
        <p className="eyebrow">RAI PACS</p>
        <h1>Görüntüleme iş akışı, tek güvenli platformda.</h1>
        <p>
          Doktorlar için worklist ve raporlama, yöneticiler için kullanıcı,
          kurum ve audit kontrolü.
        </p>
      </section>
      <section className="login-panel">
        <div>
          <p className="eyebrow">Güvenli erişim</p>
          <h2>Hesabınıza girin</h2>
          <p className="muted">
            {isSupabaseConfigured
              ? "Kurum hesabınızla devam edin."
              : "Supabase bağlanana kadar demo modu aktiftir."}
          </p>
        </div>
        <LoginForm demoMode={!isSupabaseConfigured} />
        <p className="security-note">
          Hasta verileri ve DICOM nesneleri kurum bazlı erişim kurallarıyla
          korunur.
        </p>
      </section>
    </main>
  )
}
