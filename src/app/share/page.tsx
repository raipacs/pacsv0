import { CopyErrorButton } from "@/components/copy-error-button"
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
    <main className="external-share-page external-share-error-page">
      <section className="data-panel viewer-error-panel">
        <div>
          <p className="eyebrow">RAI PACS güvenli paylaşım</p>
          <h1>{data.study.description}</h1>
          <p>
            {data.study.patientName
              ? maskPatientName(data.study.patientName)
              : "Hasta bilgisi yok"}{" "}
            · {maskPatientId(data.study.patientNumber)} · {data.study.modality} ·{" "}
            {data.study.accessionNumber}
          </p>
          <p className="external-share-expiry">
            Link geçerlilik bitişi: {formatExpiry(data.expiresAt)}
          </p>
        </div>
        <div className="form-actions">
          <a
            className="button primary"
            href={data.ohifViewerUrl}
            rel="noreferrer"
            target="_blank"
          >
            Görüntüyü aç
          </a>
        </div>
      </section>
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
        <div className="empty-state-with-copy">
          <p className="empty-state">{message}</p>
          <CopyErrorButton text={message} />
        </div>
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

function maskPatientName(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => maskToken(part, 1))
    .join(" ")
}

function maskPatientId(value: string) {
  return maskToken(value, 2)
}

function maskToken(value: string, visibleEdge: number) {
  const chars = Array.from(value.trim())
  if (chars.length <= visibleEdge * 2) return value

  const first = chars.slice(0, visibleEdge).join("")
  const last = chars.slice(-visibleEdge).join("")
  const maskedLength = Math.min(6, Math.max(2, chars.length - visibleEdge * 2))
  return `${first}${"*".repeat(maskedLength)}${last}`
}
