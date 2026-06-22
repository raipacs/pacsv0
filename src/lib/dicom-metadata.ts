export type OhifInstanceMetadata = {
  BitsAllocated?: number
  BitsStored?: number
  Columns?: number
  FrameOfReferenceUID?: string
  HighBit?: number
  ImageOrientationPatient?: number[]
  ImagePositionPatient?: number[]
  ImageType?: string[]
  InstanceNumber?: number
  Modality?: string
  NumberOfFrames?: number
  PhotometricInterpretation?: string
  PixelRepresentation?: number
  PixelSpacing?: number[]
  RescaleIntercept?: number
  RescaleSlope?: number
  Rows?: number
  SamplesPerPixel?: number
  SeriesDate?: string
  SeriesDescription?: string
  SeriesInstanceUID?: string
  SeriesNumber?: number
  SeriesTime?: string
  SOPClassUID?: string
  SOPInstanceUID?: string
  StudyDescription?: string
  StudyInstanceUID?: string
  TransferSyntaxUID?: string
  WindowCenter?: number
  WindowWidth?: number
}

type ParsedElement = {
  dataOffset: number
  length: number
  vr: string
}

type ParserState = {
  elements: Map<string, ParsedElement>
  transferSyntaxUid: string
}

const LONG_VR = new Set(["OB", "OD", "OF", "OL", "OW", "SQ", "UC", "UR", "UT", "UN"])

export function readOhifInstanceMetadata(buffer: ArrayBuffer): OhifInstanceMetadata {
  const bytes = new Uint8Array(buffer)
  if (!hasDicomPreamble(bytes)) return {}

  const state = parseDicomElements(buffer)
  const elements = state.elements
  const pixelSpacing =
    readNumberList(buffer, elements.get("0028,0030")) ||
    readNumberList(buffer, elements.get("0018,1164"))

  return compactObject({
    BitsAllocated: readUint16(buffer, elements.get("0028,0100")),
    BitsStored: readUint16(buffer, elements.get("0028,0101")),
    Columns: readUint16(buffer, elements.get("0028,0011")),
    FrameOfReferenceUID: readText(buffer, elements.get("0020,0052")),
    HighBit: readUint16(buffer, elements.get("0028,0102")),
    ImageOrientationPatient: readNumberList(buffer, elements.get("0020,0037")),
    ImagePositionPatient: readNumberList(buffer, elements.get("0020,0032")),
    ImageType: readTextList(buffer, elements.get("0008,0008")),
    InstanceNumber: readNumberText(buffer, elements.get("0020,0013")),
    Modality: readText(buffer, elements.get("0008,0060")),
    NumberOfFrames: readNumberText(buffer, elements.get("0028,0008")),
    PhotometricInterpretation: readText(buffer, elements.get("0028,0004")),
    PixelRepresentation: readUint16(buffer, elements.get("0028,0103")),
    PixelSpacing: pixelSpacing,
    RescaleIntercept: readNumberText(buffer, elements.get("0028,1052")),
    RescaleSlope: readNumberText(buffer, elements.get("0028,1053")),
    Rows: readUint16(buffer, elements.get("0028,0010")),
    SamplesPerPixel: readUint16(buffer, elements.get("0028,0002")),
    SeriesDate: normalizeDicomDate(readText(buffer, elements.get("0008,0021"))),
    SeriesDescription: readText(buffer, elements.get("0008,103e")),
    SeriesInstanceUID: readText(buffer, elements.get("0020,000e")),
    SeriesNumber: readNumberText(buffer, elements.get("0020,0011")),
    SeriesTime: normalizeDicomTime(readText(buffer, elements.get("0008,0031"))),
    SOPClassUID: readText(buffer, elements.get("0008,0016")),
    SOPInstanceUID: readText(buffer, elements.get("0008,0018")),
    StudyDescription: readText(buffer, elements.get("0008,1030")),
    StudyInstanceUID: readText(buffer, elements.get("0020,000d")),
    TransferSyntaxUID: state.transferSyntaxUid,
    WindowCenter: readNumberText(buffer, elements.get("0028,1050")),
    WindowWidth: readNumberText(buffer, elements.get("0028,1051")),
  })
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

  return { elements, transferSyntaxUid }
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

    elements.set(tagKey(group, element), { dataOffset: position, length, vr })

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

    elements.set(tagKey(group, element), { dataOffset: position, length, vr: "UN" })

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

function readText(buffer: ArrayBuffer, element?: ParsedElement) {
  if (!element || element.length === 0 || element.length === 0xffffffff) return ""
  return new TextDecoder("utf-8")
    .decode(buffer.slice(element.dataOffset, element.dataOffset + element.length))
    .replace(/\0/g, "")
    .trim()
}

function readNumberText(buffer: ArrayBuffer, element?: ParsedElement) {
  const text = readText(buffer, element)
  if (!text) return undefined
  const [first] = text.split("\\")
  const parsed = Number.parseFloat(first)
  return Number.isFinite(parsed) ? parsed : undefined
}

function readNumberList(buffer: ArrayBuffer, element?: ParsedElement) {
  const text = readText(buffer, element)
  if (!text) return undefined

  const values = text
    .split("\\")
    .map((item) => Number.parseFloat(item))
    .filter((item) => Number.isFinite(item))

  return values.length ? values : undefined
}

function readTextList(buffer: ArrayBuffer, element?: ParsedElement) {
  const text = readText(buffer, element)
  if (!text) return undefined
  const values = text.split("\\").filter(Boolean)
  return values.length ? values : undefined
}

function normalizeDicomDate(value: string) {
  return value.replace(/\D/g, "").slice(0, 8) || undefined
}

function normalizeDicomTime(value: string) {
  return value.replace(/[^\d.]/g, "").slice(0, 16) || undefined
}

function compactObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === undefined || item === "") return false
      if (Array.isArray(item) && item.length === 0) return false
      return true
    })
  ) as Partial<T>
}
