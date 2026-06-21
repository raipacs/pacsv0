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
  const [tool, setTool] = useState<"pan" | "window">("pan")
  const [isPending, startTransition] = useTransition()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wheelRef = useRef(0)
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
    orderedInstances.findIndex((item) => item.id === activeInstanceId)
  )
  const activeInstance = orderedInstances[activeIndex]
  const hasMultipleInstances = orderedInstances.length > 1

  const loadInstance = useCallback(
    (targetInstanceId: string) => {
      if (!targetInstanceId) return
      setError("")
      setViewerStatus("DICOM hazırlanıyor...")
      setPreview(null)

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
          setError(message)
          setViewerStatus(message)
        }
      })
    },
    [startTransition]
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
      })
    }

    resizeAndRender()
    window.addEventListener("resize", resizeAndRender)
    return () => window.removeEventListener("resize", resizeAndRender)
  }, [invert, pan, preview, rotate, windowCenter, windowWidth, zoom])

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
      (activeIndex + direction + orderedInstances.length) % orderedInstances.length
    setActiveInstanceId(orderedInstances[nextIndex].id)
  }

  function applyPreset(center: number, width: number) {
    setWindowCenter(center)
    setWindowWidth(width)
  }

  function adjustZoom(delta: number) {
    setZoom((value) => Math.min(8, Math.max(0.2, Number((value + delta).toFixed(2)))))
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
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

  if (!orderedInstances.length) {
    return <p className="viewer-status">Bu tetkikte görüntülenecek DICOM yok.</p>
  }

  return (
    <div className="rai-dicom-viewer">
      <div
        className="rai-dicom-stage"
        onWheel={(event) => {
          if (!hasMultipleInstances) return
          event.preventDefault()
          const now = Date.now()
          if (now - wheelRef.current < 120) return
          wheelRef.current = now
          moveInstance(event.deltaY > 0 ? 1 : -1)
        }}
      >
        <div className="rai-dicom-toolbar" aria-label="Viewer araçları">
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
          {hasMultipleInstances ? (
            <>
              <button className="button subtle small" type="button" onClick={() => moveInstance(-1)}>
                Önceki
              </button>
              <button className="button subtle small" type="button" onClick={() => moveInstance(1)}>
                Sonraki
              </button>
            </>
          ) : null}
        </div>
        {viewerStatus ? <p className="viewer-status">{viewerStatus}</p> : null}
        <canvas
          ref={canvasRef}
          className="rai-dicom-canvas"
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
              setWindowWidth(Math.max(1, Math.round(dragRef.current.width + deltaX * 4)))
              return
            }

            setPan({ x: dragRef.current.panX + deltaX, y: dragRef.current.panY + deltaY })
          }}
          onPointerUp={() => {
            dragRef.current = null
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
        <label>
          Zoom
          <input
            type="range"
            min="0.4"
            max="8"
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
              onChange={(event) =>
                setActiveInstanceId(orderedInstances[Number(event.target.value)].id)
              }
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
        </dl>
        {isPending ? <p className="muted">Yükleniyor...</p> : null}
      </aside>
    </div>
  )
}
