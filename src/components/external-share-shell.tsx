"use client"

import dynamic from "next/dynamic"

const ExternalShareViewerClient = dynamic(
  () =>
    import("@/components/external-share-viewer").then(
      (module) => module.ExternalShareViewer
    ),
  {
    loading: () => (
      <main className="external-share-page external-share-error-page">
        <section className="data-panel viewer-error-panel">
          <div className="panel-heading">
            <h1>Paylaşım hazırlanıyor</h1>
          </div>
          <p className="empty-state">Güvenli viewer bağlantısı doğrulanıyor.</p>
        </section>
      </main>
    ),
    ssr: false,
  }
)

export function ExternalShareShell({ token = "" }: { token?: string }) {
  return <ExternalShareViewerClient token={token} />
}
