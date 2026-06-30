import Link from "next/link"
import type { ReactNode } from "react"

import {
  createAiProvider,
  testDeepSeekEndpoint,
  testQwenEndpoint,
  testRaiLlmEndpoint,
  updateAiProvider,
} from "@/app/actions/admin"
import { aiProviderMark, isMissingAiTableError } from "@/lib/ai-reporting"
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
  input_context: Record<string, unknown> | null
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

type AiUsageRow = {
  id: string
  provider_slug: string
  model_name: string | null
  usage_type: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  currency: string
  input_cost: number
  output_cost: number
  total_cost: number
  created_at: string
  ai_jobs:
    | { id: string; status: string | null }
    | { id: string; status: string | null }[]
    | null
  reports:
    | { id: string; status: string | null; version: number | null }
    | { id: string; status: string | null; version: number | null }[]
    | null
  studies:
    | { accession_number: string | null; modality: string | null; description: string | null }
    | { accession_number: string | null; modality: string | null; description: string | null }[]
    | null
}

type AiServicesPageProps = {
  searchParams: Promise<{
    from?: string
    raiLlmMessage?: string
    raiLlmMs?: string
    raiLlmTest?: string
    qwenMessage?: string
    qwenMs?: string
    qwenTest?: string
    deepSeekMessage?: string
    deepSeekMs?: string
    deepSeekTest?: string
    to?: string
  }>
}

export default async function AiServicesPage({ searchParams }: AiServicesPageProps) {
  const user = await requireAdmin()
  const query = await searchParams
  const supabase = await createClient()
  const range = parseUsageRange(query)

  await Promise.all([
    ensureRaiLlmProvider(supabase, user.organizationId, user.id),
    ensureRaiAiOrchestratorProvider(supabase, user.organizationId, user.id),
    ensureQwenProvider(supabase, user.organizationId, user.id),
    ensureDeepSeekProvider(supabase, user.organizationId, user.id),
  ])

  const [providersResult, jobsResult, draftsResult, usageResult] = await Promise.all([
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
      .select(
        "id, provider_slug, model_name, status, input_context, created_at, completed_at, studies(accession_number, modality, description)"
      )
      .eq("organization_id", user.organizationId)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("ai_report_drafts")
      .select("id, status, criticality, confidence_score, created_at, ai_jobs(provider_slug, model_name), studies(accession_number, modality, description)")
      .eq("organization_id", user.organizationId)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("ai_usage_events")
      .select(
        "id, provider_slug, model_name, usage_type, input_tokens, output_tokens, total_tokens, currency, input_cost, output_cost, total_cost, created_at, ai_jobs(id, status), reports(id, status, version), studies(accession_number, modality, description)"
      )
      .eq("organization_id", user.organizationId)
      .gte("created_at", range.fromIso)
      .lte("created_at", range.toIso)
      .order("created_at", { ascending: false })
      .limit(120),
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
  const usageUnavailable = usageResult.error && isMissingAiTableError(usageResult.error)
  if (usageResult.error && !usageUnavailable) {
    throw new Error(`AI token tüketimi alınamadı: ${usageResult.error.message}`)
  }

  const providers = (providersResult.data ?? []) as AiProviderRow[]
  const jobs = (jobsResult.data ?? []) as AiJobRow[]
  const drafts = (draftsResult.data ?? []) as AiDraftRow[]
  const usageRows = usageUnavailable ? [] : ((usageResult.data ?? []) as AiUsageRow[])
  const activeProviders = providers.filter((provider) => provider.is_active)
  const credentialReady = providers.filter(
    (provider) => !provider.requires_credentials || provider.credential_reference
  )
  const raiLlmProvider = providers.find((provider) => provider.slug === "rai-llm") ?? null
  const qwenProvider = providers.find((provider) => provider.slug === "qwen") ?? null
  const deepSeekProvider = providers.find((provider) => provider.slug === "deepseek") ?? null
  const raiLlmStatus = buildRaiLlmStatus(raiLlmProvider)
  const raiLlmTestResult = parseRaiLlmTestResult(query)
  const qwenStatus = buildQwenStatus(qwenProvider)
  const qwenTestResult = parseQwenTestResult(query)
  const deepSeekStatus = buildDeepSeekStatus(deepSeekProvider)
  const deepSeekTestResult = parseDeepSeekTestResult(query)
  const readyDrafts = drafts.filter((draft) => draft.status === "ready")
  const providerWarningCount = providers.filter(
    (provider) =>
      !provider.is_active || (provider.requires_credentials && !provider.credential_reference)
  ).length
  const jobWarningCount = jobs.filter(
    (job) => job.status === "failed" || job.status === "waiting_credentials" || job.status === "endpoint_waking"
  ).length
  const draftWarningCount = drafts.filter((draft) => draft.criticality === "high").length
  const raiLlmWarningCount = raiLlmStatus.ready ? 0 : 1
  const qwenWarningCount = qwenStatus.ready ? 0 : 1
  const deepSeekWarningCount = deepSeekStatus.ready ? 0 : 1
  const usageWarningCount = usageUnavailable ? 1 : 0
  const usageSummary = summarizeUsage(usageRows)
  const totalUsage = usageSummary.reduce(
    (acc, item) => ({
      cost: acc.cost + item.totalCost,
      inputTokens: acc.inputTokens + item.inputTokens,
      outputTokens: acc.outputTokens + item.outputTokens,
      totalTokens: acc.totalTokens + item.totalTokens,
    }),
    { cost: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  )

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

      <CollapsiblePanel
        detail={
          raiLlmWarningCount
            ? "GPU endpoint ve Cloud Run kota adımı bekliyor"
            : "RAI LLM endpoint kullanıma hazır"
        }
        open={raiLlmWarningCount > 0}
        title="RAI LLM operasyon durumu"
        warningCount={raiLlmWarningCount}
      >
        <div className="panel-heading compact">
          <div>
            <p>Self-hosted model hattı, endpoint ayarları ve canlı test adımları.</p>
          </div>
          <span className={`health-badge ${raiLlmStatus.ready ? "ok" : "warning"}`}>
            {raiLlmStatus.ready ? "Endpoint hazır" : "Kurulum bekliyor"}
          </span>
        </div>
        <div className="rai-llm-status-grid">
          <article>
            <span>Provider</span>
            <strong>{raiLlmStatus.providerLabel}</strong>
            <small>{raiLlmStatus.providerState}</small>
          </article>
          <article>
            <span>Model</span>
            <strong>{raiLlmStatus.model}</strong>
            <small>RAI fine-tune hattı için başlangıç modeli</small>
          </article>
          <article>
            <span>Endpoint</span>
            <strong>{raiLlmStatus.endpointState}</strong>
            <small>{raiLlmStatus.endpointLabel}</small>
          </article>
          <article>
            <span>API token</span>
            <strong>{raiLlmStatus.apiKeyState}</strong>
            <small>Secret değeri ekranda gösterilmez</small>
          </article>
          <article>
            <span>Altyapı</span>
            <strong>{raiLlmStatus.infrastructureState}</strong>
            <small>{raiLlmStatus.infrastructureLabel}</small>
          </article>
        </div>
        <div className="rai-llm-runbook">
          <div>
            <strong>Sıradaki operasyon</strong>
            <p>{raiLlmStatus.nextStep}</p>
          </div>
          <pre>{raiLlmStatus.testCommand}</pre>
        </div>
        <div className="rai-llm-checklist">
          {raiLlmStatus.setupChecklist.map((item) => (
            <article key={item.label}>
              <span className={`health-badge ${item.state}`}>{item.badge}</span>
              <div>
                <strong>{item.label}</strong>
                <p>{item.detail}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="rai-llm-test-row">
          <form action={testRaiLlmEndpoint}>
            <button className="button subtle" type="submit">
              Canlı test et
            </button>
          </form>
          {raiLlmTestResult ? (
            <p className={`form-status ${raiLlmTestResult.ok ? "success" : "error"}`}>
              {raiLlmTestResult.message}
              {raiLlmTestResult.elapsedMs ? ` · ${raiLlmTestResult.elapsedMs} ms` : ""}
            </p>
          ) : (
            <p className="form-help">Endpoint env tanımlandıktan sonra buradan canlı bağlantı testi yapılır.</p>
          )}
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel
        detail={
          deepSeekWarningCount
            ? "DEEPSEEK_API_KEY ve provider aktivasyonu bekliyor"
            : "DeepSeek API kullanıma hazır"
        }
        open={deepSeekWarningCount > 0}
        title="DeepSeek bağlantı durumu"
        warningCount={deepSeekWarningCount}
      >
        <div className="panel-heading compact">
          <div>
            <p>DeepSeek Chat/Reasoner API rapor metni, kalite kontrol ve reasoning akışları için kullanılır.</p>
          </div>
          <span className={`health-badge ${deepSeekStatus.ready ? "ok" : "warning"}`}>
            {deepSeekStatus.ready ? "API hazır" : "Kurulum bekliyor"}
          </span>
        </div>
        <div className="rai-llm-status-grid">
          <article>
            <span>Provider</span>
            <strong>{deepSeekStatus.providerLabel}</strong>
            <small>{deepSeekStatus.providerState}</small>
          </article>
          <article>
            <span>Model</span>
            <strong>{deepSeekStatus.model}</strong>
            <small>Rapor metni ve reasoning modeli</small>
          </article>
          <article>
            <span>Endpoint</span>
            <strong>{deepSeekStatus.endpointState}</strong>
            <small>{deepSeekStatus.endpointLabel}</small>
          </article>
          <article>
            <span>API token</span>
            <strong>{deepSeekStatus.apiKeyState}</strong>
            <small>Secret değeri ekranda gösterilmez</small>
          </article>
        </div>
        <div className="rai-llm-runbook">
          <div>
            <strong>Sıradaki operasyon</strong>
            <p>{deepSeekStatus.nextStep}</p>
          </div>
          <pre>{deepSeekStatus.testCommand}</pre>
        </div>
        <div className="rai-llm-test-row">
          <form action={testDeepSeekEndpoint}>
            <button className="button subtle" type="submit">
              DeepSeek canlı test et
            </button>
          </form>
          {deepSeekTestResult ? (
            <p className={`form-status ${deepSeekTestResult.ok ? "success" : "error"}`}>
              {deepSeekTestResult.message}
              {deepSeekTestResult.elapsedMs ? ` · ${deepSeekTestResult.elapsedMs} ms` : ""}
            </p>
          ) : (
            <p className="form-help">DEEPSEEK_API_KEY tanımlandıktan sonra buradan API smoke test yapılır.</p>
          )}
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel
        detail={
          qwenWarningCount
            ? "QWEN_API_KEY ve provider aktivasyonu bekliyor"
            : "Qwen Vision API kullanıma hazır"
        }
        open={qwenWarningCount > 0}
        title="Qwen Vision bağlantı durumu"
        warningCount={qwenWarningCount}
      >
        <div className="panel-heading compact">
          <div>
            <p>Alibaba Model Studio / Qwen VL OpenAI-compatible API bağlantısı.</p>
          </div>
          <span className={`health-badge ${qwenStatus.ready ? "ok" : "warning"}`}>
            {qwenStatus.ready ? "API hazır" : "Kurulum bekliyor"}
          </span>
        </div>
        <div className="rai-llm-status-grid">
          <article>
            <span>Provider</span>
            <strong>{qwenStatus.providerLabel}</strong>
            <small>{qwenStatus.providerState}</small>
          </article>
          <article>
            <span>Model</span>
            <strong>{qwenStatus.model}</strong>
            <small>Qwen VL görüntü-dil modeli</small>
          </article>
          <article>
            <span>Endpoint</span>
            <strong>{qwenStatus.endpointState}</strong>
            <small>{qwenStatus.endpointLabel}</small>
          </article>
          <article>
            <span>API token</span>
            <strong>{qwenStatus.apiKeyState}</strong>
            <small>Secret değeri ekranda gösterilmez</small>
          </article>
        </div>
        <div className="rai-llm-runbook">
          <div>
            <strong>Sıradaki operasyon</strong>
            <p>{qwenStatus.nextStep}</p>
          </div>
          <pre>{qwenStatus.testCommand}</pre>
        </div>
        <div className="rai-llm-test-row">
          <form action={testQwenEndpoint}>
            <button className="button subtle" type="submit">
              Qwen canlı test et
            </button>
          </form>
          {qwenTestResult ? (
            <p className={`form-status ${qwenTestResult.ok ? "success" : "error"}`}>
              {qwenTestResult.message}
              {qwenTestResult.elapsedMs ? ` · ${qwenTestResult.elapsedMs} ms` : ""}
            </p>
          ) : (
            <p className="form-help">QWEN_API_KEY tanımlandıktan sonra buradan API smoke test yapılır.</p>
          )}
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel
        detail={
          usageUnavailable
            ? "Token tüketim tablosu uyarı veriyor"
            : `${formatNumber(totalUsage.totalTokens)} token / ${formatMoney(totalUsage.cost)}`
        }
        open={usageWarningCount > 0}
        title="Token ve maliyet tüketimi"
        warningCount={usageWarningCount}
      >
        {usageUnavailable ? (
          <p className="table-note ai-usage-warning">
            Token tüketim tablosu henüz Supabase üzerinde uygulanmamış. Migration sonrası bu
            rapor otomatik aktif olur.
          </p>
        ) : null}
        <form className="ai-usage-filter">
          <label>
            <span>Başlangıç</span>
            <input name="from" type="date" defaultValue={range.fromDate} />
          </label>
          <label>
            <span>Bitiş</span>
            <input name="to" type="date" defaultValue={range.toDate} />
          </label>
          <button className="button subtle" type="submit">
            Filtrele
          </button>
          <Link className="button subtle" href="/admin/ai-services">
            Son 30 gün
          </Link>
        </form>
        <div className="ai-usage-summary-grid">
          <article>
            <span>Toplam token</span>
            <strong>{formatNumber(totalUsage.totalTokens)}</strong>
            <small>
              Input {formatNumber(totalUsage.inputTokens)} · Output{" "}
              {formatNumber(totalUsage.outputTokens)}
            </small>
          </article>
          <article>
            <span>Toplam maliyet</span>
            <strong>{formatMoney(totalUsage.cost)}</strong>
            <small>USD bazlı kayıt</small>
          </article>
          <article>
            <span>İşlem</span>
            <strong>{usageRows.length}</strong>
            <small>Seçilen tarih aralığı</small>
          </article>
          <article>
            <span>Provider</span>
            <strong>{usageSummary.length}</strong>
            <small>Kullanım oluşan servis</small>
          </article>
        </div>
        {usageSummary.length ? (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>LLM / servis</th>
                  <th>Model</th>
                  <th>Input</th>
                  <th>Output</th>
                  <th>Toplam token</th>
                  <th>Maliyet</th>
                  <th>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {usageSummary.map((item) => (
                  <tr key={`${item.providerSlug}-${item.modelName}`}>
                    <td>
                      <strong>{formatProviderSlug(item.providerSlug)}</strong>
                    </td>
                    <td>{item.modelName || "-"}</td>
                    <td>{formatNumber(item.inputTokens)}</td>
                    <td>{formatNumber(item.outputTokens)}</td>
                    <td>{formatNumber(item.totalTokens)}</td>
                    <td>{formatMoney(item.totalCost)}</td>
                    <td>{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">Bu tarih aralığında token tüketimi yok.</p>
        )}
      </CollapsiblePanel>

      <CollapsiblePanel
        detail={`${providers.length} provider / ${activeProviders.length} aktif`}
        open={providerWarningCount > 0}
        title="Servis tanımları"
        warningCount={providerWarningCount}
      >
        <div className="ai-provider-management-grid">
          <div className="ai-provider-list">
            {providers.map((provider) => (
              <article className="ai-provider-card" key={provider.id}>
                <div className="ai-provider-card-header">
                  <div>
                    <strong>
                      <span className="ai-provider-mark">
                        {aiProviderMark({ providerType: provider.provider_type, slug: provider.slug })}
                      </span>{" "}
                      {provider.name}
                    </strong>
                    <span>
                      {providerLabel(provider.provider_type, provider.slug)} · {provider.slug}
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
                      placeholder={credentialPlaceholder(provider.provider_type, provider.slug)}
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

          <aside className="ai-provider-create-panel">
            <div>
              <h3>Özel servis ekle</h3>
              <p>Yeni provider tanımı oluştur.</p>
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
          </aside>
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel
        detail={
          jobWarningCount
            ? `${jobWarningCount} iş uyarı durumunda`
            : `${jobs.length} son iş kaydı`
        }
        open={jobWarningCount > 0}
        title="Son AI işleri"
        warningCount={jobWarningCount}
      >
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
      </CollapsiblePanel>

      <CollapsiblePanel
        detail={
          draftWarningCount
            ? `${draftWarningCount} kritik ön rapor`
            : `${drafts.length} son ön rapor`
        }
        open={draftWarningCount > 0}
        title="Son ön raporlar"
        warningCount={draftWarningCount}
      >
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
      </CollapsiblePanel>

      <CollapsiblePanel
        detail={`${usageRows.length} token tüketim satırı`}
        open={usageWarningCount > 0}
        title="Token tüketim detayı"
        warningCount={usageWarningCount}
      >
        {usageRows.length ? (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>Tetkik / rapor</th>
                  <th>Provider</th>
                  <th>Kullanım</th>
                  <th>Token</th>
                  <th>Maliyet</th>
                </tr>
              </thead>
              <tbody>
                {usageRows.map((usage) => (
                  <AiUsageTableRow key={usage.id} usage={usage} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">Detay satırı yok.</p>
        )}
      </CollapsiblePanel>
    </>
  )
}

function CollapsiblePanel({
  children,
  detail,
  open = false,
  title,
  warningCount = 0,
}: {
  children: ReactNode
  detail: string
  open?: boolean
  title: string
  warningCount?: number
}) {
  return (
    <details className="data-panel admin-section collapsible-panel" open={open}>
      <summary className="panel-heading">
        <div>
          <h2>{title}</h2>
          <small>{detail}</small>
        </div>
        <span className={`panel-toggle ${warningCount ? "warning" : ""}`}>
          {formatPanelToggle(warningCount)}
        </span>
      </summary>
      {children}
    </details>
  )
}

function AiUsageTableRow({ usage }: { usage: AiUsageRow }) {
  const study = firstRelation(usage.studies)
  const report = firstRelation(usage.reports)
  const job = firstRelation(usage.ai_jobs)

  return (
    <tr>
      <td>{formatDateTime(usage.created_at)}</td>
      <td>
        <strong>{study?.description ?? "AI kullanımı"}</strong>
        <span>
          {study?.modality ?? "-"} · {study?.accession_number ?? "-"}
          {report ? ` · Rapor v${report.version ?? "-"}` : ""}
          {job ? ` · Job ${job.id.slice(0, 8)}` : ""}
        </span>
      </td>
      <td>
        <strong>{formatProviderSlug(usage.provider_slug)}</strong>
        <span>{usage.model_name ?? "-"}</span>
      </td>
      <td>{usageTypeLabel(usage.usage_type)}</td>
      <td>
        <strong>{formatNumber(usage.total_tokens)}</strong>
        <span>
          {formatNumber(usage.input_tokens)} in · {formatNumber(usage.output_tokens)} out
        </span>
      </td>
      <td>{formatMoney(Number(usage.total_cost))}</td>
    </tr>
  )
}

function formatPanelToggle(count: number) {
  return count ? `${count} uyarı` : "Liste"
}

function AiJobTableRow({ job }: { job: AiJobRow }) {
  const study = firstRelation(job.studies)
  const orchestration = getJobOrchestration(job)

  return (
    <tr>
      <td>
        <strong>{study?.description ?? "Tetkik"}</strong>
        <span>
          {study?.modality ?? "-"} · {study?.accession_number ?? "-"}
        </span>
      </td>
      <td>
        {orchestration ? (
          <span className="orchestrator-route-badge">↪ Orchestrator</span>
        ) : null}
        <strong>{formatProviderSlug(job.provider_slug)}</strong>
        <span>
          {job.model_name ?? "-"}
          {orchestration?.routedProviderSlug
            ? ` · route: ${formatProviderSlug(orchestration.routedProviderSlug)}`
            : ""}
        </span>
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

function getJobOrchestration(job: AiJobRow) {
  const context = job.input_context
  if (!context || typeof context !== "object") return null
  const orchestration = context.orchestrator
  if (!orchestration || typeof orchestration !== "object") return null

  const routedProviderSlug =
    "routedProviderSlug" in orchestration && typeof orchestration.routedProviderSlug === "string"
      ? orchestration.routedProviderSlug
      : null
  const providerSlug =
    "providerSlug" in orchestration && typeof orchestration.providerSlug === "string"
      ? orchestration.providerSlug
      : null

  return { providerSlug, routedProviderSlug }
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
        <strong>{job?.provider_slug ? formatProviderSlug(job.provider_slug) : "-"}</strong>
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

function parseUsageRange(query: { from?: string; to?: string }) {
  const today = new Date()
  const defaultFrom = new Date(today)
  defaultFrom.setDate(today.getDate() - 29)

  const fromDate = isDateInput(query.from) ? query.from : toDateInput(defaultFrom)
  const toDate = isDateInput(query.to) ? query.to : toDateInput(today)
  const from = new Date(`${fromDate}T00:00:00.000Z`)
  const to = new Date(`${toDate}T23:59:59.999Z`)

  return {
    fromDate,
    fromIso: from.toISOString(),
    toDate,
    toIso: to.toISOString(),
  }
}

function isDateInput(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

function toDateInput(value: Date) {
  return value.toISOString().slice(0, 10)
}

function summarizeUsage(rows: AiUsageRow[]) {
  const byProvider = new Map<
    string,
    {
      count: number
      inputTokens: number
      modelName: string | null
      outputTokens: number
      providerSlug: string
      totalCost: number
      totalTokens: number
    }
  >()

  for (const row of rows) {
    const key = `${row.provider_slug}:${row.model_name ?? ""}`
    const current =
      byProvider.get(key) ??
      {
        count: 0,
        inputTokens: 0,
        modelName: row.model_name,
        outputTokens: 0,
        providerSlug: row.provider_slug,
        totalCost: 0,
        totalTokens: 0,
      }

    current.count += 1
    current.inputTokens += Number(row.input_tokens)
    current.outputTokens += Number(row.output_tokens)
    current.totalTokens += Number(row.total_tokens)
    current.totalCost += Number(row.total_cost)
    byProvider.set(key, current)
  }

  return Array.from(byProvider.values()).sort((a, b) => b.totalTokens - a.totalTokens)
}

function providerLabel(value: string, slug?: string) {
  if (slug === "qwen") return "Qwen Vision"
  if (slug === "deepseek") return "DeepSeek"
  if (slug === "medgemma") return "MedGemma"
  if (slug === "rai-llm") return "RAI LLM"
  if (slug === "rai-orchestrator") return "RAI AI Orchestrator"
  if (slug === "radialog") return "RaDialog"

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
      return "Custom medikal AI"
  }
}

function formatProviderSlug(slug: string) {
  return `${aiProviderMark({ slug })} ${slug}`
}

function credentialPlaceholder(providerType: string, slug?: string) {
  if (slug === "qwen") return "QWEN_API_KEY"
  if (slug === "deepseek") return "DEEPSEEK_API_KEY"
  if (slug === "medgemma") return "RAI_MEDGEMMA_API_KEY veya RAI_MEDGEMMA_ENDPOINT"
  if (slug === "rai-llm") return "RAI_LLM_API_KEY veya RAI_LLM_ENDPOINT"
  if (slug === "rai-orchestrator") return "Credential gerekmez; aktif providerları route eder"
  if (slug === "radialog") return "RAI_RADIALOG_API_KEY veya RAI_RADIALOG_ENDPOINT"

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

function buildRaiLlmStatus(provider: AiProviderRow | null) {
  const endpoint = process.env.RAI_LLM_ENDPOINT?.trim() || ""
  const apiKeyReady = Boolean(process.env.RAI_LLM_API_KEY?.trim())
  const endpointMode = process.env.RAI_LLM_ENDPOINT_MODE?.trim() || "openai-compatible"
  const model = provider?.default_model || process.env.RAI_LLM_MODEL_ID || "Qwen/Qwen2.5-VL-7B-Instruct"
  const endpointReady = Boolean(endpoint)
  const providerActive = provider?.is_active === true
  const ready = Boolean(provider && providerActive && endpointReady)
  const endpointLabel = endpointReady ? safeEndpointLabel(endpoint) : "RAI_LLM_ENDPOINT tanımlı değil"
  const providerState = provider
    ? providerActive
      ? "Admin AI Servisleri içinde aktif"
      : "Provider var, aktif değil"
    : "Provider otomatik seed bekliyor"
  const setupChecklist = [
    {
      badge: provider ? "Hazır" : "Bekliyor",
      detail: provider
        ? "RAI LLM provider kaydı organizasyon içinde mevcut."
        : "Admin AI Servisleri açıldığında provider otomatik oluşturulur.",
      label: "Provider seed",
      state: provider ? "ok" : "warning",
    },
    {
      badge: providerActive ? "Aktif" : "Bekliyor",
      detail: providerActive
        ? "Viewer içinde seçilebilir durumda."
        : "GPU endpoint hazır olunca provider aktif hale getirilecek.",
      label: "Provider aktivasyonu",
      state: providerActive ? "ok" : "warning",
    },
    {
      badge: "Hazır",
      detail:
        "Cloud Build imajı europe-west4 Artifact Registry üzerinde üretildi: rai-llm:20260629104345.",
      label: "Container image",
      state: "ok",
    },
    {
      badge: endpointReady ? "Hazır" : "Bekliyor",
      detail: endpointReady
        ? "Cloud Run endpoint Vercel ortam değişkenine bağlanmış."
        : "Cloud Run Admin API kotası bekleniyor: Total Nvidia L4 GPU allocation without zonal redundancy, europe-west4, değer 1.",
      label: "GPU endpoint",
      state: endpointReady ? "ok" : "warning",
    },
    {
      badge: endpointReady ? "Hazır" : "Bekliyor",
      detail: endpointReady
        ? "RAI_LLM_ENDPOINT tanımlı."
        : "Kota onayından sonra RAI_LLM_ENDPOINT production env olarak tanımlanacak.",
      label: "Vercel endpoint env",
      state: endpointReady ? "ok" : "warning",
    },
    {
      badge: apiKeyReady ? "Hazır" : "Opsiyonel",
      detail: apiKeyReady
        ? "RAI_LLM_API_KEY tanımlı."
        : "Endpoint public kapatılacaksa RAI_LLM_API_KEY güçlü token ile tanımlanacak.",
      label: "API token",
      state: apiKeyReady ? "ok" : "unknown",
    },
  ]

  return {
    apiKeyState: apiKeyReady ? "Tanımlı" : "Opsiyonel / eksik",
    endpointLabel,
    endpointState: endpointReady ? endpointMode : "Eksik",
    infrastructureLabel: endpointReady
      ? "GPU endpoint Vercel env ile bağlı"
      : "Cloud Run ve Compute GPU kotası onay bekliyor",
    infrastructureState: endpointReady ? "Hazır" : "GPU quota bekliyor",
    model,
    nextStep: ready
      ? "RAI Viewer içinde RAI LLM provider seçilerek ön rapor testi yapılabilir."
      : "Google Cloud üzerinde Cloud Run NVIDIA L4 GPU kotası en az 1 olacak şekilde onaylanmalı. Kota açılınca hazır imaj yeniden deploy edilip Vercel ortamında RAI_LLM_ENDPOINT tanımlanacak.",
    providerLabel: provider?.name || "RAI LLM",
    providerState,
    ready,
    setupChecklist,
    testCommand: endpointReady
      ? [
          "RAI_LLM_ENDPOINT=<masked-endpoint>",
          apiKeyReady ? "RAI_LLM_API_KEY=<defined-secret>" : "RAI_LLM_API_KEY=<optional-token>",
          "npm run test:rai-llm",
        ].join(" \\\n")
      : [
          "# Google Cloud kota talebi",
          "run.googleapis.com/nvidia_l4_gpu_allocation_no_zonal_redundancy",
          "region=europe-west4 value=1",
          "",
          "# Kota onaylanınca",
          "RAI_LLM_ENDPOINT=https://<rai-llm-host>/v1/chat/completions",
          "RAI_LLM_API_KEY=<strong-random-token>",
          "npm run test:rai-llm",
        ].join(" \\\n"),
  }
}

function parseRaiLlmTestResult(query: Awaited<AiServicesPageProps["searchParams"]>) {
  if (!query.raiLlmTest) return null
  return {
    elapsedMs: Number(query.raiLlmMs || 0),
    message: query.raiLlmMessage || "RAI LLM test sonucu alındı.",
    ok: query.raiLlmTest === "ok",
  }
}

function buildQwenStatus(provider: AiProviderRow | null) {
  const endpoint =
    process.env.QWEN_BASE_URL?.trim() ||
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"
  const apiKeyReady = Boolean(process.env.QWEN_API_KEY?.trim())
  const model = provider?.default_model || process.env.QWEN_MODEL || "qwen-vl-max-latest"
  const providerActive = provider?.is_active === true
  const ready = Boolean(provider && providerActive && apiKeyReady)
  const providerState = provider
    ? providerActive
      ? "Admin AI Servisleri içinde aktif"
      : "Provider var, aktif değil"
    : "Provider otomatik seed bekliyor"

  return {
    apiKeyState: apiKeyReady ? "Tanımlı" : "QWEN_API_KEY eksik",
    endpointLabel: safeEndpointLabel(endpoint),
    endpointState: "OpenAI-compatible",
    model,
    nextStep: ready
      ? "RAI Viewer içinde Qwen Vision provider seçilerek görüntülü ön rapor testi yapılabilir."
      : "Alibaba Model Studio üzerinden Qwen API key oluşturup Vercel production env içine QWEN_API_KEY olarak ekleyin; ardından provider aktif hale getirilir.",
    providerLabel: provider?.name || "Qwen Vision",
    providerState,
    ready,
    testCommand: [
      "QWEN_API_KEY=<secret>",
      "QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
      `QWEN_MODEL=${model}`,
      "Admin > AI Servisleri > Qwen canlı test et",
    ].join(" \\\n"),
  }
}

function parseQwenTestResult(query: Awaited<AiServicesPageProps["searchParams"]>) {
  if (!query.qwenTest) return null
  return {
    elapsedMs: Number(query.qwenMs || 0),
    message: query.qwenMessage || "Qwen test sonucu alındı.",
    ok: query.qwenTest === "ok",
  }
}

function buildDeepSeekStatus(provider: AiProviderRow | null) {
  const endpoint =
    process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com/chat/completions"
  const apiKeyReady = Boolean(process.env.DEEPSEEK_API_KEY?.trim())
  const model = provider?.default_model || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"
  const providerActive = provider?.is_active === true
  const ready = Boolean(provider && providerActive && apiKeyReady)
  const providerState = provider
    ? providerActive
      ? "Admin AI Servisleri içinde aktif"
      : "Provider var, aktif değil"
    : "Provider otomatik seed bekliyor"

  return {
    apiKeyState: apiKeyReady ? "Tanımlı" : "DEEPSEEK_API_KEY eksik",
    endpointLabel: safeEndpointLabel(endpoint),
    endpointState: "OpenAI-compatible",
    model,
    nextStep: ready
      ? "RAI Viewer içinde DeepSeek provider seçilerek metadata/rapor metni odaklı ön rapor testi yapılabilir."
      : "DeepSeek API key oluşturup Vercel production env içine DEEPSEEK_API_KEY olarak ekleyin; ardından provider aktif hale getirilir.",
    providerLabel: provider?.name || "DeepSeek",
    providerState,
    ready,
    testCommand: [
      "DEEPSEEK_API_KEY=<secret>",
      "DEEPSEEK_BASE_URL=https://api.deepseek.com/chat/completions",
      `DEEPSEEK_MODEL=${model}`,
      "Admin > AI Servisleri > DeepSeek canlı test et",
    ].join(" \\\n"),
  }
}

function parseDeepSeekTestResult(query: Awaited<AiServicesPageProps["searchParams"]>) {
  if (!query.deepSeekTest) return null
  return {
    elapsedMs: Number(query.deepSeekMs || 0),
    message: query.deepSeekMessage || "DeepSeek test sonucu alındı.",
    ok: query.deepSeekTest === "ok",
  }
}

function safeEndpointLabel(value: string) {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return "Endpoint formatı okunamadı"
  }
}

async function ensureRaiLlmProvider(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  userId: string
) {
  const { data: existing, error: existingError } = await supabase
    .from("ai_service_providers")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("slug", "rai-llm")
    .maybeSingle()

  if (existing) return
  if (existingError) {
    if (isMissingAiTableError(existingError)) return
    throw new Error(`RAI LLM sağlayıcı kontrolü yapılamadı: ${existingError.message}`)
  }

  const { error } = await supabase.from("ai_service_providers").insert({
    organization_id: organizationId,
    created_by: userId,
    credential_reference: "RAI_LLM_ENDPOINT",
    default_model: "Qwen/Qwen2.5-VL-7B-Instruct",
    is_active: false,
    is_default: false,
    name: "RAI LLM",
    provider_type: "custom",
    requires_credentials: true,
    settings: {
      apiKeyEnv: "RAI_LLM_API_KEY",
      baseLicense: "apache-2.0",
      baseModel: "Qwen/Qwen2.5-VL-7B-Instruct",
      deployment: "self-hosted-openai-compatible-endpoint",
      endpointEnv: "RAI_LLM_ENDPOINT",
      endpointModeEnv: "RAI_LLM_ENDPOINT_MODE",
      family: "rai-llm",
      modalities: ["DX", "CT", "MR", "US", "SR"],
      purpose: "rai-owned-medical-vlm-report-draft",
      supportedEndpointModes: ["openai-compatible", "rai-adapter"],
    },
    slug: "rai-llm",
  })

  if (error && error.code !== "23505") {
    throw new Error(`RAI LLM sağlayıcısı oluşturulamadı: ${error.message}`)
  }
}

async function ensureRaiAiOrchestratorProvider(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  userId: string
) {
  const { data: existing, error: existingError } = await supabase
    .from("ai_service_providers")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("slug", "rai-orchestrator")
    .maybeSingle()

  if (existing) return
  if (existingError) {
    if (isMissingAiTableError(existingError)) return
    throw new Error(`RAI AI Orchestrator sağlayıcı kontrolü yapılamadı: ${existingError.message}`)
  }

  const { error } = await supabase.from("ai_service_providers").insert({
    organization_id: organizationId,
    created_by: userId,
    credential_reference: null,
    default_model: "rai-ai-orchestrator-v0",
    is_active: true,
    is_default: false,
    name: "RAI AI Orchestrator",
    provider_type: "custom",
    requires_credentials: false,
    settings: {
      fallbackPolicy: "first-active-runnable-provider",
      family: "rai-ai-orchestrator",
      priority: ["rai-llm", "qwen", "openai", "gemini-google", "claude", "medgemma", "rai-mock"],
      purpose: "route-ai-pre-report-to-best-available-provider",
      routerVersion: "v0",
    },
    slug: "rai-orchestrator",
  })

  if (error && error.code !== "23505") {
    throw new Error(`RAI AI Orchestrator sağlayıcısı oluşturulamadı: ${error.message}`)
  }
}

async function ensureQwenProvider(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  userId: string
) {
  const { data: existing, error: existingError } = await supabase
    .from("ai_service_providers")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("slug", "qwen")
    .maybeSingle()

  if (existing) return
  if (existingError) {
    if (isMissingAiTableError(existingError)) return
    throw new Error(`Qwen sağlayıcı kontrolü yapılamadı: ${existingError.message}`)
  }

  const { error } = await supabase.from("ai_service_providers").insert({
    organization_id: organizationId,
    created_by: userId,
    credential_reference: "QWEN_API_KEY",
    default_model: "qwen-vl-max-latest",
    is_active: false,
    is_default: false,
    name: "Qwen Vision",
    provider_type: "custom",
    requires_credentials: true,
    settings: {
      availableModels: ["qwen-vl-max-latest", "qwen-vl-plus-latest"],
      baseUrlEnv: "QWEN_BASE_URL",
      defaultBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
      deployment: "alibaba-model-studio-openai-compatible",
      family: "qwen-vl",
      modalities: ["DX", "CT", "MR", "US", "SR"],
      modelEnv: "QWEN_MODEL",
      purpose: "vision-language-radiology-pre-report-draft",
    },
    slug: "qwen",
  })

  if (error && error.code !== "23505") {
    throw new Error(`Qwen sağlayıcısı oluşturulamadı: ${error.message}`)
  }
}

async function ensureDeepSeekProvider(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  userId: string
) {
  const { data: existing, error: existingError } = await supabase
    .from("ai_service_providers")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("slug", "deepseek")
    .maybeSingle()

  if (existing) return
  if (existingError) {
    if (isMissingAiTableError(existingError)) return
    throw new Error(`DeepSeek sağlayıcı kontrolü yapılamadı: ${existingError.message}`)
  }

  const { error } = await supabase.from("ai_service_providers").insert({
    organization_id: organizationId,
    created_by: userId,
    credential_reference: "DEEPSEEK_API_KEY",
    default_model: "deepseek-v4-flash",
    is_active: false,
    is_default: false,
    name: "DeepSeek",
    provider_type: "custom",
    requires_credentials: true,
    settings: {
      availableModels: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
      baseUrlEnv: "DEEPSEEK_BASE_URL",
      defaultBaseUrl: "https://api.deepseek.com/chat/completions",
      deployment: "deepseek-openai-compatible",
      family: "deepseek",
      modelEnv: "DEEPSEEK_MODEL",
      modalities: ["SR", "DX", "CT", "MR", "US"],
      purpose: "radiology-report-reasoning-quality-control",
    },
    slug: "deepseek",
  })

  if (error && error.code !== "23505") {
    throw new Error(`DeepSeek sağlayıcısı oluşturulamadı: ${error.message}`)
  }
}

function jobStatusClass(status: string) {
  if (status === "draft_ready") return "ok"
  if (status === "failed") return "error"
  if (status === "waiting_credentials" || status === "endpoint_waking") return "warning"
  return "unknown"
}

function jobStatusLabel(status: string) {
  switch (status) {
    case "draft_ready":
      return "Ön rapor hazır"
    case "waiting_credentials":
      return "Hesap bekliyor"
    case "endpoint_waking":
      return "Endpoint uyanıyor"
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

function formatNumber(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value)
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    currency: "USD",
    maximumFractionDigits: 6,
    minimumFractionDigits: value > 0 && value < 0.01 ? 6 : 2,
    style: "currency",
  }).format(value)
}

function usageTypeLabel(value: string) {
  switch (value) {
    case "pre_report":
      return "Ön rapor"
    case "report_edit":
      return "Rapor düzenleme"
    case "final_report":
      return "Nihai rapor"
    case "admin_test":
      return "Admin test"
    default:
      return value
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value))
}
