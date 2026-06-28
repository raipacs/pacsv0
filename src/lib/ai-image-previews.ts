import { deflateSync } from "node:zlib"

import { decodeDicomPreview, type DicomPreview } from "@/lib/dicom-viewer"

export type AiDicomImageSource = {
  id: string
  instanceNumber: number | null
  signedUrl: string
  sizeBytes: number
  sopInstanceUid: string
}

export type AiImagePreview = {
  base64: string
  columns: number
  dataUrl: string
  instanceNumber: number | null
  label: string
  mimeType: "image/png"
  rows: number
  sopInstanceUid: string
}

const MAX_AI_IMAGE_PREVIEWS = 4
const MAX_DICOM_DOWNLOAD_BYTES = 24 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CRC_TABLE = createCrcTable()

export async function createAiImagePreviewsFromDicom({
  maxImages = MAX_AI_IMAGE_PREVIEWS,
  sources,
}: {
  maxImages?: number
  sources: AiDicomImageSource[]
}) {
  const errors: string[] = []
  const previews: AiImagePreview[] = []

  for (const source of selectRepresentativeSources(sources, maxImages)) {
    try {
      if (source.sizeBytes > MAX_DICOM_DOWNLOAD_BYTES) {
        errors.push(
          `${source.sopInstanceUid}: DICOM dosyası AI önizleme sınırından büyük (${formatBytes(
            source.sizeBytes
          )}).`
        )
        continue
      }

      const response = await fetch(source.signedUrl, { cache: "no-store" })
      if (!response.ok) {
        errors.push(`${source.sopInstanceUid}: DICOM indirilemedi (${response.status}).`)
        continue
      }

      const buffer = await response.arrayBuffer()
      const preview = await decodeDicomPreview(buffer)
      const png = encodeDicomPreviewAsPng(preview)
      const base64 = png.toString("base64")

      previews.push({
        base64,
        columns: preview.metadata.columns,
        dataUrl: `data:image/png;base64,${base64}`,
        instanceNumber: source.instanceNumber,
        label: `Instance ${source.instanceNumber ?? previews.length + 1}`,
        mimeType: "image/png",
        rows: preview.metadata.rows,
        sopInstanceUid: source.sopInstanceUid,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "DICOM görüntüsü okunamadı."
      errors.push(`${source.sopInstanceUid}: ${message}`)
    }
  }

  return { errors, previews }
}

function encodeDicomPreviewAsPng(preview: DicomPreview) {
  if (!preview.pixels || preview.metadata.rows <= 0 || preview.metadata.columns <= 0) {
    throw new Error("DICOM pixel verisi bulunamadı.")
  }

  const rgba = createRgbaImage(preview)
  return encodePng(preview.metadata.columns, preview.metadata.rows, rgba)
}

function createRgbaImage(preview: DicomPreview) {
  if (!preview.pixels) throw new Error("DICOM pixel verisi bulunamadı.")

  const { columns, photometricInterpretation, rescaleIntercept, rescaleSlope, rows } =
    preview.metadata
  const pixelCount = rows * columns
  const rgba = new Uint8ClampedArray(pixelCount * 4)

  if (preview.metadata.samplesPerPixel > 1 && preview.pixels instanceof Uint8ClampedArray) {
    rgba.set(preview.pixels.subarray(0, rgba.length))
    return rgba
  }

  const low = preview.voi.center - preview.voi.width / 2
  const range = Math.max(1, preview.voi.width)
  const shouldInvert = photometricInterpretation.toUpperCase() === "MONOCHROME1"

  for (let index = 0; index < pixelCount; index += 1) {
    const storedValue = preview.pixels[index] ?? 0
    const scaledValue = storedValue * rescaleSlope + rescaleIntercept
    const normalized = clampByte(((scaledValue - low) / range) * 255)
    const grayscale = shouldInvert ? 255 - normalized : normalized
    const outputIndex = index * 4
    rgba[outputIndex] = grayscale
    rgba[outputIndex + 1] = grayscale
    rgba[outputIndex + 2] = grayscale
    rgba[outputIndex + 3] = 255
  }

  return rgba
}

function encodePng(width: number, height: number, rgba: Uint8ClampedArray) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)

  for (let row = 0; row < height; row += 1) {
    const rawOffset = row * (stride + 1)
    const rgbaOffset = row * stride
    raw[rawOffset] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + rgbaOffset, stride).copy(raw, rawOffset + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, "ascii")
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)

  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)

  return Buffer.concat([length, typeBuffer, data, crc])
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function createCrcTable() {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
}

function selectRepresentativeSources(sources: AiDicomImageSource[], maxImages: number) {
  if (sources.length <= maxImages) return sources
  const selectedIndexes = new Set<number>()
  const lastIndex = sources.length - 1

  for (let index = 0; index < maxImages; index += 1) {
    selectedIndexes.add(Math.round((index / Math.max(1, maxImages - 1)) * lastIndex))
  }

  return [...selectedIndexes].sort((a, b) => a - b).map((index) => sources[index]).filter(Boolean)
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
