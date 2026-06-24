"use client"

import { useEffect, useState } from "react"

import { RaiDicomViewer } from "@/components/rai-dicom-viewer"

type SharedViewerData = {
  expiresAt: string
  instances: React.ComponentProps<typeof RaiDicomViewer>["instances"]
  ohifViewerUrl: string
  shareToken: string
  study: React.ComponentProps<typeof RaiDicomViewer>["study"]
  studyId: string
}

export function ExternalShareViewer({ token: initialToken = "" }: { token?: string }) {
  const [data, setData] = useState<SharedViewerData | null>(null)
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const token =
      initialToken || new URLSearchParams(window.location.search).get("token") || ""

    async function loadShare() {
      setIsLoading(true)
      setError("")

      try {
        if (!token) {
          throw new Error("Paylaşım token bulunamadı.")
        }

        const url = new URL("/api/share", window.location.origin)
        url.searchParams.set("token", token)
        const response = await fetch(url.toString(), {
          cache: "no-store",
        })
        const payload = (await response.json()) as SharedViewerData | { error?: string }

        if (!response.ok) {
          throw new Error("error" in payload ? payload.error : "Paylaşım açılamadı.")
        }

        if (!cancelled) setData(payload as SharedViewerData)
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : "Paylaşım linki açılamadı."
          )
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadShare()

    return () => {
      cancelled = true
    }
  }, [initialToken])

  if (isLoading) {
    return (
      <main className="external-share-page external-share-error-page">
        <section className="data-panel viewer-error-panel">
          <div className="panel-heading">
            <h1>Paylaşım hazırlanıyor</h1>
          </div>
          <p className="empty-state">Güvenli viewer bağlantısı doğrulanıyor.</p>
        </section>
      </main>
    )
  }

  if (error || !data) {
    return (
      <main className="external-share-page external-share-error-page">
        <section className="data-panel viewer-error-panel">
          <div className="panel-heading">
            <h1>Paylaşım açılamadı</h1>
          </div>
          <p className="empty-state">{error || "Paylaşım linki geçersiz."}</p>
        </section>
      </main>
    )
  }

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

function formatExpiry(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value))
}
