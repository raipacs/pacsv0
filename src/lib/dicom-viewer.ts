import { Decoder } from "jpeg-lossless-decoder-js"

export type DicomPreview = {
  pixels: Int16Array | Uint16Array | Uint8Array | Uint8ClampedArray | null
  metadata: DicomPreviewMetadata
  voi: {
    center: number
    width: number
  }
}

export type DicomPreviewMetadata = {
  transferSyntaxUid: string
  sopClassUid: string
  modality: string
  patientName: string
  patientId: string
  studyDescription: string
  seriesDescription: string
  photometricInterpretation: string
  rows: number
  columns: number
  samplesPerPixel: number
  planarConfiguration: number
  bitsAllocated: number
  bitsStored: number
  pixelRepresentation: number
  windowCenter: string
  windowWidth: string
  rescaleIntercept: number
  rescaleSlope: number
  numberOfFrames: number
  isCompressed: boolean
}

type ParsedElement = {
  dataOffset: number
  length: number
  vr: string
}

type ParserState = {
  elements: Map<string, ParsedElement>
  transferSyntaxUid: string
  pixelData?: ParsedElement
}

const LONG_VR = new Set(["OB", "OD", "OF", "OL", "OW", "SQ", "UC", "UR", "UT", "UN"])
const JPEG_LOSSLESS_TRANSFER_SYNTAXES = new Set([
  "1.2.840.10008.1.2.4.57",
  "1.2.840.10008.1.2.4.70",
])
const PRESENTATION_CACHE_LIMIT = 6
const presentationCache = new WeakMap<
  DicomPreview,
  Array<{ key: string; canvas: HTMLCanvasElement }>
>()

export async function decodeDicomPreview(buffer: ArrayBuffer): Promise<DicomPreview> {
  const bytes = new Uint8Array(buffer)
  if (!hasDicomPreamble(bytes)) {
    throw new Error("DICOM preamble imzası bulunamadı.")
  }

  const state = parseDicomElements(buffer)
  const metadata = readMetadata(buffer, state)
  const pixels = decodePixels(buffer, state, metadata)
  const voi = defaultVoi(pixels, metadata)

  return { pixels, metadata, voi }
}

export function renderDicomImage(
  canvas: HTMLCanvasElement,
  preview: DicomPreview,
  options: {
    center: number
    width: number
    invert: boolean
    zoom: number
    rotate: number
    panX: number
    panY: number
    flipHorizontal?: boolean
    flipVertical?: boolean
  }
) {
  if (!preview.pixels || preview.metadata.rows <= 0 || preview.metadata.columns <= 0) {
    return
  }

  const { rows, columns } = preview.metadata
  const source = getWindowedCanvas(preview, options.center, options.width, options.invert)
  const targetContext = canvas.getContext("2d")
  if (!targetContext) return

  targetContext.fillStyle = "#020617"
  targetContext.fillRect(0, 0, canvas.width, canvas.height)

  const fit = Math.min(canvas.width / columns, canvas.height / rows)
  const scale = fit * options.zoom
  const width = columns * scale
  const height = rows * scale
  const rotation = (((options.rotate % 360) + 360) % 360) * (Math.PI / 180)

  targetContext.imageSmoothingEnabled = false
  targetContext.save()
  targetContext.translate(canvas.width / 2 + options.panX, canvas.height / 2 + options.panY)
  targetContext.rotate(rotation)
  targetContext.scale(options.flipHorizontal ? -1 : 1, options.flipVertical ? -1 : 1)
  targetContext.drawImage(source, -width / 2, -height / 2, width, height)
  targetContext.restore()
}

function getWindowedCanvas(
  preview: DicomPreview,
  center: number,
  width: number,
  invert: boolean
) {
  const {
    rows,
    columns,
    photometricInterpretation,
    rescaleIntercept,
    rescaleSlope,
    samplesPerPixel,
  } = preview.metadata
  const shouldInvert =
    invert || photometricInterpretation.toUpperCase() === "MONOCHROME1"
  const roundedCenter = Math.round(center)
  const roundedWidth = Math.max(1, Math.round(width))
  const colorMode = samplesPerPixel > 1 ? "color" : "gray"
  const key = `${colorMode}:${roundedCenter}:${roundedWidth}:${shouldInvert ? "1" : "0"}`
  const entries = presentationCache.get(preview) ?? []
  const cachedIndex = entries.findIndex((entry) => entry.key === key)

  if (cachedIndex >= 0) {
    const [hit] = entries.splice(cachedIndex, 1)
    if (hit) {
      entries.push(hit)
      presentationCache.set(preview, entries)
      return hit.canvas
    }
  }

  const source = document.createElement("canvas")
  source.width = columns
  source.height = rows
  const sourceContext = source.getContext("2d")
  if (!sourceContext || !preview.pixels) return source

  const imageData = sourceContext.createImageData(columns, rows)
  if (preview.metadata.samplesPerPixel > 1 && preview.pixels instanceof Uint8ClampedArray) {
    imageData.data.set(preview.pixels.subarray(0, imageData.data.length))
    sourceContext.putImageData(imageData, 0, 0)
    entries.push({ key, canvas: source })

    while (entries.length > PRESENTATION_CACHE_LIMIT) {
      entries.shift()
    }

    presentationCache.set(preview, entries)
    return source
  }

  const low = roundedCenter - roundedWidth / 2
  const high = roundedCenter + roundedWidth / 2
  const range = Math.max(1, high - low)

  for (let index = 0; index < preview.pixels.length; index += 1) {
    const storedValue = preview.pixels[index] ?? 0
    const scaledValue = storedValue * rescaleSlope + rescaleIntercept
    const normalized = Math.max(0, Math.min(255, ((scaledValue - low) / range) * 255))
    const grayscale = shouldInvert ? 255 - normalized : normalized
    const outputIndex = index * 4
    imageData.data[outputIndex] = grayscale
    imageData.data[outputIndex + 1] = grayscale
    imageData.data[outputIndex + 2] = grayscale
    imageData.data[outputIndex + 3] = 255
  }

  sourceContext.putImageData(imageData, 0, 0)
  entries.push({ key, canvas: source })

  while (entries.length > PRESENTATION_CACHE_LIMIT) {
    entries.shift()
  }

  presentationCache.set(preview, entries)
  return source
}

function parseDicomElements(buffer: ArrayBuffer): ParserState {
  const view = new DataView(buffer)
  const elements = new Map<string, ParsedElement>()

  const metaEnd = parseExplicitElements(view, 132, elements, true)
  const transferSyntaxUid = readText(buffer, elements.get("0002,0010")).trim()
  const implicitVr = transferSyntaxUid === "1.2.840.10008.1.2"

  if (implicitVr) {
    parseImplicitElements(view, metaEnd, elements)
  } else {
    parseExplicitElements(view, metaEnd, elements, false)
  }

  return {
    elements,
    transferSyntaxUid,
    pixelData: elements.get("7fe0,0010"),
  }
}

function parseExplicitElements(
  view: DataView,
  offset: number,
  elements: Map<string, ParsedElement>,
  metaOnly: boolean
) {
  let position = offset

  while (position + 8 <= view.byteLength) {
    const group = view.getUint16(position, true)
    const element = view.getUint16(position + 2, true)

    if (metaOnly && group !== 0x0002) break

    position += 4
    const vr = String.fromCharCode(view.getUint8(position), view.getUint8(position + 1))
    position += 2

    let length: number
    if (LONG_VR.has(vr)) {
      position += 2
      if (position + 4 > view.byteLength) break
      length = view.getUint32(position, true)
      position += 4
    } else {
      if (position + 2 > view.byteLength) break
      length = view.getUint16(position, true)
      position += 2
    }

    const tag = tagKey(group, element)
    elements.set(tag, { dataOffset: position, length, vr })

    if (group === 0x7fe0 && element === 0x0010) break
    if (length === 0xffffffff) {
      const sequenceEnd = findUndefinedLengthSequenceEnd(view, position)
      if (sequenceEnd < 0) break
      position = sequenceEnd
      continue
    }
    if (position + length > view.byteLength) break

    position += length + (length % 2)
  }

  return position
}

function parseImplicitElements(
  view: DataView,
  offset: number,
  elements: Map<string, ParsedElement>
) {
  let position = offset

  while (position + 8 <= view.byteLength) {
    const group = view.getUint16(position, true)
    const element = view.getUint16(position + 2, true)
    position += 4

    const length = view.getUint32(position, true)
    position += 4

    const tag = tagKey(group, element)
    elements.set(tag, { dataOffset: position, length, vr: "UN" })

    if (group === 0x7fe0 && element === 0x0010) break
    if (length === 0xffffffff) {
      const sequenceEnd = findUndefinedLengthSequenceEnd(view, position)
      if (sequenceEnd < 0) break
      position = sequenceEnd
      continue
    }
    if (position + length > view.byteLength) break

    position += length + (length % 2)
  }
}

function findUndefinedLengthSequenceEnd(view: DataView, offset: number) {
  for (let position = offset; position + 8 <= view.byteLength; position += 2) {
    const group = view.getUint16(position, true)
    const element = view.getUint16(position + 2, true)

    if (group === 0xfffe && element === 0xe0dd) {
      return position + 8
    }
  }

  return -1
}

function readMetadata(buffer: ArrayBuffer, state: ParserState): DicomPreviewMetadata {
  const elements = state.elements
  const numberOfFrames = readNumberText(buffer, elements.get("0028,0008")) ?? 1
  const rows = readUint16(buffer, elements.get("0028,0010")) ?? 0
  const columns = readUint16(buffer, elements.get("0028,0011")) ?? 0
  const samplesPerPixel = readUint16(buffer, elements.get("0028,0002")) ?? 1
  const bitsAllocated = readUint16(buffer, elements.get("0028,0100")) ?? 0
  const bitsStored = readUint16(buffer, elements.get("0028,0101")) ?? bitsAllocated
  const pixelRepresentation = readUint16(buffer, elements.get("0028,0103")) ?? 0
  const planarConfiguration = readUint16(buffer, elements.get("0028,0006")) ?? 0

  return {
    transferSyntaxUid: state.transferSyntaxUid,
    sopClassUid: readText(buffer, elements.get("0008,0016")),
    modality: readText(buffer, elements.get("0008,0060")),
    patientName: readText(buffer, elements.get("0010,0010")),
    patientId: readText(buffer, elements.get("0010,0020")),
    studyDescription: readText(buffer, elements.get("0008,1030")),
    seriesDescription: readText(buffer, elements.get("0008,103e")),
    photometricInterpretation: readText(buffer, elements.get("0028,0004")),
    rows,
    columns,
    samplesPerPixel,
    planarConfiguration,
    bitsAllocated,
    bitsStored,
    pixelRepresentation,
    windowCenter: readText(buffer, elements.get("0028,1050")),
    windowWidth: readText(buffer, elements.get("0028,1051")),
    rescaleIntercept: readNumberText(buffer, elements.get("0028,1052")) ?? 0,
    rescaleSlope: readNumberText(buffer, elements.get("0028,1053")) ?? 1,
    numberOfFrames,
    isCompressed: JPEG_LOSSLESS_TRANSFER_SYNTAXES.has(state.transferSyntaxUid),
  }
}

function decodePixels(
  buffer: ArrayBuffer,
  state: ParserState,
  metadata: DicomPreviewMetadata
) {
  if (!state.pixelData || metadata.rows <= 0 || metadata.columns <= 0) return null

  let pixelBuffer: ArrayBuffer

  if (JPEG_LOSSLESS_TRANSFER_SYNTAXES.has(metadata.transferSyntaxUid)) {
    const fragment = readFirstEncapsulatedFragment(buffer, state.pixelData)
    const decoder = new Decoder()
    pixelBuffer = decoder.decompress(fragment)
  } else if (
    metadata.transferSyntaxUid === "1.2.840.10008.1.2" ||
    metadata.transferSyntaxUid === "1.2.840.10008.1.2.1"
  ) {
    pixelBuffer = buffer.slice(
      state.pixelData.dataOffset,
      state.pixelData.dataOffset + state.pixelData.length
    )
  } else {
    throw new Error(`Transfer syntax desteklenmiyor: ${metadata.transferSyntaxUid}`)
  }

  const framePixelCount = metadata.rows * metadata.columns
  const frameByteLength =
    framePixelCount * metadata.samplesPerPixel * Math.max(1, metadata.bitsAllocated / 8)
  const firstFrameBuffer = pixelBuffer.slice(0, Math.min(pixelBuffer.byteLength, frameByteLength))

  if (metadata.samplesPerPixel > 1) {
    return decodeColorPixels(firstFrameBuffer, metadata)
  }

  if (metadata.bitsAllocated === 8) {
    return new Uint8Array(firstFrameBuffer)
  }

  if (metadata.bitsAllocated !== 16) {
    throw new Error(`${metadata.bitsAllocated}-bit DICOM pixel verisi desteklenmiyor.`)
  }

  return metadata.pixelRepresentation === 1
    ? new Int16Array(firstFrameBuffer)
    : new Uint16Array(firstFrameBuffer)
}

function decodeColorPixels(buffer: ArrayBuffer, metadata: DicomPreviewMetadata) {
  if (metadata.bitsAllocated !== 8) {
    throw new Error(`${metadata.bitsAllocated}-bit renkli DICOM pixel verisi desteklenmiyor.`)
  }
  if (metadata.samplesPerPixel < 3) {
    throw new Error(`${metadata.samplesPerPixel} kanallı renkli DICOM desteklenmiyor.`)
  }

  const source = new Uint8Array(buffer)
  const pixelCount = metadata.rows * metadata.columns
  const output = new Uint8ClampedArray(pixelCount * 4)
  const photometric = metadata.photometricInterpretation.toUpperCase()
  const planar = metadata.planarConfiguration === 1

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    let c1: number
    let c2: number
    let c3: number

    if (planar) {
      c1 = source[pixel] ?? 0
      c2 = source[pixel + pixelCount] ?? 0
      c3 = source[pixel + pixelCount * 2] ?? 0
    } else {
      const inputIndex = pixel * metadata.samplesPerPixel
      c1 = source[inputIndex] ?? 0
      c2 = source[inputIndex + 1] ?? 0
      c3 = source[inputIndex + 2] ?? 0
    }

    const [red, green, blue] = photometric.startsWith("YBR")
      ? ybrToRgb(c1, c2, c3)
      : [c1, c2, c3]
    const outputIndex = pixel * 4
    output[outputIndex] = red
    output[outputIndex + 1] = green
    output[outputIndex + 2] = blue
    output[outputIndex + 3] = 255
  }

  return output
}

function ybrToRgb(y: number, cb: number, cr: number): [number, number, number] {
  return [
    clampByte(y + 1.402 * (cr - 128)),
    clampByte(y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128)),
    clampByte(y + 1.772 * (cb - 128)),
  ]
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function readFirstEncapsulatedFragment(buffer: ArrayBuffer, pixelData: ParsedElement) {
  const view = new DataView(buffer)
  let position = pixelData.dataOffset
  const limit = view.byteLength

  if (position + 8 > limit) {
    throw new Error("Encapsulated pixel data okunamadı.")
  }

  const botGroup = view.getUint16(position, true)
  const botElement = view.getUint16(position + 2, true)
  const botLength = view.getUint32(position + 4, true)

  if (botGroup !== 0xfffe || botElement !== 0xe000) {
    throw new Error("DICOM JPEG fragment başlangıcı bulunamadı.")
  }

  position += 8 + botLength + (botLength % 2)

  if (position + 8 > limit) {
    throw new Error("DICOM JPEG fragment verisi bulunamadı.")
  }

  const fragmentGroup = view.getUint16(position, true)
  const fragmentElement = view.getUint16(position + 2, true)
  const fragmentLength = view.getUint32(position + 4, true)

  if (fragmentGroup !== 0xfffe || fragmentElement !== 0xe000) {
    throw new Error("DICOM JPEG fragment verisi beklenen formatta değil.")
  }

  position += 8
  return buffer.slice(position, position + fragmentLength)
}

function defaultVoi(
  pixels: Int16Array | Uint16Array | Uint8Array | Uint8ClampedArray | null,
  metadata: DicomPreviewMetadata
) {
  if (metadata.samplesPerPixel > 1) {
    return { center: 128, width: 256 }
  }

  const center = firstNumber(metadata.windowCenter)
  const width = firstNumber(metadata.windowWidth)

  if (center !== null && width !== null && width > 0) {
    return { center, width }
  }

  if (!pixels?.length) {
    return { center: 128, width: 256 }
  }

  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  const stride = Math.max(1, Math.floor(pixels.length / 100000))

  for (let index = 0; index < pixels.length; index += stride) {
    const scaledValue =
      (pixels[index] ?? 0) * metadata.rescaleSlope + metadata.rescaleIntercept
    min = Math.min(min, scaledValue)
    max = Math.max(max, scaledValue)
  }

  return {
    center: (min + max) / 2,
    width: Math.max(1, max - min),
  }
}

function hasDicomPreamble(bytes: Uint8Array) {
  return (
    bytes[128] === 0x44 &&
    bytes[129] === 0x49 &&
    bytes[130] === 0x43 &&
    bytes[131] === 0x4d
  )
}

function tagKey(group: number, element: number) {
  return `${group.toString(16).padStart(4, "0")},${element
    .toString(16)
    .padStart(4, "0")}`
}

function readUint16(buffer: ArrayBuffer, element?: ParsedElement) {
  if (!element || element.length < 2) return null
  return new DataView(buffer).getUint16(element.dataOffset, true)
}

function readText(buffer: ArrayBuffer, element?: ParsedElement) {
  if (!element || element.length === 0 || element.length === 0xffffffff) return ""
  return new TextDecoder("utf-8")
    .decode(buffer.slice(element.dataOffset, element.dataOffset + element.length))
    .replace(/\0/g, "")
    .trim()
}

function readNumberText(buffer: ArrayBuffer, element?: ParsedElement) {
  const text = readText(buffer, element)
  if (!text) return null
  const first = firstNumber(text)
  return first
}

function firstNumber(value: string) {
  const [first] = value.split("\\")
  const parsed = Number.parseFloat(first)
  return Number.isFinite(parsed) ? parsed : null
}
