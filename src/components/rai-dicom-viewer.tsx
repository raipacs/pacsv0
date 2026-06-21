"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"

import { createDicomSignedUrl } from "@/app/actions/storage"
import {
  decodeDicomPreview,
  renderDicomImage,
  type DicomPreview,
} from "@/lib/dicom-viewer"

type ViewerInstance = {
  id: string
  instanceNumber: number | null
  sopInstanceUid: string
}

type ViewerTool = "scroll" | "pan" | "window" | "zoom"

const MIN_ZOOM = 0.2
const MAX_ZOOM = 12

export function RaiDicomViewer({ instances }: { instances: ViewerInstance[] }) {
  const orderedInstances = useMemo(
    () =>
      [...instances].sort((left, right) => {
        const leftNumber = left.instanceNumber ?? Number.MAX_SAFE_INTEGER
        const rightNumber = right.instanceNumber ?? Number.MAX_SAFE_INTEGER
        return leftNumber - rightNumber || left.sopInstanceUid.localeCompare(right.sopInstanceUid)
      }),
    [instances]
  )
  const [activeInstanceId, setActiveInstanceId] = useState(orderedInstances[0]?.id ?? "")
  const [error, setError] = useState("")
  const [preview, setPreview] = useState<DicomPreview | null>(null)
  const [viewerStatus, setViewerStatus] = useState("")
  const [windowCenter, setWindowCenter] = useState(0)
  const [windowWidth, setWindowWidth] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [invert, setInvert] = useState(false)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [rotate, setRotate] = useState(0)
  const [flipHorizontal, setFlipHorizontal] = useState(false)
  const [flipVertical, setFlipVertical] = useState(false)
  const [tool, setTool] = useState<ViewerTool>("scroll")
  const [isCinePlaying, setIsCinePlaying] = useState(false)
  const [cineFps, setCineFps] = useState(12)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const viewerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wheelRef = useRef(0)
  const loadTokenRef = useRef(0)
  const previewCacheRef = useRef(new Map<string, DicomPreview>())
  const dragRef = useRef<{
    x: number
    y: number
    panX: number
    panY: number
    center: number
    width: number
    zoom: number
    index: number
    scrollStep: number
    tool: ViewerTool
  } | null>(null)

  const foundIndex = orderedInstances.findIndex((item) => item.id === activeInstanceId)
  const activeIndex = Math.max(0, foundIndex)
  const activeInstance = orderedInstances[activeIndex]
  const hasMultipleInstances = orderedInstances.length > 1

  const applyDecodedPreview = useCallback((decoded: DicomPreview) => {
    setPreview(decoded)
    setWindowCenter(Math.round(decoded.voi.center))
    setWindowWidth(Math.round(decoded.voi.width))
    setZoom(1)
    setInvert(false)
    setRotate(0)
    setFlipHorizontal(false)
    setFlipVertical(false)
    setPan({ x: 0, y: 0 })
    setViewerStatus(decoded.pixels ? "" : "Bu DICOM içinde görüntü pixel verisi yok.")
  }, [])

  const loadInstance = useCallback(
    (targetInstanceId: string) => {
      if (!targetInstanceId) return

      const cached = previewCacheRef.current.get(targetInstanceId)
      if (cached) {
        setError("")
        applyDecodedPreview(cached)
        return
      }

      const loadToken = loadTokenRef.current + 1
      loadTokenRef.current = loadToken
      setError("")
      setViewerStatus("DICOM hazırlanıyor...")
      setPreview(null)

      startTransition(async () => {
        const result = await createDicomSignedUrl(targetInstanceId)
        if (loadTokenRef.current !== loadToken) return

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

          if (loadTokenRef.current !== loadToken) return
          setViewerStatus("Görüntü çözümleniyor...")
          const decoded = await decodeDicomPreview(await response.arrayBuffer())
          if (loadTokenRef.current !== loadToken) return
          previewCacheRef.current.set(targetInstanceId, decoded)
          applyDecodedPreview(decoded)
        } catch (caught) {
          if (loadTokenRef.current !== loadToken) return
          const message =
            caught instanceof Error ? caught.message : "DICOM görüntüsü açılamadı."
          setError(message)
          setViewerStatus(message)
        }
      })
    },
    [applyDecodedPreview, startTransition]
  )

  const goToInstance = useCallback(
    (targetIndex: number) => {
      if (!orderedInstances.length) return
      const nextIndex = Math.min(orderedInstances.length - 1, Math.max(0, targetIndex))
      setActiveInstanceId(orderedInstances[nextIndex].id)
    },
    [orderedInstances]
  )

  const moveInstance = useCallback(
    (direction: -1 | 1) => {
      if (!hasMultipleInstances) return
      goToInstance(activeIndex + direction)
    },
    [activeIndex, goToInstance, hasMultipleInstances]
  )

  useEffect(() => {
    if (!activeInstanceId) return

    const timeout = window.setTimeout(() => loadInstance(activeInstanceId), 0)
    return () => window.clearTimeout(timeout)
  }, [activeInstanceId, loadInstance])

  useEffect(() => {
    if (!preview || !canvasRef.current) return

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
        flipHorizontal,
        flipVertical,
      })
    }

    resizeAndRender()
    window.addEventListener("resize", resizeAndRender)
    return () => window.removeEventListener("resize", resizeAndRender)
  }, [
    flipHorizontal,
    flipVertical,
    invert,
    pan,
    preview,
    rotate,
    windowCenter,
    windowWidth,
    zoom,
  ])

  useEffect(() => {
    if (!isCinePlaying || !hasMultipleInstances) return

    const interval = window.setInterval(() => {
      setActiveInstanceId((currentId) => {
        const currentIndex = orderedInstances.findIndex((item) => item.id === currentId)
        const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % orderedInstances.length
        return orderedInstances[nextIndex]?.id ?? currentId
      })
    }, Math.max(80, Math.round(1000 / cineFps)))

    return () => window.clearInterval(interval)
  }, [cineFps, hasMultipleInstances, isCinePlaying, orderedInstances])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === viewerRef.current)
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange)
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()

      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault()
        moveInstance(-1)
      }

      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault()
        moveInstance(1)
      }

      if (event.key === "Home") {
        event.preventDefault()
        goToInstance(0)
      }

      if (event.key === "End") {
        event.preventDefault()
        goToInstance(orderedInstances.length - 1)
      }

      if (key === "0") resetViewer()
      if (key === "i") setInvert((value) => !value)
      if (key === "s") setTool("scroll")
      if (key === "p") setTool("pan")
      if (key === "w") setTool("window")
      if (key === "z") setTool("zoom")
      if (event.code === "Space" && hasMultipleInstances) {
        event.preventDefault()
        setIsCinePlaying((value) => !value)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  })

  function resetViewer() {
    if (!preview) return
    setWindowCenter(Math.round(preview.voi.center))
    setWindowWidth(Math.round(preview.voi.width))
    setZoom(1)
    setInvert(false)
    setRotate(0)
    setFlipHorizontal(false)
    setFlipVertical(false)
    setPan({ x: 0, y: 0 })
  }

  function applyPreset(center: number, width: number) {
    setWindowCenter(center)
    setWindowWidth(width)
  }

  function adjustZoom(delta: number) {
    setZoom((value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((value + delta).toFixed(2)))))
  }

  function fitToViewport() {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  function setActualSize() {
    if (!preview || !canvasRef.current?.parentElement) return

    const rect = canvasRef.current.parentElement.getBoundingClientRect()
    const fit = Math.min(
      rect.width / preview.metadata.columns,
      rect.height / preview.metadata.rows
    )
    if (!Number.isFinite(fit) || fit <= 0) return
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((1 / fit).toFixed(2)))))
    setPan({ x: 0, y: 0 })
  }

  async function toggleFullscreen() {
    if (!viewerRef.current) return

    if (document.fullscreenElement) {
      await document.exitFullscreen()
      return
    }

    await viewerRef.current.requestFullscreen()
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault()

    if (tool === "zoom" || event.ctrlKey || event.metaKey || !hasMultipleInstances) {
      adjustZoom(event.deltaY > 0 ? -0.12 : 0.12)
      return
    }

    const now = Date.now()
    if (now - wheelRef.current < 70) return
    wheelRef.current = now
    moveInstance(event.deltaY > 0 ? 1 : -1)
  }

  if (!orderedInstances.length) {
    return <p className="viewer-status">Bu tetkikte görüntülenecek DICOM yok.</p>
  }

  return (
    <div ref={viewerRef} className="rai-dicom-viewer">
      <div className="rai-dicom-stage" onWheel={handleWheel}>
        <div className="rai-dicom-toolbar" aria-label="Viewer araçları">
          <div className="segmented viewer-mode">
            <button
              type="button"
              className={tool === "scroll" ? "active" : ""}
              onClick={() => setTool("scroll")}
            >
              Scroll
            </button>
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
            <button
              type="button"
              className={tool === "zoom" ? "active" : ""}
              onClick={() => setTool("zoom")}
            >
              Zoom
            </button>
          </div>
          <button className="button subtle small" type="button" onClick={fitToViewport}>
            Fit
          </button>
          <button className="button subtle small" type="button" onClick={setActualSize}>
            1:1
          </button>
          <button className="button subtle small" type="button" onClick={resetViewer}>
            0
          </button>
          <button className="button subtle small" type="button" onClick={() => adjustZoom(-0.25)}>
            -
          </button>
          <button className="button subtle small" type="button" onClick={() => adjustZoom(0.25)}>
            +
          </button>
          <button
            className="button subtle small"
            type="button"
            onClick={() => setRotate((value) => (value + 90) % 360)}
          >
            Döndür
          </button>
          <button className="button subtle small" type="button" onClick={toggleFullscreen}>
            {isFullscreen ? "Çık" : "Tam ekran"}
          </button>
        </div>

        <div className="rai-dicom-overlay">
          <span>{preview?.metadata.modality || "DICOM"}</span>
          <span>
            I: {activeIndex + 1}/{orderedInstances.length}
          </span>
          <span>
            W/L: {windowWidth}/{windowCenter}
          </span>
          <span>Zoom: {Math.round(zoom * 100)}%</span>
        </div>

        {viewerStatus ? <p className="viewer-status">{viewerStatus}</p> : null}
        <canvas
          ref={canvasRef}
          className={`rai-dicom-canvas is-${tool}`}
          onPointerDown={(event) => {
            dragRef.current = {
              x: event.clientX,
              y: event.clientY,
              panX: pan.x,
              panY: pan.y,
              center: windowCenter,
              width: windowWidth,
              zoom,
              index: activeIndex,
              scrollStep: 0,
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
              setWindowWidth(Math.max(1, Math.round(dragRef.current.width + deltaX * 4)))
              return
            }

            if (dragRef.current.tool === "zoom") {
              const nextZoom = dragRef.current.zoom - deltaY * 0.012
              setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(nextZoom.toFixed(2)))))
              return
            }

            if (dragRef.current.tool === "scroll" && hasMultipleInstances) {
              const scrollStep = Math.trunc(deltaY / 36)
              if (scrollStep !== dragRef.current.scrollStep) {
                dragRef.current.scrollStep = scrollStep
                goToInstance(dragRef.current.index + scrollStep)
              }
              return
            }

            setPan({ x: dragRef.current.panX + deltaX, y: dragRef.current.panY + deltaY })
          }}
          onPointerUp={(event) => {
            dragRef.current = null
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={() => {
            dragRef.current = null
          }}
        />
      </div>

      <aside className="rai-dicom-side">
        <div className="viewer-counter">
          {activeIndex + 1} / {orderedInstances.length}
        </div>
        {error ? <p className="inline-error">{error}</p> : null}
        <div className="viewer-tools">
          <button className="button subtle small" type="button" onClick={resetViewer}>
            Sıfırla
          </button>
          <button className="button subtle small" type="button" onClick={() => setInvert((value) => !value)}>
            İnvert
          </button>
          <button
            className="button subtle small"
            type="button"
            onClick={() => setFlipHorizontal((value) => !value)}
          >
            H Flip
          </button>
          <button
            className="button subtle small"
            type="button"
            onClick={() => setFlipVertical((value) => !value)}
          >
            V Flip
          </button>
        </div>
        <div className="viewer-presets">
          <button className="button subtle small" type="button" onClick={() => applyPreset(40, 400)}>
            Yumuşak
          </button>
          <button className="button subtle small" type="button" onClick={() => applyPreset(300, 1500)}>
            Kemik
          </button>
          <button className="button subtle small" type="button" onClick={() => applyPreset(-600, 1500)}>
            Akciğer
          </button>
        </div>
        <div className="viewer-cine">
          <button
            className="button subtle small"
            type="button"
            disabled={!hasMultipleInstances}
            onClick={() => setIsCinePlaying((value) => !value)}
          >
            {isCinePlaying ? "Durdur" : "Cine"}
          </button>
          <label>
            FPS
            <input
              type="range"
              min="1"
              max="30"
              step="1"
              value={cineFps}
              onChange={(event) => setCineFps(Number(event.target.value))}
            />
            <span>{cineFps}</span>
          </label>
        </div>
        <label>
          Zoom
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
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
        {hasMultipleInstances ? (
          <label>
            Instance
            <input
              type="range"
              min="0"
              max={orderedInstances.length - 1}
              step="1"
              value={activeIndex}
              onChange={(event) => goToInstance(Number(event.target.value))}
            />
          </label>
        ) : null}
        <dl>
          <div>
            <dt>Instance</dt>
            <dd>
              {activeInstance?.instanceNumber ?? activeIndex + 1}
              {hasMultipleInstances ? ` / ${orderedInstances.length}` : ""}
            </dd>
          </div>
          <div>
            <dt>Modalite</dt>
            <dd>{preview?.metadata.modality || "-"}</dd>
          </div>
          <div>
            <dt>Boyut</dt>
            <dd>{preview ? `${preview.metadata.columns} x ${preview.metadata.rows}` : "-"}</dd>
          </div>
          <div>
            <dt>Transfer syntax</dt>
            <dd>{preview?.metadata.transferSyntaxUid || "-"}</dd>
          </div>
          <div>
            <dt>Araç</dt>
            <dd>{tool.toUpperCase()}</dd>
          </div>
        </dl>
        {isPending ? <p className="muted">Yükleniyor...</p> : null}
      </aside>
    </div>
  )
}
