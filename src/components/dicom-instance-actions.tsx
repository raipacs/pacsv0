"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"

import { createDicomSignedUrl, createOhifViewerLaunchUrl } from "@/app/actions/storage"
import {
  decodeDicomPreview,
  renderDicomImage,
  type DicomPreview,
} from "@/lib/dicom-viewer"

export function DicomInstanceActions({
  instanceId,
  instances,
  studyId,
  viewerLabel = "Viewer",
  showSignedUrl = true,
}: {
  instanceId: string
  instances?: { id: string; instanceNumber: number | null; sopInstanceUid: string }[]
  studyId?: string
  viewerLabel?: string
  showSignedUrl?: boolean
}) {
  const viewerInstances = useMemo(() => {
    const ordered = instances?.length
      ? [...instances].sort((left, right) => {
          const leftNumber = left.instanceNumber ?? Number.MAX_SAFE_INTEGER
          const rightNumber = right.instanceNumber ?? Number.MAX_SAFE_INTEGER
          return (
            leftNumber - rightNumber ||
            left.sopInstanceUid.localeCompare(right.sopInstanceUid)
          )
        })
      : [{ id: instanceId, instanceNumber: null, sopInstanceUid: "" }]

    return ordered.some((item) => item.id === instanceId)
      ? ordered
      : [{ id: instanceId, instanceNumber: null, sopInstanceUid: "" }, ...ordered]
  }, [instanceId, instances])

  const [activeInstanceId, setActiveInstanceId] = useState(instanceId)
  const [error, setError] = useState("")
  const [isViewerOpen, setIsViewerOpen] = useState(false)
  const [preview, setPreview] = useState<DicomPreview | null>(null)
  const [viewerStatus, setViewerStatus] = useState("")
  const [windowCenter, setWindowCenter] = useState(0)
  const [windowWidth, setWindowWidth] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [invert, setInvert] = useState(false)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [rotate, setRotate] = useState(0)
  const [tool, setTool] = useState<"pan" | "window">("pan")
  const [isPending, startTransition] = useTransition()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragRef = useRef<{
    x: number
    y: number
    panX: number
    panY: number
    center: number
    width: number
    tool: "pan" | "window"
  } | null>(null)
  const activeIndex = Math.max(
    0,
    viewerInstances.findIndex((item) => item.id === activeInstanceId)
  )
  const activeInstance = viewerInstances[activeIndex]
  const hasMultipleInstances = viewerInstances.length > 1

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
        rotate,
        panX: pan.x * ratio,
        panY: pan.y * ratio,
      })
    }

    resizeAndRender()
    window.addEventListener("resize", resizeAndRender)
    return () => window.removeEventListener("resize", resizeAndRender)
  }, [invert, isViewerOpen, pan, preview, rotate, windowCenter, windowWidth, zoom])

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

  const loadInstance = useCallback(
    (targetInstanceId: string) => {
      setError("")
      setViewerStatus("DICOM hazırlanıyor...")
      setPreview(null)
      setActiveInstanceId(targetInstanceId)

      startTransition(async () => {
        const result = await createDicomSignedUrl(targetInstanceId)
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
          setRotate(0)
          setPan({ x: 0, y: 0 })
          setViewerStatus(decoded.pixels ? "" : "Bu DICOM içinde görüntü pixel verisi yok.")
        } catch (caught) {
          const message =
            caught instanceof Error ? caught.message : "DICOM görüntüsü açılamadı."
          setViewerStatus(message)
        }
      })
    },
    [startTransition]
  )

  function openLegacyViewer() {
    setIsViewerOpen(true)
    loadInstance(activeInstance?.id ?? instanceId)
  }

  function openViewer() {
    setError("")

    if (!studyId) {
      openLegacyViewer()
      return
    }

    const viewerWindow = window.open("about:blank", "_blank")
    if (viewerWindow) {
      viewerWindow.document.title = "OHIF hazırlanıyor..."
      viewerWindow.document.body.innerHTML =
        "<p style=\"font-family: system-ui, sans-serif; padding: 24px;\">OHIF viewer hazırlanıyor...</p>"
    }

    startTransition(async () => {
      const result = await createOhifViewerLaunchUrl(studyId)
      if (!result.ok) {
        viewerWindow?.close()
        setError(result.error)
        return
      }

      if (viewerWindow) {
        viewerWindow.location.href = result.url
        return
      }

      window.location.href = result.url
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
    setRotate(0)
    setPan({ x: 0, y: 0 })
  }

  function moveInstance(direction: -1 | 1) {
    if (!hasMultipleInstances) return
    const nextIndex =
      (activeIndex + direction + viewerInstances.length) % viewerInstances.length
    loadInstance(viewerInstances[nextIndex].id)
  }

  function applyPreset(center: number, width: number) {
    setWindowCenter(center)
    setWindowWidth(width)
  }

  function adjustZoom(delta: number) {
    setZoom((value) => Math.min(6, Math.max(0.25, Number((value + delta).toFixed(2)))))
  }

  useEffect(() => {
    if (!isViewerOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeViewer()
        return
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault()
        moveInstance(-1)
      }

      if (event.key === "ArrowRight") {
        event.preventDefault()
        moveInstance(1)
      }

      if (event.key === "0") resetViewer()
      if (event.key.toLocaleLowerCase("tr-TR") === "i") {
        setInvert((value) => !value)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  })

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
              <div className="viewer-header-actions">
                {hasMultipleInstances ? (
                  <span className="viewer-counter">
                    {activeIndex + 1} / {viewerInstances.length}
                  </span>
                ) : null}
                <button className="button subtle small" type="button" onClick={closeViewer}>
                  Kapat
                </button>
              </div>
            </header>

            <div className="viewer-body">
              <div className="viewer-canvas-wrap">
                <div className="viewer-toolbar" aria-label="Viewer araçları">
                  <div className="segmented viewer-mode">
                    <button
                      type="button"
                      className={tool === "pan" ? "active" : ""}
                      onClick={() => setTool("pan")}
                    >
                      Pan
                    </button>
                    <button
                      type="button"
                      className={tool === "window" ? "active" : ""}
                      onClick={() => setTool("window")}
                    >
                      W/L
                    </button>
                  </div>
                  <button className="button subtle small" type="button" onClick={resetViewer}>
                    0
                  </button>
                  <button
                    className="button subtle small"
                    type="button"
                    onClick={() => adjustZoom(-0.25)}
                  >
                    -
                  </button>
                  <button
                    className="button subtle small"
                    type="button"
                    onClick={() => adjustZoom(0.25)}
                  >
                    +
                  </button>
                  <button
                    className="button subtle small"
                    type="button"
                    onClick={() => setRotate((value) => (value + 90) % 360)}
                  >
                    Döndür
                  </button>
                  {hasMultipleInstances ? (
                    <>
                      <button
                        className="button subtle small"
                        type="button"
                        onClick={() => moveInstance(-1)}
                      >
                        Önceki
                      </button>
                      <button
                        className="button subtle small"
                        type="button"
                        onClick={() => moveInstance(1)}
                      >
                        Sonraki
                      </button>
                    </>
                  ) : null}
                </div>
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
                      center: windowCenter,
                      width: windowWidth,
                      tool,
                    }
                    event.currentTarget.setPointerCapture(event.pointerId)
                  }}
                  onPointerMove={(event) => {
                    if (!dragRef.current) return
                    const deltaX = event.clientX - dragRef.current.x
                    const deltaY = event.clientY - dragRef.current.y

                    if (dragRef.current.tool === "window") {
                      setWindowCenter(Math.round(dragRef.current.center - deltaY * 2))
                      setWindowWidth(
                        Math.max(1, Math.round(dragRef.current.width + deltaX * 4))
                      )
                      return
                    }

                    setPan({
                      x: dragRef.current.panX + deltaX,
                      y: dragRef.current.panY + deltaY,
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
                <div className="viewer-presets">
                  <button
                    className="button subtle small"
                    type="button"
                    onClick={() => applyPreset(40, 400)}
                  >
                    Yumuşak
                  </button>
                  <button
                    className="button subtle small"
                    type="button"
                    onClick={() => applyPreset(300, 1500)}
                  >
                    Kemik
                  </button>
                  <button
                    className="button subtle small"
                    type="button"
                    onClick={() => applyPreset(-600, 1500)}
                  >
                    Akciğer
                  </button>
                </div>
                <label>
                  Zoom
                  <input
                    type="range"
                    min="0.4"
                    max="6"
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
                <label>
                  Rotasyon
                  <input
                    type="range"
                    min="0"
                    max="270"
                    step="90"
                    value={rotate}
                    onChange={(event) => setRotate(Number(event.target.value))}
                  />
                </label>
                {hasMultipleInstances ? (
                  <label>
                    Instance
                    <input
                      type="range"
                      min="0"
                      max={viewerInstances.length - 1}
                      step="1"
                      value={activeIndex}
                      onChange={(event) =>
                        loadInstance(viewerInstances[Number(event.target.value)].id)
                      }
                    />
                  </label>
                ) : null}
                <dl>
                  <div>
                    <dt>Instance</dt>
                    <dd>
                      {activeInstance?.instanceNumber ?? activeIndex + 1}
                      {hasMultipleInstances ? ` / ${viewerInstances.length}` : ""}
                    </dd>
                  </div>
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
