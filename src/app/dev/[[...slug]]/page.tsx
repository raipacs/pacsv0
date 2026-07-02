import type { Metadata } from "next"
import type { ReactNode } from "react"

import { DevDocsSearch } from "./DevDocsSearch"

export const metadata: Metadata = {
  title: "Developer Docs",
  description: "RAI PACS teknik dokumantasyon, API referansi ve surum notlari.",
}

const guideCards = [
  {
    title: "Mimari",
    text: "Metadata PostgreSQL'de, orijinal DICOM nesneleri Supabase Storage dicom-originals bucket'inda saklanir.",
    href: "#architecture",
  },
  {
    title: "DICOM Gateway",
    text: "Modaliteler C-STORE ile gateway'e gelir; Orthanc gateway katmani RAI metadata ve Storage import akisina baglanir.",
    href: "#dicom-gateway",
  },
  {
    title: "Viewer",
    text: "RAI Viewer hizli preview, cache, frame kontrolu ve OHIF yeni sekme koprusuyle birlikte calisir.",
    href: "#viewer",
  },
  {
    title: "AI Raporlama",
    text: "OpenAI, Claude, Gemini, MedGemma ve RAI LLM adaptorlari ayni AI job ve draft rapor modelinde toplanir.",
    href: "#ai",
  },
]

const apiRows = [
  {
    method: "GET",
    path: "/viewer-data/studies/:studyId",
    scope: "OHIF dicomjson metadata",
    auth: "Signed launch token",
  },
  {
    method: "GET/HEAD",
    path: "/viewer-data/instances/:instanceId",
    scope: "Range destekli DICOM instance proxy",
    auth: "Signed launch token",
  },
  {
    method: "GET",
    path: "/dicomweb/studies",
    scope: "QIDO-RS study arama",
    auth: "RAI oturumu veya Bearer launch token",
  },
  {
    method: "GET",
    path: "/dicomweb/studies/:studyUid/series",
    scope: "QIDO-RS series arama",
    auth: "RAI oturumu veya Bearer launch token",
  },
  {
    method: "GET",
    path: "/dicomweb/studies/:studyUid/series/:seriesUid/instances",
    scope: "QIDO-RS instance arama",
    auth: "RAI oturumu veya Bearer launch token",
  },
  {
    method: "GET/HEAD",
    path: "/dicomweb/studies/:studyUid/series/:seriesUid/instances/:sopUid",
    scope: "WADO-RS raw DICOM instance retrieve",
    auth: "RAI oturumu veya Bearer launch token",
  },
  {
    method: "GET",
    path: "/viewer-data/ohif-session",
    scope: "OHIF icin hasta bazli coklu tetkik dicomjson manifesti",
    auth: "Signed multi-study launch token",
  },
  {
    method: "POST",
    path: "/api/share",
    scope: "Sureli harici paylasim linki",
    auth: "RAI oturumu",
  },
  {
    method: "GET",
    path: "/api/share/:token veya /share?s=:id",
    scope: "Paylasim onizleme ve OHIF acilis",
    auth: "Sureli share token",
  },
  {
    method: "GET/POST",
    path: "/api/jobs/ai-provider-health",
    scope: "Gunluk AI provider saglik testi ve e-posta raporu",
    auth: "Vercel Cron Bearer token",
  },
]

const dataTables = [
  ["organizations", "Tenant/konsolidasyon siniri"],
  ["branches", "Merkez, Dev, Kosova gibi sube ayrimi"],
  ["organization_members", "Kullanici rol ve varsayilan sube"],
  ["organization_member_branches", "Kullanici bazli sube yetkisi"],
  ["patients", "Hasta demografi ve HIS kaynak alanlari"],
  ["studies / series / instances", "DICOM metadata hiyerarsisi"],
  ["reports", "Taslak ve nihai radyoloji raporlari"],
  ["ai_service_providers / ai_jobs", "AI servis secimi ve is kuyrugu"],
  ["ai_usage_events", "Token ve maliyet raporlama"],
  ["external_study_shares", "Sureli guvenli paylasim linkleri"],
]

const searchItems = [
  {
    category: "Architecture",
    title: "Cift katmanli PACS veri ayrimi",
    text: "PostgreSQL metadata, Supabase Storage DICOM nesneleri, tenant ve sube ayrimi.",
    href: "#architecture",
  },
  {
    category: "DICOM",
    title: "DICOM Gateway baglanti bilgileri",
    text: "dicom.raipacs.com, port 4242, AE Title RAIPACS, C-STORE ve C-ECHO.",
    href: "#dicom-gateway",
  },
  {
    category: "Viewer",
    title: "RAI Viewer ve OHIF koprusu",
    text: "Scroll, window level, cache, preview, privacy mode, OHIF yeni sekme.",
    href: "#viewer",
  },
  {
    category: "API",
    title: "Viewer data ve share API",
    text: "Signed launch token, Range destekli instance proxy, sureli paylasim linkleri.",
    href: "#api-reference",
  },
  {
    category: "Database",
    title: "Ana tablo ve sorumluluklar",
    text: "organizations, branches, patients, studies, reports, ai_jobs ve share tablolari.",
    href: "#data-model",
  },
  {
    category: "AI",
    title: "AI servisleri ve on rapor akisi",
    text: "OpenAI, Claude, Gemini, MedGemma, RAI LLM, RaDialog, token ve maliyet izleme.",
    href: "#ai",
  },
  {
    category: "HIS",
    title: "HIS / RIS entegrasyon modeli",
    text: "HL7, REST, modality worklist, vendor tanimlari ve test aksiyonlari.",
    href: "#his",
  },
  {
    category: "Operations",
    title: "Operasyon runbook",
    text: "DICOM import, Orthanc sync, gateway loglari ve importer hesabi.",
    href: "#operations",
  },
  {
    category: "Changelog",
    title: "Surum notlari",
    text: "RAI PACS gelistirme tarihcesi ve versiyon notlari.",
    href: "#changelog",
  },
]

const changelog = [
  {
    date: "2026-07-02",
    version: "0.2.0-dev.17",
    title: "DICOMweb read-only API katmani baslatildi",
    items: [
      "RAI metadata ve Supabase Storage uzerinden QIDO-RS study, series ve instance arama endpointleri eklendi.",
      "WADO-RS metadata ve raw DICOM instance retrieve endpointleri RAI oturumu veya signed launch token ile calisir hale getirildi.",
      "Frame-level WADO-RS ve self-host OHIF datasource baglantisi bir sonraki faza ayrildi.",
    ],
  },
  {
    date: "2026-07-02",
    version: "0.2.0-dev.16",
    title: "OHIF hasta oturumu ve DICOMweb yol haritasi",
    items: [
      "RAI Viewer icine tek tetkik OHIF linkine ek olarak hasta bazli coklu tetkik OHIF oturumu eklendi.",
      "Signed launch token artik tek study veya study-session kapsaminda birden fazla study tasiyabilir.",
      "Uzun vadeli self-host OHIF + DICOMweb gecisi icin operasyon yol haritasi dokumante edildi.",
    ],
  },
  {
    date: "2026-07-02",
    version: "0.2.0-dev.15",
    title: "AI provider saglik cron job'u eklendi",
    items: [
      "Vercel Cron her gun Turkiye saatiyle 09:00'da aktif AI provider'lari test eder.",
      "OpenAI, Claude, Gemini, Qwen, DeepSeek, MedGemma, RAI LLM ve RAI AI Orchestrator saglik sonucu support@raipacs.com adresine gonderilecek sekilde hazirlandi.",
      "Qwen varsayilan modeli qwen-vl-max olarak guncellendi; eski latest model adlari runtime'da normalize edilir.",
    ],
  },
  {
    date: "2026-06-29",
    version: "0.2.0-dev.14",
    title: "RAI AI Orchestrator ve RAI LLM checklist eklendi",
    items: [
      "Admin AI Servisleri ekranina RAI LLM kurulum checklist'i eklendi.",
      "RAI AI Orchestrator provider'i aktif olarak seed edilir ve manuel AI butonunda secilebilir.",
      "Orchestrator RAI LLM, OpenAI, Gemini, Claude, MedGemma ve RAI Mock sirasiyla calisabilir provider'a route eder.",
    ],
  },
  {
    date: "2026-06-29",
    version: "0.2.0-dev.13",
    title: "RAI LLM GPU quota on kosulu netlestirildi",
    items: [
      "Cloud Run L4 GPU deploy script'i no-zonal-redundancy parametresiyle kalici hale getirildi.",
      "Google Cloud Run NVIDIA L4 GPU kotasi 0 oldugunda deploy'un duracagi ve quota talebi gerektigi dokumante edildi.",
      "RAI LLM runbook'u Cloud Run GPU quota kontrolu ve Vercel aktivasyon adimlariyla guncellendi.",
    ],
  },
  {
    date: "2026-06-29",
    version: "0.2.0-dev.12",
    title: "RAI LLM Vercel aktivasyon script'i eklendi",
    items: [
      "Cloud Run deploy sonrasinda endpoint ve token degerlerini rai-llm-vercel.env dosyasina yazan akis eklendi.",
      "RAI LLM production env degerlerini Vercel'e tek komutla gecmek icin npm run configure:rai-llm:vercel script'i eklendi.",
      "RAI LLM canli kullanim icin Cloud Run GPU endpoint, Vercel env ve Admin canli test adimlari netlestirildi.",
    ],
  },
  {
    date: "2026-06-29",
    version: "0.2.0-dev.11",
    title: "RAI LLM Cloud Run GPU deploy script'i eklendi",
    items: [
      "RAI LLM icin Google Cloud Run Gen2 + NVIDIA L4 GPU deploy script'i hazirlandi.",
      "Artifact Registry build, Cloud Run deploy ve endpoint smoke-test akisi tek runbook'a baglandi.",
      "Servis public HTTPS endpoint verir; erisim Bearer token ile uygulama icinde sinirlanir.",
    ],
  },
  {
    date: "2026-06-28",
    version: "0.2.0-dev.10",
    title: "RAI LLM operasyon durumu Admin ekranina eklendi",
    items: [
      "Admin AI Servisleri ekraninda RAI LLM provider, model, endpoint ve API token hazirlik durumu gosterilir.",
      "Endpoint degeri maskeli gosterilir; secret degerleri UI'da aciga cikmaz.",
      "Canli GPU endpoint hazir oldugunda kullanilacak smoke-test komutu ayni panelde yer alir.",
    ],
  },
  {
    date: "2026-06-28",
    version: "0.2.0-dev.9",
    title: "RAI LLM endpoint test ve operasyon runbook'u eklendi",
    items: [
      "RAI LLM OpenAI-compatible endpoint icin npm run test:rai-llm smoke-test komutu eklendi.",
      "GPU endpoint kurulumu, Vercel env tanimlari ve canli test adimlari dokumante edildi.",
      "Endpoint hazir oldugunda RAI Viewer AI akisi ayni provider uzerinden test edilebilir hale geldi.",
    ],
  },
  {
    date: "2026-06-28",
    version: "0.2.0-dev.8",
    title: "RAI LLM self-hosted model hatti baslatildi",
    items: [
      "RAI LLM provider seed'i ve RAI_LLM_ENDPOINT entegrasyonu eklendi.",
      "Admin AI Servisleri sayfasi RAI LLM provider eksikse otomatik olusturur.",
      "Qwen/Qwen2.5-VL-7B-Instruct tabanli OpenAI-compatible inference servisi hazirlandi.",
      "RAI LLM modeli ileride RAI radyoloji veri setleriyle fine-tune edilebilir hat olarak konumlandi.",
    ],
  },
  {
    date: "2026-06-28",
    version: "0.2.0-dev.7",
    title: "Developer portal yayina hazirlandi",
    items: [
      "dev.raipacs.com host'u public teknik dokumantasyon sayfasina rewrite edilir.",
      "Mimari, API, DICOM, AI, HIS ve operasyon notlari tek portalda toplandi.",
      "Surum notlari icin RAI gelistirme akisi baslatildi.",
    ],
  },
  {
    date: "2026-06-28",
    version: "0.2.0-dev.6",
    title: "Admin kullanici ve sube yetkileri",
    items: [
      "Kullanici yonetimi acilir bloklara ve filtrelenebilir tabloya tasindi.",
      "Dev ve Kosova subeleri olusturuldu; Admin varsayilan subesi Dev yapildi.",
      "organization_member_branches ile kullanici bazli sube yetkisi eklendi.",
    ],
  },
  {
    date: "2026-06-28",
    version: "0.2.0-dev.5",
    title: "Rapor taslaklari ve AI goruntu onizleme",
    items: [
      "Ayni tetkik uzerinde birden fazla taslak rapor kaydi desteklendi.",
      "DICOM preview verileri AI servislerine tasinabilir hale getirildi.",
      "Gorunur hata mesajlarina kopyalama kontrolu eklendi.",
    ],
  },
  {
    date: "2026-06-27",
    version: "0.2.0-dev.4",
    title: "MedGemma ve tibbi AI presetleri",
    items: [
      "MedGemma endpoint adapter, retry ve cold-start toleransi eklendi.",
      "OpenAI, Claude, Gemini, MedGemma ve RaDialog provider secenekleri ayni modelde toplandi.",
      "AI provider hata durumlari viewer icinde daha acik gosterilmeye baslandi.",
    ],
  },
  {
    date: "2026-06-24",
    version: "0.2.0-dev.3",
    title: "Harici paylasim ve AI token raporlama",
    items: [
      "Sureli guvenli paylasim linkleri eklendi.",
      "AI token tuketimi provider, model, rapor ve tarih araligi bazinda izlenebilir oldu.",
      "OHIF icin viewer-data koprusu daha kararli hale getirildi.",
    ],
  },
  {
    date: "2026-06-23",
    version: "0.2.0-dev.2",
    title: "DICOM Server ve HIS yonetimi",
    items: [
      "DICOM modalite, gateway sagligi, baglanti loglari ve import kuyrugu Admin paneline eklendi.",
      "HIS entegrasyon tanimlari, mesaj tipleri ve test aksiyonlari icin arayuz hazirlandi.",
      "Branch ve modality matching temeli kuruldu.",
    ],
  },
  {
    date: "2026-06-18",
    version: "0.2.0-dev.1",
    title: "RAI PACS MVP veri modeli",
    items: [
      "Hasta, tetkik, seri, instance, rapor ve audit tablolarindan olusan temel PACS semasi olusturuldu.",
      "Turkce karakter desteği, Supabase Storage ve DICOM import akisi MVP'ye alindi.",
      "RAI Viewer ve OHIF koprusu ilk calisan surume geldi.",
    ],
  },
]

export default function DevDocsPage() {
  return (
    <main className="dev-docs-page">
      <nav className="dev-docs-topbar" aria-label="Developer navigation">
        <a className="dev-docs-brand" href="#top">
          <span>RAI</span>
          <strong>Developer</strong>
        </a>
        <div>
          <a href="#guides">Guides</a>
          <a href="#api-reference">API Reference</a>
          <a href="#operations">Operations</a>
          <a href="#changelog">Changelog</a>
        </div>
      </nav>

      <section className="dev-docs-hero" id="top">
        <div>
          <p className="eyebrow">RAI PACS Developer Platform</p>
          <h1>Bulut PACS, DICOM gateway ve AI raporlama icin teknik merkez.</h1>
          <p>
            dev.raipacs.com; RAI PACS mimarisi, entegrasyon yuzeyleri, DICOM
            aktarim bilgileri, AI servisleri ve surum notlari icin canli
            dokumantasyon alanidir.
          </p>
          <DevDocsSearch items={searchItems} />
        </div>
        <aside className="dev-docs-status" aria-label="Platform durumu">
          <strong>Current snapshot</strong>
          <span>0.2.0 MVP</span>
          <small>Son guncelleme: 2 Temmuz 2026</small>
          <dl>
            <div>
              <dt>App</dt>
              <dd>app.raipacs.com</dd>
            </div>
            <div>
              <dt>DICOM</dt>
              <dd>dicom.raipacs.com:4242</dd>
            </div>
            <div>
              <dt>Docs</dt>
              <dd>dev.raipacs.com</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="dev-docs-section" id="guides">
        <div className="dev-docs-section-heading">
          <p className="eyebrow">Guides</p>
          <h2>Baslangic noktasi</h2>
        </div>
        <div className="dev-docs-card-grid">
          {guideCards.map((card) => (
            <a className="dev-docs-card" href={card.href} key={card.title}>
              <span>{card.title}</span>
              <p>{card.text}</p>
            </a>
          ))}
        </div>
      </section>

      <section className="dev-docs-layout">
        <aside className="dev-docs-sidebar">
          <strong>Dokuman haritasi</strong>
          <a href="#architecture">Mimari</a>
          <a href="#dicom-gateway">DICOM Gateway</a>
          <a href="#viewer">Viewer</a>
          <a href="#api-reference">API Reference</a>
          <a href="#data-model">Veri modeli</a>
          <a href="#ai">AI servisleri</a>
          <a href="#his">HIS entegrasyonu</a>
          <a href="#operations">Operasyon</a>
          <a href="#changelog">Changelog</a>
        </aside>

        <div className="dev-docs-content">
          <DocBlock
            eyebrow="Architecture"
            id="architecture"
            title="Cift katmanli PACS veri ayrimi"
          >
            <p>
              RAI PACS metadata ve buyuk DICOM nesnelerini ayirir. PostgreSQL;
              organizasyon, sube, hasta, tetkik, seri, instance, rapor, audit ve
              yetki metadata bilgisini tutar. Supabase Storage ise orijinal DICOM
              dosyalarini private <code>dicom-originals</code> bucket alaninda saklar.
            </p>
            <div className="dev-docs-flow">
              <span>Modalite</span>
              <span>DICOM Gateway</span>
              <span>Storage</span>
              <span>Metadata DB</span>
              <span>RAI Viewer / OHIF</span>
            </div>
            <pre>{`Storage key:
{organization_id}/{study_instance_uid}/{series_instance_uid}/{sop_instance_uid}.dcm`}</pre>
          </DocBlock>

          <DocBlock eyebrow="DICOM" id="dicom-gateway" title="DICOM Gateway baglanti bilgileri">
            <div className="dev-docs-kv">
              <div>
                <dt>Host</dt>
                <dd>dicom.raipacs.com</dd>
              </div>
              <div>
                <dt>Port</dt>
                <dd>4242</dd>
              </div>
              <div>
                <dt>Called AE Title</dt>
                <dd>RAIPACS</dd>
              </div>
              <div>
                <dt>Protocol</dt>
                <dd>DICOM C-STORE, C-ECHO/Verify</dd>
              </div>
            </div>
            <p>
              Modalite kaynak AE Title, kaynak IP, Called AE ve opsiyonel
              kurulus/sube kodu ile eslestirilir. Gelisen canli kurulumda once
              serbest erisim, hastane canli gecisinde IP veya ulke bazli
              firewall kisitlamasi uygulanir.
            </p>
          </DocBlock>

          <DocBlock eyebrow="Viewer" id="viewer" title="RAI Viewer ve OHIF koprusu">
            <p>
              RAI Viewer radyolog icin ana is istasyonudur. Scroll, pan,
              window/level, zoom, fit, frame ok tuslari, seri paneli,
              preview/liste modu, privacy mode ve AI on rapor paneli birlikte
              calisir. OHIF yeni sekme, harici OHIF viewer ile dicomjson
              entegrasyonu icin korunur.
            </p>
            <ul>
              <li>Frame cache ve preview katmani viewer performansini hizlandirir.</li>
              <li>Renkli US gibi farkli fotometrik yorumlar desteklenir.</li>
              <li>OHIF hasta oturumu ayni hastanin son tetkiklerini tek dicomjson manifestinde acar.</li>
              <li>Harici paylasim linkleri privacy mode on varsayimi ile calisir.</li>
            </ul>
            <p>
              Faz 2 hedefi self-host OHIF ve DICOMweb endpoint olarak planlanir. Bu fazda
              public viewer.ohif.org bagimliligi kalkar; QIDO-RS, WADO-RS ve
              STOW-RS servisleri RAI domainleri altinda sunulur.
            </p>
            <pre>{`GET /dicomweb/studies
GET /dicomweb/studies/{StudyInstanceUID}/series
GET /dicomweb/studies/{StudyInstanceUID}/series/{SeriesInstanceUID}/instances
GET /dicomweb/studies/{StudyInstanceUID}/metadata`}</pre>
          </DocBlock>

          <DocBlock eyebrow="API" id="api-reference" title="Public ve signed teknik yuzeyler">
            <div className="dev-docs-table">
              <table>
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Path</th>
                    <th>Kapsam</th>
                    <th>Yetki</th>
                  </tr>
                </thead>
                <tbody>
                  {apiRows.map((row) => (
                    <tr key={`${row.method}-${row.path}`}>
                      <td>
                        <code>{row.method}</code>
                      </td>
                      <td>
                        <code>{row.path}</code>
                      </td>
                      <td>{row.scope}</td>
                      <td>{row.auth}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              DICOM instance proxy <code>Range</code> headerlarini upstream
              Storage signed URL tarafina tasir. OHIF CORS yalnizca viewer.ohif.org
              icin aciktir; RAI Viewer dahili signed URL akisini kullanir.
            </p>
          </DocBlock>

          <DocBlock eyebrow="Database" id="data-model" title="Ana tablo ve sorumluluklar">
            <div className="dev-docs-table compact">
              <table>
                <tbody>
                  {dataTables.map(([name, note]) => (
                    <tr key={name}>
                      <td>
                        <code>{name}</code>
                      </td>
                      <td>{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DocBlock>

          <DocBlock eyebrow="AI" id="ai" title="AI servisleri ve on rapor akisi">
            <p>
              AI islemi viewer icinden manuel baslatilir. Secilen provider{" "}
              <code>ai_jobs</code> kaydi olusturur, tetkik metadata verisi ve
              hazirlanan goruntu onizlemeleri provider adapter katmanina tasinir,
              sonuc <code>ai_report_drafts</code> icinde saklanir.
            </p>
            <div className="dev-docs-card-grid small">
              <article>OpenAI / GPT-5.5</article>
              <article>Claude</article>
              <article>Gemini</article>
              <article>Qwen Vision</article>
              <article>DeepSeek</article>
              <article>MedGemma endpoint</article>
              <article>RAI LLM self-hosted</article>
              <article>RAI AI Orchestrator</article>
              <article>RaDialog preset</article>
            </div>
            <p>
              Token ve maliyet izleme <code>ai_usage_events</code> tablosu
              uzerinden Admin AI Servisleri ekraninda tarih araligi, provider,
              model ve rapor bazinda gosterilir.
            </p>
          </DocBlock>

          <DocBlock eyebrow="HIS" id="his" title="HIS / RIS entegrasyon modeli">
            <p>
              HIS tanimlari Admin panelinden sube bazli tutulur. HL7, REST ve
              planlanan DICOM Modality Worklist akislari icin vendor, protokol,
              mesaj tipleri, auth tipi ve test sonuc alanlari hazirdir.
            </p>
            <ul>
              <li>Hasta demografi alanlari HIS kaynak kimlikleriyle genisletildi.</li>
              <li>HIS kaynak alanlari yalnizca Admin grubunda gorunur.</li>
              <li>Sube ve tenant ayrimi tek organizasyon icinde baslatildi.</li>
            </ul>
          </DocBlock>

          <DocBlock eyebrow="Operations" id="operations" title="Operasyon runbook">
            <div className="dev-docs-card-grid small">
              <article>DICOM import: browser upload veya guvenli importer script</article>
              <article>Importer hesabi: import penceresi disinda pasif tutulur</article>
              <article>Gateway loglari: Admin DICOM Server panelinde izlenir</article>
              <article>AI provider health: Vercel Cron 09:00 TR, Resend e-posta raporu</article>
              <article>Harici paylasim: sureli token ve privacy mode on</article>
            </div>
            <pre>{`npm run import:dicom-folder
npm run sync:orthanc-events
npm run sync:orthanc-logs`}</pre>
          </DocBlock>

          <section className="dev-docs-changelog" id="changelog">
            <div className="dev-docs-section-heading">
              <p className="eyebrow">Changelog</p>
              <h2>Surum notlari</h2>
            </div>
            {changelog.map((entry) => (
              <article className="dev-docs-release" key={`${entry.date}-${entry.version}`}>
                <div>
                  <time>{entry.date}</time>
                  <span>{entry.version}</span>
                </div>
                <section>
                  <h3>{entry.title}</h3>
                  <ul>
                    {entry.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              </article>
            ))}
          </section>
        </div>
      </section>
    </main>
  )
}

function DocBlock({
  children,
  eyebrow,
  id,
  title,
}: {
  children: ReactNode
  eyebrow: string
  id: string
  title: string
}) {
  return (
    <section className="dev-docs-block" id={id}>
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {children}
    </section>
  )
}
