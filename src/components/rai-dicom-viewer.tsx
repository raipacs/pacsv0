"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"

import { createDicomSignedUrls } from "@/app/actions/storage"
import {
  decodeDicomPreview,
  renderDicomImage,
  type DicomPreview,
} from "@/lib/dicom-viewer"

type ViewerInstance = {
  id: string
  seriesId: string | null
  seriesNumber: number | null
  seriesDescription: string | null
  seriesModality: string | null
  instanceNumber: number | null
  sopInstanceUid: string
}

type ViewerTool = "scroll" | "pan" | "window" | "zoom"

type ViewerSeries = {
  id: string
  number: number | null
  description: string
  modality: string
  instances: ViewerInstance[]
}

const MIN_ZOOM = 0.2
const MAX_ZOOM = 12
const SIGNED_URL_TIMEOUT_MS = 15_000
const DICOM_FETCH_TIMEOUT_MS = 25_000
const PREVIEW_CACHE_LIMIT = 10
const PREFETCH_RADIUS = 2

export function RaiDicomViewer({ instances }: { instances: ViewerInstance[] }) {
  const allOrderedInstances = useMemo(
    () =>
      [...instances].sort((left, right) => {
        const leftSeriesNumber = left.seriesNumber ?? Number.MAX_SAFE_INTEGER
        const rightSeriesNumber = right.seriesNumber ?? Number.MAX_SAFE_INTEGER
        if (leftSeriesNumber !== rightSeriesNumber) return leftSeriesNumber - rightSeriesNumber

        const leftNumber = left.instanceNumber ?? Number.MAX_SAFE_INTEGER
        const rightNumber = right.instanceNumber ?? Number.MAX_SAFE_INTEGER
        return leftNumber - rightNumber || left.sopInstanceUid.localeCompare(right.sopInstanceUid)
      }),
    [instances]
  )

  const seriesGroups = useMemo(() => {
    const groups = new Map<string, ViewerSeries>()

    allOrderedInstances.forEach((instance) => {
      const key = instance.seriesId ?? "study"
      const existing = groups.get(key)

      if (existing) {
        existing.instances.push(instance)
        return
      }

      const numberLabel =
        instance.seriesNumber === null ? "Seri" : `Seri ${instance.seriesNumber}`
      groups.set(key, {
        id: key,
        number: instance.seriesNumber,
        description: instance.seriesDescription?.trim() || numberLabel,
        modality: instance.seriesModality?.trim() || "DICOM",
        instances: [instance],
      })
    })

    return Array.from(groups.values()).sort((left, right) => {
      const leftNumber = left.number ?? Number.MAX_SAFE_INTEGER
      const rightNumber = right.number ?? Number.MAX_SAFE_INTEGER
      return leftNumber - rightNumber || left.description.localeCompare(right.description)
    })
  }, [allOrderedInstances])

  const [activeSeriesId, setActiveSeriesId] = useState(seriesGroups[0]?.id ?? "")
  const activeSeries = useMemo(
    () => seriesGroups.find((series) => series.id === activeSeriesId) ?? seriesGroups[0],
    [activeSeriesId, seriesGroups]
  )
  const orderedInstances = useMemo(() => activeSeries?.instances ?? [], [activeSeries])
  const [activeInstanceId, setActiveInstanceId] = useState(orderedInstances[0]?.id ?? "")
  const [error, setError] = useState("")
  const [preview, setPreview] = useState<DicomPreview | null>(null)
  const [viewerStatus, setViewerStatus] = useState("")
  const [seriesThumbnails, setSeriesThumbnails] = useState<Record<string, string>>({})
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
  const [isSeriesPanelOpen, setIsSeriesPanelOpen] = useState(true)
  const [isToolsPanelOpen, setIsToolsPanelOpen] = useState(true)
  const [cacheStats, setCacheStats] = useState({ ready: 0, loading: 0 })
  const [isPending, startTransition] = useTransition()
  const viewerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wheelRef = useRef(0)
  const loadTokenRef = useRef(0)
  const previewCacheRef = useRef(new Map<string, DicomPreview>())
  const signedUrlCacheRef = useRef(new Map<string, string>())
  const pendingPreviewRef = useRef(new Map<string, Promise<DicomPreview>>())
  const hasLoadedPreviewRef = useRef(false)
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

  const resolvedActiveInstanceId = orderedInstances.some(
    (item) => item.id === activeInstanceId
  )
    ? activeInstanceId
    : orderedInstances[0]?.id ?? ""
  const foundIndex = orderedInstances.findIndex((item) => item.id === resolvedActiveInstanceId)
  const activeIndex = Math.max(0, foundIndex)
  const activeInstance = orderedInstances[activeIndex]
  const loadableInstanceId = activeInstance?.id ?? ""
  const hasMultipleInstances = orderedInstances.length > 1
  const canGoPrevious = hasMultipleInstances && activeIndex > 0
  const canGoNext = hasMultipleInstances && activeIndex < orderedInstances.length - 1

  const refreshCacheStats = useCallback(() => {
    setCacheStats({
      ready: previewCacheRef.current.size,
      loading: pendingPreviewRef.current.size,
    })
  }, [])

  const cachePreview = useCallback(
    (instanceId: string, decoded: DicomPreview) => {
      const cache = previewCacheRef.current
      cache.delete(instanceId)
      cache.set(instanceId, decoded)

      while (cache.size > PREVIEW_CACHE_LIMIT) {
        const oldestKey = cache.keys().next().value
        if (!oldestKey) break
        cache.delete(oldestKey)
      }

      refreshCacheStats()
    },
    [refreshCacheStats]
  )

  const getSignedUrls = useCallback(
    async (instanceIds: string[]) => {
      const uniqueIds = Array.from(new Set(instanceIds)).filter(Boolean)
      const missingIds = uniqueIds.filter((id) => !signedUrlCacheRef.current.has(id))

      if (missingIds.length) {
        const result = await withTimeout(
          createDicomSignedUrls(missingIds),
          SIGNED_URL_TIMEOUT_MS,
          "DICOM signed URL üretimi zaman aşımına uğradı."
        )

        if (!result.ok) throw new Error(result.error)

        Object.entries(result.urls).forEach(([instanceId, url]) => {
          signedUrlCacheRef.current.set(instanceId, url)
        })
      }

      return new Map(
        uniqueIds
          .map((id) => [id, signedUrlCacheRef.current.get(id)] as const)
          .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
      )
    },
    []
  )

  const decodeInstancePreview = useCallback(
    async (instanceId: string, onStatus?: (status: string) => void) => {
      const cached = previewCacheRef.current.get(instanceId)
      if (cached) {
        previewCacheRef.current.delete(instanceId)
        previewCacheRef.current.set(instanceId, cached)
        refreshCacheStats()
        return cached
      }

      const pending = pendingPreviewRef.current.get(instanceId)
      if (pending) return pending

      const pendingPreview = (async () => {
        onStatus?.("DICOM imzalı bağlantı hazırlanıyor...")
        const urls = await getSignedUrls([instanceId])
        const url = urls.get(instanceId)
        if (!url) throw new Error("DICOM signed URL alınamadı.")

        onStatus?.("DICOM indiriliyor...")
        let response = await fetchDicomUrl(url)

        if ([400, 401, 403].includes(response.status)) {
          signedUrlCacheRef.current.delete(instanceId)
          const refreshedUrls = await getSignedUrls([instanceId])
          const refreshedUrl = refreshedUrls.get(instanceId)
          if (refreshedUrl) response = await fetchDicomUrl(refreshedUrl)
        }

        if (!response.ok) throw new Error(`DICOM indirilemedi: ${response.status}`)

        onStatus?.("Görüntü çözümleniyor...")
        const decoded = await decodeDicomPreview(await response.arrayBuffer())
        cachePreview(instanceId, decoded)
        return decoded
      })()

      pendingPreviewRef.current.set(instanceId, pendingPreview)
      refreshCacheStats()

      try {
        return await pendingPreview
      } finally {
        pendingPreviewRef.current.delete(instanceId)
        refreshCacheStats()
      }
    },
    [cachePreview, getSignedUrls, refreshCacheStats]
  )

  const selectSeries = useCallback(
    (seriesId: string) => {
      const nextSeries = seriesGroups.find((series) => series.id === seriesId)
      if (!nextSeries) return

      hasLoadedPreviewRef.current = false
      setIsCinePlaying(false)
      setActiveSeriesId(seriesId)
      setActiveInstanceId(nextSeries.instances[0]?.id ?? "")
    },
    [seriesGroups]
  )

  const applyDecodedPreview = useCallback((decoded: DicomPreview) => {
    setPreview(decoded)

    if (!hasLoadedPreviewRef.current) {
      setWindowCenter(Math.round(decoded.voi.center))
      setWindowWidth(Math.round(decoded.voi.width))
      setZoom(1)
      setInvert(false)
      setRotate(0)
      setFlipHorizontal(false)
      setFlipVertical(false)
      setPan({ x: 0, y: 0 })
      hasLoadedPreviewRef.current = true
    }

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
        try {
          const decoded = await decodeInstancePreview(targetInstanceId, setViewerStatus)
          if (loadTokenRef.current !== loadToken) return
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
    [applyDecodedPreview, decodeInstancePreview, startTransition]
  )

  const prefetchNearbyInstances = useCallback(
    (centerIndex: number) => {
      if (!hasMultipleInstances) return

      const nearbyIds: string[] = []
      for (let offset = 1; offset <= PREFETCH_RADIUS; offset += 1) {
        const next = orderedInstances[centerIndex + offset]?.id
        const previous = orderedInstances[centerIndex - offset]?.id
        if (next) nearbyIds.push(next)
        if (previous) nearbyIds.push(previous)
      }

      const idsToPrefetch = nearbyIds.filter(
        (id) => !previewCacheRef.current.has(id) && !pendingPreviewRef.current.has(id)
      )
      if (!idsToPrefetch.length) return

      void getSignedUrls(idsToPrefetch)
        .then(() => Promise.allSettled(idsToPrefetch.map((id) => decodeInstancePreview(id))))
        .catch(() => {
          // Prefetch is opportunistic; active viewport loading reports real errors.
        })
    },
    [decodeInstancePreview, getSignedUrls, hasMultipleInstances, orderedInstances]
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
    if (!loadableInstanceId) return

    const timeout = window.setTimeout(() => loadInstance(loadableInstanceId), 0)
    return () => window.clearTimeout(timeout)
  }, [loadInstance, loadableInstanceId])

  useEffect(() => {
    if (!seriesGroups.length) return

    let cancelled = false
    const missingSeries = seriesGroups
      .filter((series) => !seriesThumbnails[series.id] && series.instances[0]?.id)
      .slice(0, 16)

    missingSeries.forEach((series) => {
      const firstInstanceId = series.instances[0]?.id
      if (!firstInstanceId) return

      void decodeInstancePreview(firstInstanceId)
        .then((decoded) => {
          if (cancelled) return
          const thumbnail = renderPreviewThumbnail(decoded)
          if (!thumbnail) return
          setSeriesThumbnails((current) => ({ ...current, [series.id]: thumbnail }))
        })
        .catch(() => {
          // Thumbnail loading is non-blocking; active viewport reports real errors.
        })
    })

    return () => {
      cancelled = true
    }
  }, [decodeInstancePreview, seriesGroups, seriesThumbnails])

  useEffect(() => {
    if (!hasMultipleInstances) return

    const timeout = window.setTimeout(() => prefetchNearbyInstances(activeIndex), 220)
    return () => window.clearTimeout(timeout)
  }, [activeIndex, hasMultipleInstances, prefetchNearbyInstances])

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

  if (!allOrderedInstances.length) {
    return <p className="viewer-status">Bu tetkikte görüntülenecek DICOM yok.</p>
  }

  return (
    <div
      ref={viewerRef}
      className={`rai-dicom-viewer${isSeriesPanelOpen ? "" : " series-collapsed"}${
        isToolsPanelOpen ? "" : " tools-collapsed"
      }`}
    >
      {isSeriesPanelOpen ? (
        <aside className="rai-dicom-series" aria-label="Seri listesi">
          <div className="series-panel-header">
            <div>
              <strong>Seriler</strong>
              <span>{seriesGroups.length} seri</span>
            </div>
            <div className="panel-header-actions">
              <span>{allOrderedInstances.length} görüntü</span>
              <button
                type="button"
                aria-label="Seriler panelini kapat"
                onClick={() => setIsSeriesPanelOpen(false)}
              >
                Kapat
              </button>
            </div>
          </div>
          <div className="series-list">
            {seriesGroups.map((series) => {
              const thumbnail = seriesThumbnails[series.id]
              const isActive = series.id === activeSeries?.id

              return (
                <button
                  key={series.id}
                  className={`series-card${isActive ? " active" : ""}`}
                  type="button"
                  onClick={() => selectSeries(series.id)}
                >
                  <span className="series-thumb" aria-hidden="true">
                    {thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" src={thumbnail} />
                    ) : (
                      <span>{series.modality}</span>
                    )}
                  </span>
                  <span className="series-card-body">
                    <span className="series-title">{series.description}</span>
                    <span className="series-meta">
                      {series.number === null ? "Seri" : `${series.number}. seri`} ·{" "}
                      {series.modality} · {series.instances.length} görüntü
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </aside>
      ) : null}
      <div className="rai-dicom-stage" onWheel={handleWheel}>
        <div className="viewer-panel-toggles" aria-label="Viewer panel kontrolleri">
          {!isSeriesPanelOpen ? (
            <button
              type="button"
              aria-expanded={isSeriesPanelOpen}
              onClick={() => setIsSeriesPanelOpen(true)}
            >
              Seriler
            </button>
          ) : null}
          {!isToolsPanelOpen ? (
            <button
              type="button"
              aria-expanded={isToolsPanelOpen}
              onClick={() => setIsToolsPanelOpen(true)}
            >
              Araçlar
            </button>
          ) : null}
        </div>
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
          <span>{activeSeries?.description ?? "Seri"}</span>
          <span>
            I: {activeIndex + 1}/{orderedInstances.length}
          </span>
          <span>
            W/L: {windowWidth}/{windowCenter}
          </span>
          <span>Zoom: {Math.round(zoom * 100)}%</span>
          <span>
            Cache: {cacheStats.ready}
            {cacheStats.loading ? ` +${cacheStats.loading}` : ""}
          </span>
        </div>

        <div className="rai-dicom-ruler" aria-hidden="true">
          <span>mm</span>
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
        <div className="rai-dicom-scrubber" aria-label="Seri görüntü gezgini">
          <button
            type="button"
            aria-label="Önceki görüntü"
            disabled={!canGoPrevious}
            onClick={() => moveInstance(-1)}
          >
            ←
          </button>
          <button
            type="button"
            disabled={!hasMultipleInstances}
            onClick={() => setIsCinePlaying((value) => !value)}
          >
            {isCinePlaying ? "Durdur" : "Cine"}
          </button>
          <label>
            <span>
              {activeSeries?.description ?? "Seri"} · {activeIndex + 1}/
              {orderedInstances.length}
            </span>
            <input
              type="range"
              min="0"
              max={Math.max(0, orderedInstances.length - 1)}
              step="1"
              value={activeIndex}
              disabled={!hasMultipleInstances}
              onChange={(event) => goToInstance(Number(event.target.value))}
            />
          </label>
          <button
            type="button"
            aria-label="Sonraki görüntü"
            disabled={!canGoNext}
            onClick={() => moveInstance(1)}
          >
            →
          </button>
        </div>
      </div>

      {isToolsPanelOpen ? (
      <aside className="rai-dicom-side">
        <div className="side-panel-header">
          <div>
            <strong>Araçlar</strong>
            <span>Viewer kontrolleri</span>
          </div>
          <button
            type="button"
            aria-label="Araçlar panelini kapat"
            onClick={() => setIsToolsPanelOpen(false)}
          >
            Kapat
          </button>
        </div>
        <div className="viewer-counter frame-navigator" aria-label="Görüntü sırası">
          <button
            type="button"
            aria-label="Önceki görüntü"
            disabled={!canGoPrevious}
            onClick={() => moveInstance(-1)}
          >
            ←
          </button>
          <span>
            {activeIndex + 1} / {orderedInstances.length}
          </span>
          <button
            type="button"
            aria-label="Sonraki görüntü"
            disabled={!canGoNext}
            onClick={() => moveInstance(1)}
          >
            →
          </button>
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
            <dt>Seri</dt>
            <dd>
              {activeSeries
                ? `${activeSeries.description} (${activeSeries.instances.length})`
                : "-"}
            </dd>
          </div>
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
          <div>
            <dt>Cache</dt>
            <dd>
              {cacheStats.ready} hazır
              {cacheStats.loading ? `, ${cacheStats.loading} yükleniyor` : ""}
            </dd>
          </div>
        </dl>
        {isPending ? <p className="muted">Yükleniyor...</p> : null}
      </aside>
      ) : null}
    </div>
  )
}

function renderPreviewThumbnail(preview: DicomPreview) {
  if (!preview.pixels) return ""

  const ratio = window.devicePixelRatio || 1
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(72 * ratio)
  canvas.height = Math.round(72 * ratio)

  renderDicomImage(canvas, preview, {
    center: preview.voi.center,
    width: preview.voi.width,
    invert: false,
    zoom: 1,
    rotate: 0,
    panX: 0,
    panY: 0,
  })

  return canvas.toDataURL("image/jpeg", 0.72)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: number | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout !== undefined) window.clearTimeout(timeout)
  })
}

function fetchDicomUrl(url: string) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), DICOM_FETCH_TIMEOUT_MS)

  return fetch(url, { signal: controller.signal }).finally(() => window.clearTimeout(timeout))
}
