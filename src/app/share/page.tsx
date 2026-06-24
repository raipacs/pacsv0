import { RaiDicomViewer } from "@/components/rai-dicom-viewer"
import { getShareViewerData, type ShareViewerData } from "@/lib/share-response"

export const metadata = { title: "RAI PACS Paylaşım" }

type SharePageProps = {
  searchParams?: Promise<{ s?: string; token?: string }>
}

export default async function ExternalShareQueryPage({ searchParams }: SharePageProps) {
  const params = (await searchParams) ?? {}
  const result = await getShareViewerData({
    shareId: params.s ?? "",
    token: params.token ?? "",
  })

  if (!result.ok) {
    return <ShareError message={result.error} />
  }

  return <SharedViewer data={result.data} />
}

function SharedViewer({ data }: { data: ShareViewerData }) {
  return (
    <main className="external-share-page">
      <header className="rai-viewer-bar external-share-bar">
        <div>
          <p className="eyebrow">RAI PACS güvenli paylaşım</p>
          <h1>{data.study.description}</h1>
          <p>
            {data.study.patientName || "Hasta bilgisi yok"} · {data.study.patientNumber} ·{" "}
            {data.study.modality} · {data.study.accessionNumber}
          </p>
          <p className="external-share-expiry">
            Link geçerlilik bitişi: {formatExpiry(data.expiresAt)}
          </p>
        </div>
        <nav aria-label="Paylaşım viewer navigasyonu">
          <a
            className="button primary"
            href={data.ohifViewerUrl}
            rel="noreferrer"
            target="_blank"
          >
            OHIF yeni sekme
          </a>
        </nav>
      </header>
      <RaiDicomViewer
        instances={data.instances}
        shareToken={data.shareToken}
        study={data.study}
        studyId={data.studyId}
      />
    </main>
  )
}

function ShareError({ message }: { message: string }) {
  return (
    <main className="external-share-page external-share-error-page">
      <section className="data-panel viewer-error-panel">
        <div className="panel-heading">
          <h1>Paylaşım açılamadı</h1>
        </div>
        <p className="empty-state">{message}</p>
      </section>
    </main>
  )
}

function formatExpiry(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value))
}
