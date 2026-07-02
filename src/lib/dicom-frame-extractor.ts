type ParsedElement = {
  dataOffset: number
  length: number
  vr: string
}

type ParserState = {
  elements: Map<string, ParsedElement>
  pixelData?: ParsedElement
  transferSyntaxUid: string
}

export type DicomFrame = {
  contentType: string
  data: Uint8Array
  frameNumber: number
  transferSyntaxUid: string
}

const LONG_VR = new Set(["OB", "OD", "OF", "OL", "OW", "SQ", "UC", "UR", "UT", "UN"])
const EXPLICIT_LITTLE_ENDIAN_UID = "1.2.840.10008.1.2.1"
const IMPLICIT_LITTLE_ENDIAN_UID = "1.2.840.10008.1.2"
const UNCOMPRESSED_TRANSFER_SYNTAXES = new Set([
  IMPLICIT_LITTLE_ENDIAN_UID,
  EXPLICIT_LITTLE_ENDIAN_UID,
  "1.2.840.10008.1.2.1.99",
  "1.2.840.10008.1.2.2",
])
const TRANSFER_SYNTAX_CONTENT_TYPES = new Map([
  ["1.2.840.10008.1.2.4.50", "image/jpeg"],
  ["1.2.840.10008.1.2.4.51", "image/jpeg"],
  ["1.2.840.10008.1.2.4.57", "image/jpeg"],
  ["1.2.840.10008.1.2.4.70", "image/jpeg"],
  ["1.2.840.10008.1.2.4.80", "image/jls"],
  ["1.2.840.10008.1.2.4.81", "image/jls"],
  ["1.2.840.10008.1.2.4.90", "image/jp2"],
  ["1.2.840.10008.1.2.4.91", "image/jp2"],
])

export function extractDicomFrames(
  buffer: ArrayBuffer,
  frameNumbers: number[]
): DicomFrame[] {
  const bytes = new Uint8Array(buffer)
  if (!hasDicomPreamble(bytes)) throw new Error("DICOM preamble imzası bulunamadı.")

  const state = parseDicomElements(buffer)
  if (!state.pixelData) throw new Error("DICOM Pixel Data bulunamadı.")

  const normalizedFrameNumbers = Array.from(new Set(frameNumbers))
    .filter((frameNumber) => Number.isInteger(frameNumber) && frameNumber > 0)
    .sort((left, right) => left - right)

  if (!normalizedFrameNumbers.length) {
    throw new Error("En az bir geçerli frame numarası gerekir.")
  }

  if (UNCOMPRESSED_TRANSFER_SYNTAXES.has(state.transferSyntaxUid)) {
    return extractNativeFrames(buffer, state, normalizedFrameNumbers)
  }

  return extractEncapsulatedFrames(buffer, state, normalizedFrameNumbers)
}

function extractNativeFrames(
  buffer: ArrayBuffer,
  state: ParserState,
  frameNumbers: number[]
): DicomFrame[] {
  const pixelData = state.pixelData as ParsedElement
  if (pixelData.length === 0xffffffff) {
    throw new Error("Native frame beklenirken encapsulated pixel data bulundu.")
  }

  const rows = readUint16(buffer, state.elements.get("0028,0010")) ?? 0
  const columns = readUint16(buffer, state.elements.get("0028,0011")) ?? 0
  const samplesPerPixel = readUint16(buffer, state.elements.get("0028,0002")) ?? 1
  const bitsAllocated = readUint16(buffer, state.elements.get("0028,0100")) ?? 0
  const numberOfFrames = readNumberText(buffer, state.elements.get("0028,0008")) ?? 1
  const bytesPerSample = Math.ceil(bitsAllocated / 8)
  const frameLength = rows * columns * samplesPerPixel * bytesPerSample

  if (!rows || !columns || !bitsAllocated || !frameLength) {
    throw new Error("Native frame uzunluğu hesaplanamadı.")
  }

  return frameNumbers.map((frameNumber) => {
    if (frameNumber > numberOfFrames) {
      throw new Error(`Frame ${frameNumber} bulunamadı. Toplam frame: ${numberOfFrames}.`)
    }

    const frameOffset = pixelData.dataOffset + (frameNumber - 1) * frameLength
    const frameEnd = frameOffset + frameLength
    if (frameEnd > pixelData.dataOffset + pixelData.length || frameEnd > buffer.byteLength) {
      throw new Error(`Frame ${frameNumber} pixel data sınırları dışında.`)
    }

    return {
      contentType: "application/octet-stream",
      data: new Uint8Array(buffer.slice(frameOffset, frameEnd)),
      frameNumber,
      transferSyntaxUid: state.transferSyntaxUid,
    }
  })
}

function extractEncapsulatedFrames(
  buffer: ArrayBuffer,
  state: ParserState,
  frameNumbers: number[]
): DicomFrame[] {
  const pixelData = state.pixelData as ParsedElement
  const fragments = readEncapsulatedFragments(buffer, pixelData)
  if (!fragments.length) throw new Error("Encapsulated pixel data fragment bulunamadı.")

  return frameNumbers.map((frameNumber) => {
    const fragment = fragments[frameNumber - 1]
    if (!fragment) {
      throw new Error(`Frame ${frameNumber} bulunamadı. Toplam fragment: ${fragments.length}.`)
    }

    return {
      contentType:
        TRANSFER_SYNTAX_CONTENT_TYPES.get(state.transferSyntaxUid) ??
        "application/octet-stream",
      data: fragment,
      frameNumber,
      transferSyntaxUid: state.transferSyntaxUid,
    }
  })
}

function readEncapsulatedFragments(buffer: ArrayBuffer, pixelData: ParsedElement) {
  const view = new DataView(buffer)
  const fragments: Uint8Array[] = []
  let position = pixelData.dataOffset
  let itemIndex = 0

  while (position + 8 <= view.byteLength) {
    const group = view.getUint16(position, true)
    const element = view.getUint16(position + 2, true)
    const length = view.getUint32(position + 4, true)
    position += 8

    if (group === 0xfffe && element === 0xe0dd) break
    if (group !== 0xfffe || element !== 0xe000) break
    if (length === 0xffffffff || position + length > view.byteLength) break

    // The first item is the Basic Offset Table, not a frame payload.
    if (itemIndex > 0 && length > 0) {
      fragments.push(new Uint8Array(buffer.slice(position, position + length)))
    }

    position += length + (length % 2)
    itemIndex += 1
  }

  return fragments
}

function parseDicomElements(buffer: ArrayBuffer): ParserState {
  const view = new DataView(buffer)
  const elements = new Map<string, ParsedElement>()

  const metaEnd = parseExplicitElements(view, 132, elements, true)
  const transferSyntaxUid = readText(buffer, elements.get("0002,0010")).trim()
  const implicitVr = transferSyntaxUid === IMPLICIT_LITTLE_ENDIAN_UID

  if (implicitVr) {
    parseImplicitElements(view, metaEnd, elements)
  } else {
    parseExplicitElements(view, metaEnd, elements, false)
  }

  return {
    elements,
    pixelData: elements.get("7fe0,0010"),
    transferSyntaxUid: transferSyntaxUid || EXPLICIT_LITTLE_ENDIAN_UID,
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
  if (!element || element.length < 2) return undefined
  return new DataView(buffer).getUint16(element.dataOffset, true)
}

function readNumberText(buffer: ArrayBuffer, element?: ParsedElement) {
  const text = readText(buffer, element)
  if (!text) return undefined
  const [first] = text.split("\\")
  const parsed = Number.parseFloat(first)
  return Number.isFinite(parsed) ? parsed : undefined
}

function readText(buffer: ArrayBuffer, element?: ParsedElement) {
  if (!element || element.length === 0 || element.length === 0xffffffff) return ""
  return new TextDecoder("utf-8")
    .decode(buffer.slice(element.dataOffset, element.dataOffset + element.length))
    .replace(/\0/g, "")
    .trim()
}
