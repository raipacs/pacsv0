"use client"

import { useEffect, useRef, useState, useTransition } from "react"

import { createDicomSignedUrl } from "@/app/actions/storage"
import {
  decodeDicomPreview,
  renderDicomImage,
  type DicomPreview,
} from "@/lib/dicom-viewer"

export function DicomInstanceActions({
  instanceId,
  viewerLabel = "Viewer",
  showSignedUrl = true,
}: {
  instanceId: string
  viewerLabel?: string
  showSignedUrl?: boolean
}) {
  const [error, setError] = useState("")
  const [isViewerOpen, setIsViewerOpen] = useState(false)
  const [preview, setPreview] = useState<DicomPreview | null>(null)
  const [viewerStatus, setViewerStatus] = useState("")
  const [windowCenter, setWindowCenter] = useState(0)
  const [windowWidth, setWindowWidth] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [invert, setInvert] = useState(false)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPending, startTransition] = useTransition()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(
    null
  )

  useEffect(() => {
    if (!isViewerOpen || !preview || !canvasRef.current) return

    const canvas = canvasRef.current
    const resizeAndRender = () => {
      const parent = canvas.parentElement
      if (!parent) return

      const rect = parent.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(rect.width * ratio))
      canvas.height = Math.max(1, Math.floor(rect.height * ratio))

      renderDicomImage(canvas, preview, {
        center: windowCenter,
        width: windowWidth,
        invert,
        zoom,
        panX: pan.x * ratio,
        panY: pan.y * ratio,
      })
    }

    resizeAndRender()
    window.addEventListener("resize", resizeAndRender)
    return () => window.removeEventListener("resize", resizeAndRender)
  }, [invert, isViewerOpen, pan, preview, windowCenter, windowWidth, zoom])

  function openSignedUrl() {
    setError("")
    startTransition(async () => {
      const result = await createDicomSignedUrl(instanceId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      window.open(result.url, "_blank", "noopener,noreferrer")
    })
  }

  function openViewer() {
    setError("")
    setViewerStatus("DICOM hazırlanıyor...")
    setIsViewerOpen(true)
    setPreview(null)

    startTransition(async () => {
      const result = await createDicomSignedUrl(instanceId)
      if (!result.ok) {
        setError(result.error)
        setViewerStatus(result.error)
        return
      }

      try {
        setViewerStatus("DICOM indiriliyor...")
        const response = await fetch(result.url)
        if (!response.ok) {
          throw new Error(`DICOM indirilemedi: ${response.status}`)
        }

        setViewerStatus("Görüntü çözümleniyor...")
        const decoded = await decodeDicomPreview(await response.arrayBuffer())
        setPreview(decoded)
        setWindowCenter(Math.round(decoded.voi.center))
        setWindowWidth(Math.round(decoded.voi.width))
        setZoom(1)
        setInvert(false)
        setPan({ x: 0, y: 0 })
        setViewerStatus(decoded.pixels ? "" : "Bu DICOM içinde görüntü pixel verisi yok.")
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "DICOM görüntüsü açılamadı."
        setViewerStatus(message)
      }
    })
  }

  function closeViewer() {
    setIsViewerOpen(false)
    setPreview(null)
    setViewerStatus("")
  }

  function resetViewer() {
    if (!preview) return
    setWindowCenter(Math.round(preview.voi.center))
    setWindowWidth(Math.round(preview.voi.width))
    setZoom(1)
    setInvert(false)
    setPan({ x: 0, y: 0 })
  }

  return (
    <>
      <span className="inline-actions">
        <button
          className="button subtle small"
          type="button"
          disabled={isPending}
          onClick={openViewer}
        >
          {isPending ? "Hazırlanıyor" : viewerLabel}
        </button>
        {showSignedUrl ? (
          <button
            className="button subtle small"
            type="button"
            disabled={isPending}
            onClick={openSignedUrl}
          >
            Signed URL
          </button>
        ) : null}
        {error ? <span className="inline-error">{error}</span> : null}
      </span>

      {isViewerOpen ? (
        <div className="viewer-backdrop" role="dialog" aria-modal="true">
          <div className="viewer-shell">
            <header className="viewer-header">
              <div>
                <p className="eyebrow">DICOM viewer</p>
                <h2>{preview?.metadata.seriesDescription || "Instance önizleme"}</h2>
              </div>
              <button className="button subtle small" type="button" onClick={closeViewer}>
                Kapat
              </button>
            </header>

            <div className="viewer-body">
              <div className="viewer-canvas-wrap">
                {viewerStatus ? <p className="viewer-status">{viewerStatus}</p> : null}
                <canvas
                  ref={canvasRef}
                  className="viewer-canvas"
                  onPointerDown={(event) => {
                    dragRef.current = {
                      x: event.clientX,
                      y: event.clientY,
                      panX: pan.x,
                      panY: pan.y,
                    }
                    event.currentTarget.setPointerCapture(event.pointerId)
                  }}
                  onPointerMove={(event) => {
                    if (!dragRef.current) return
                    setPan({
                      x: dragRef.current.panX + event.clientX - dragRef.current.x,
                      y: dragRef.current.panY + event.clientY - dragRef.current.y,
                    })
                  }}
                  onPointerUp={() => {
                    dragRef.current = null
                  }}
                  onPointerCancel={() => {
                    dragRef.current = null
                  }}
                />
              </div>

              <aside className="viewer-side">
                <div className="viewer-tools">
                  <button className="button subtle small" type="button" onClick={resetViewer}>
                    Sıfırla
                  </button>
                  <button
                    className="button subtle small"
                    type="button"
                    onClick={() => setInvert((value) => !value)}
                  >
                    İnvert
                  </button>
                </div>
                <label>
                  Zoom
                  <input
                    type="range"
                    min="0.4"
                    max="4"
                    step="0.1"
                    value={zoom}
                    onChange={(event) => setZoom(Number(event.target.value))}
                  />
                </label>
                <label>
                  Window center
                  <input
                    type="range"
                    min={Math.round(windowCenter - windowWidth)}
                    max={Math.round(windowCenter + windowWidth)}
                    step="1"
                    value={windowCenter}
                    onChange={(event) => setWindowCenter(Number(event.target.value))}
                  />
                </label>
                <label>
                  Window width
                  <input
                    type="range"
                    min="1"
                    max={Math.max(2, Math.round(windowWidth * 2))}
                    step="1"
                    value={windowWidth}
                    onChange={(event) => setWindowWidth(Number(event.target.value))}
                  />
                </label>
                <dl>
                  <div>
                    <dt>Modalite</dt>
                    <dd>{preview?.metadata.modality || "-"}</dd>
                  </div>
                  <div>
                    <dt>Boyut</dt>
                    <dd>
                      {preview
                        ? `${preview.metadata.columns} x ${preview.metadata.rows}`
                        : "-"}
                    </dd>
                  </div>
                  <div>
                    <dt>Transfer syntax</dt>
                    <dd>{preview?.metadata.transferSyntaxUid || "-"}</dd>
                  </div>
                  <div>
                    <dt>Photometric</dt>
                    <dd>{preview?.metadata.photometricInterpretation || "-"}</dd>
                  </div>
                  <div>
                    <dt>Hasta</dt>
                    <dd>{preview?.metadata.patientName.replace("^", " ") || "-"}</dd>
                  </div>
                </dl>
              </aside>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
