import Link from "next/link"

import { createAiProvider, updateAiProvider } from "@/app/actions/admin"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"
export const metadata = { title: "AI Servisleri" }

type AiProviderRow = {
  id: string
  name: string
  slug: string
  provider_type: "mock" | "openai" | "anthropic" | "google" | "custom" | string
  default_model: string | null
  is_active: boolean | null
  is_default: boolean | null
  requires_credentials: boolean | null
  credential_reference: string | null
  created_at: string
  updated_at: string
}

type AiJobRow = {
  id: string
  provider_slug: string
  model_name: string | null
  status: string
  created_at: string
  completed_at: string | null
  studies:
    | { accession_number: string | null; modality: string | null; description: string | null }
    | { accession_number: string | null; modality: string | null; description: string | null }[]
    | null
}

type AiDraftRow = {
  id: string
  status: string
  criticality: string
  confidence_score: number | null
  created_at: string
  ai_jobs:
    | { provider_slug: string | null; model_name: string | null }
    | { provider_slug: string | null; model_name: string | null }[]
    | null
  studies:
    | { accession_number: string | null; modality: string | null; description: string | null }
    | { accession_number: string | null; modality: string | null; description: string | null }[]
    | null
}

export default async function AiServicesPage() {
  const user = await requireAdmin()
  const supabase = await createClient()

  const [providersResult, jobsResult, draftsResult] = await Promise.all([
    supabase
      .from("ai_service_providers")
      .select(
        "id, name, slug, provider_type, default_model, is_active, is_default, requires_credentials, credential_reference, created_at, updated_at"
      )
      .eq("organization_id", user.organizationId)
      .order("is_default", { ascending: false })
      .order("name", { ascending: true }),
    supabase
      .from("ai_jobs")
      .select("id, provider_slug, model_name, status, created_at, completed_at, studies(accession_number, modality, description)")
      .eq("organization_id", user.organizationId)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("ai_report_drafts")
      .select("id, status, criticality, confidence_score, created_at, ai_jobs(provider_slug, model_name), studies(accession_number, modality, description)")
      .eq("organization_id", user.organizationId)
      .order("created_at", { ascending: false })
      .limit(12),
  ])

  if (providersResult.error) {
    throw new Error(`AI servisleri alınamadı: ${providersResult.error.message}`)
  }
  if (jobsResult.error) {
    throw new Error(`AI iş kuyruğu alınamadı: ${jobsResult.error.message}`)
  }
  if (draftsResult.error) {
    throw new Error(`AI ön raporları alınamadı: ${draftsResult.error.message}`)
  }

  const providers = (providersResult.data ?? []) as AiProviderRow[]
  const jobs = (jobsResult.data ?? []) as AiJobRow[]
  const drafts = (draftsResult.data ?? []) as AiDraftRow[]
  const activeProviders = providers.filter((provider) => provider.is_active)
  const credentialReady = providers.filter(
    (provider) => !provider.requires_credentials || provider.credential_reference
  )
  const readyDrafts = drafts.filter((draft) => draft.status === "ready")

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">AI yönetimi</p>
          <h1>AI servisleri</h1>
          <p>Ön rapor üretimi için kullanılacak AI/LLM sağlayıcılarını ve modelleri yönetin.</p>
        </div>
        <div className="page-actions">
          <Link className="button subtle" href="/admin/users">
            Admin
          </Link>
          <Link className="button subtle" href="/admin/dicom-server">
            DICOM Server
          </Link>
          <Link className="button subtle" href="/admin/his-integration">
            HIS Entegrasyonu
          </Link>
        </div>
      </header>

      <section className="metric-row">
        <article>
          <span>Provider</span>
          <strong>{providers.length}</strong>
        </article>
        <article>
          <span>Aktif</span>
          <strong>{activeProviders.length}</strong>
        </article>
        <article>
          <span>Credential hazır</span>
          <strong>{credentialReady.length}</strong>
        </article>
        <article>
          <span>Hazır ön rapor</span>
          <strong>{readyDrafts.length}</strong>
        </article>
      </section>

      <section className="ai-admin-grid">
        <section className="data-panel admin-section">
          <div className="panel-heading">
            <h2>Servis tanımları</h2>
          </div>
          <div className="ai-provider-list">
            {providers.map((provider) => (
              <article className="ai-provider-card" key={provider.id}>
                <div className="ai-provider-card-header">
                  <div>
                    <strong>{provider.name}</strong>
                    <span>
                      {providerLabel(provider.provider_type)} · {provider.slug}
                    </span>
                  </div>
                  <div className="chip-list">
                    {provider.is_default ? <span className="health-badge ok">Varsayılan</span> : null}
                    <span className={`health-badge ${provider.is_active ? "ok" : "warning"}`}>
                      {provider.is_active ? "Aktif" : "Pasif"}
                    </span>
                  </div>
                </div>
                <form action={updateAiProvider} className="admin-form compact-ai-provider-form">
                  <input name="providerId" type="hidden" value={provider.id} />
                  <div className="form-grid two">
                    <label>
                      <span>Servis adı</span>
                      <input name="name" defaultValue={provider.name} required />
                    </label>
                    <label>
                      <span>Model</span>
                      <input
                        name="defaultModel"
                        defaultValue={provider.default_model ?? ""}
                        placeholder="gpt-5.1, claude-opus-4.5..."
                      />
                    </label>
                  </div>
                  <label>
                    <span>Credential reference</span>
                    <input
                      name="credentialReference"
                      defaultValue={provider.credential_reference ?? ""}
                      placeholder={credentialPlaceholder(provider.provider_type)}
                    />
                  </label>
                  <div className="ai-provider-switches">
                    <label className="checkbox-line">
                      <input defaultChecked={Boolean(provider.is_active)} name="isActive" type="checkbox" />
                      Aktif
                    </label>
                    <label className="checkbox-line">
                      <input defaultChecked={Boolean(provider.is_default)} name="isDefault" type="checkbox" />
                      Varsayılan
                    </label>
                    <button className="button subtle" type="submit">
                      Kaydet
                    </button>
                  </div>
                  <p className="form-help">
                    API anahtarını burada saklamıyoruz. Bu alana Vercel/Supabase secret adını yazıyoruz.
                  </p>
                </form>
              </article>
            ))}
          </div>
        </section>

        <section className="data-panel admin-section">
          <div className="panel-heading">
            <h2>Özel servis ekle</h2>
          </div>
          <form action={createAiProvider} className="admin-form">
            <label>
              <span>Servis adı</span>
              <input name="name" placeholder="Örn. Local Lung CT AI" required />
            </label>
            <label>
              <span>Tip</span>
              <select name="providerType" defaultValue="custom">
                <option value="custom">Custom medikal AI</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Claude / Anthropic</option>
                <option value="google">Gemini / Google</option>
                <option value="mock">RAI Mock</option>
              </select>
            </label>
            <label>
              <span>Model</span>
              <input name="defaultModel" placeholder="model veya endpoint sürümü" />
            </label>
            <label>
              <span>Credential reference</span>
              <input name="credentialReference" placeholder="RAI_CUSTOM_AI_API_KEY" />
            </label>
            <button className="button primary" type="submit">
              Servis oluştur
            </button>
            <p className="form-help">
              Yeni servis pasif açılır. Hesap/endpoint doğrulandıktan sonra aktif hale getiririz.
            </p>
          </form>
        </section>
      </section>

      <section className="admin-user-grid">
        <section className="data-panel admin-section">
          <div className="panel-heading">
            <h2>Son AI işleri</h2>
          </div>
          {jobs.length ? (
            <div className="responsive-table">
              <table>
                <thead>
                  <tr>
                    <th>Tetkik</th>
                    <th>Provider</th>
                    <th>Durum</th>
                    <th>Tarih</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <AiJobTableRow job={job} key={job.id} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-state">Henüz AI işi yok.</p>
          )}
        </section>

        <section className="data-panel admin-section">
          <div className="panel-heading">
            <h2>Son ön raporlar</h2>
          </div>
          {drafts.length ? (
            <div className="responsive-table">
              <table>
                <thead>
                  <tr>
                    <th>Tetkik</th>
                    <th>AI</th>
                    <th>Skor</th>
                    <th>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((draft) => (
                    <AiDraftTableRow draft={draft} key={draft.id} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-state">Henüz AI ön raporu yok.</p>
          )}
        </section>
      </section>
    </>
  )
}

function AiJobTableRow({ job }: { job: AiJobRow }) {
  const study = firstRelation(job.studies)

  return (
    <tr>
      <td>
        <strong>{study?.description ?? "Tetkik"}</strong>
        <span>
          {study?.modality ?? "-"} · {study?.accession_number ?? "-"}
        </span>
      </td>
      <td>
        <strong>{job.provider_slug}</strong>
        <span>{job.model_name ?? "-"}</span>
      </td>
      <td>
        <span className={`health-badge ${jobStatusClass(job.status)}`}>
          {jobStatusLabel(job.status)}
        </span>
      </td>
      <td>{formatDateTime(job.created_at)}</td>
    </tr>
  )
}

function AiDraftTableRow({ draft }: { draft: AiDraftRow }) {
  const job = firstRelation(draft.ai_jobs)
  const study = firstRelation(draft.studies)

  return (
    <tr>
      <td>
        <strong>{study?.description ?? "Ön rapor"}</strong>
        <span>
          {study?.modality ?? "-"} · {study?.accession_number ?? "-"}
        </span>
      </td>
      <td>
        <strong>{job?.provider_slug ?? "-"}</strong>
        <span>{job?.model_name ?? "-"}</span>
      </td>
      <td>{formatConfidence(draft.confidence_score)}</td>
      <td>
        <span className={`health-badge ${draft.criticality === "high" ? "error" : "ok"}`}>
          {draftStatusLabel(draft.status)}
        </span>
      </td>
    </tr>
  )
}

function firstRelation<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] : value
}

function providerLabel(value: string) {
  switch (value) {
    case "openai":
      return "OpenAI"
    case "anthropic":
      return "Claude"
    case "google":
      return "Gemini"
    case "mock":
      return "RAI Mock"
    default:
      return "Custom"
  }
}

function credentialPlaceholder(providerType: string) {
  switch (providerType) {
    case "openai":
      return "OPENAI_API_KEY"
    case "anthropic":
      return "ANTHROPIC_API_KEY"
    case "google":
      return "GOOGLE_GENERATIVE_AI_API_KEY"
    case "mock":
      return "Credential gerekmez"
    default:
      return "RAI_CUSTOM_AI_API_KEY"
  }
}

function jobStatusClass(status: string) {
  if (status === "draft_ready") return "ok"
  if (status === "failed") return "error"
  if (status === "waiting_credentials") return "warning"
  return "unknown"
}

function jobStatusLabel(status: string) {
  switch (status) {
    case "draft_ready":
      return "Ön rapor hazır"
    case "waiting_credentials":
      return "Hesap bekliyor"
    case "running":
      return "Çalışıyor"
    case "failed":
      return "Başarısız"
    default:
      return status
  }
}

function draftStatusLabel(status: string) {
  switch (status) {
    case "ready":
      return "Hazır"
    case "accepted":
      return "Rapora aktarıldı"
    case "rejected":
      return "Reddedildi"
    default:
      return status
  }
}

function formatConfidence(value: number | null) {
  if (typeof value !== "number") return "-"
  return `%${Math.round(value * 100)}`
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value))
}
