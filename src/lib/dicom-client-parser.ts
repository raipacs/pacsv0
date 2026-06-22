"use client"

export type ParsedDicomMetadata = {
  patientName: string
  patientDicomId: string
  patientBirthDate: string
  patientSex: string
  accessionNumber: string
  modality: string
  bodyPart: string
  description: string
  studyAt: string
  studyInstanceUid: string
  seriesInstanceUid: string
  sopInstanceUid: string
  seriesNumber: string
  instanceNumber: string
  sopClassUid: string
  transferSyntaxUid: string
}

type DicomTag =
  | "specificCharacterSet"
  | "patientName"
  | "patientDicomId"
  | "patientBirthDate"
  | "patientSex"
  | "accessionNumber"
  | "modality"
  | "bodyPart"
  | "studyDescription"
  | "seriesDescription"
  | "studyDate"
  | "studyTime"
  | "studyInstanceUid"
  | "seriesInstanceUid"
  | "sopInstanceUid"
  | "seriesNumber"
  | "instanceNumber"
  | "sopClassUid"
  | "transferSyntaxUid"

const WANTED_TAGS = new Map<string, DicomTag>([
  ["0002,0010", "transferSyntaxUid"],
  ["0008,0005", "specificCharacterSet"],
  ["0008,0016", "sopClassUid"],
  ["0008,0018", "sopInstanceUid"],
  ["0008,0020", "studyDate"],
  ["0008,0030", "studyTime"],
  ["0008,0050", "accessionNumber"],
  ["0008,0060", "modality"],
  ["0008,1030", "studyDescription"],
  ["0008,103e", "seriesDescription"],
  ["0010,0010", "patientName"],
  ["0010,0020", "patientDicomId"],
  ["0010,0030", "patientBirthDate"],
  ["0010,0040", "patientSex"],
  ["0018,0015", "bodyPart"],
  ["0020,000d", "studyInstanceUid"],
  ["0020,000e", "seriesInstanceUid"],
  ["0020,0011", "seriesNumber"],
  ["0020,0013", "instanceNumber"],
])

const LONG_VR = new Set(["OB", "OD", "OF", "OL", "OW", "SQ", "UC", "UR", "UT", "UN"])
const NUMERIC_TAGS = new Set(["0020,0011", "0020,0013"])
const MAX_HEADER_BYTES = 1024 * 1024

export async function parseDicomMetadata(file: File): Promise<ParsedDicomMetadata> {
  if (file.size < 132) {
    throw new Error("DICOM dosyası çok küçük.")
  }

  const buffer = await file.slice(0, Math.min(file.size, MAX_HEADER_BYTES)).arrayBuffer()
  const bytes = new Uint8Array(buffer)

  if (!hasDicomPreamble(bytes)) {
    throw new Error("DICOM preamble imzası bulunamadı.")
  }

  const view = new DataView(buffer)
  const state: Partial<Record<DicomTag, string>> = {}
  const meta = parseExplicitVr(view, bytes, 132, state, true)
  const transferSyntaxUid = state.transferSyntaxUid ?? ""
  const explicitVr = transferSyntaxUid !== "1.2.840.10008.1.2"

  if (explicitVr) {
    parseExplicitVr(view, bytes, meta.nextOffset, state, false)
  } else {
    parseImplicitVr(view, bytes, meta.nextOffset, state)
  }

  const description =
    state.studyDescription || state.seriesDescription || `${state.modality || "DICOM"} import`

  return {
    patientName: state.patientName ?? "",
    patientDicomId: state.patientDicomId ?? "",
    patientBirthDate: state.patientBirthDate ?? "",
    patientSex: state.patientSex ?? "",
    accessionNumber: state.accessionNumber ?? "",
    modality: state.modality ?? "",
    bodyPart: state.bodyPart ?? "",
    description,
    studyAt: dicomDateTimeToInputValue(state.studyDate ?? "", state.studyTime ?? ""),
    studyInstanceUid: state.studyInstanceUid ?? "",
    seriesInstanceUid: state.seriesInstanceUid ?? "",
    sopInstanceUid: state.sopInstanceUid ?? "",
    seriesNumber: state.seriesNumber ?? "",
    instanceNumber: state.instanceNumber ?? "",
    sopClassUid: state.sopClassUid ?? "",
    transferSyntaxUid,
  }
}

export function isDicomInstanceMetadata(metadata: ParsedDicomMetadata) {
  return Boolean(
    metadata.studyInstanceUid &&
      metadata.seriesInstanceUid &&
      metadata.sopInstanceUid &&
      metadata.modality
  )
}

function parseExplicitVr(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
  state: Partial<Record<DicomTag, string>>,
  fileMetaOnly: boolean
) {
  let position = offset
  let decoder = decoderFor(state.specificCharacterSet)

  while (position + 8 <= view.byteLength) {
    const group = view.getUint16(position, true)
    const element = view.getUint16(position + 2, true)

    if (fileMetaOnly && group !== 0x0002) break
    if (group === 0x7fe0 && element === 0x0010) break

    position += 4
    const vr = String.fromCharCode(bytes[position], bytes[position + 1])
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

    if (length === 0xffffffff) {
      const sequenceEnd = findUndefinedLengthSequenceEnd(view, position)
      if (sequenceEnd < 0) break
      position = sequenceEnd
      continue
    }
    if (position + length > view.byteLength) break

    readValue(view, bytes, position, length, state, decoder, group, element)
    if (group === 0x0008 && element === 0x0005) {
      decoder = decoderFor(state.specificCharacterSet)
    }

    position += length + (length % 2)
  }

  return { nextOffset: position }
}

function parseImplicitVr(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
  state: Partial<Record<DicomTag, string>>
) {
  let position = offset
  let decoder = decoderFor(state.specificCharacterSet)

  while (position + 8 <= view.byteLength) {
    const group = view.getUint16(position, true)
    const element = view.getUint16(position + 2, true)

    if (group === 0x7fe0 && element === 0x0010) break

    position += 4
    const length = view.getUint32(position, true)
    position += 4

    if (length === 0xffffffff) {
      const sequenceEnd = findUndefinedLengthSequenceEnd(view, position)
      if (sequenceEnd < 0) break
      position = sequenceEnd
      continue
    }
    if (position + length > view.byteLength) break

    readValue(view, bytes, position, length, state, decoder, group, element)
    if (group === 0x0008 && element === 0x0005) {
      decoder = decoderFor(state.specificCharacterSet)
    }

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

function readValue(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
  length: number,
  state: Partial<Record<DicomTag, string>>,
  decoder: TextDecoder,
  group: number,
  element: number
) {
  const key = `${group.toString(16).padStart(4, "0")},${element
    .toString(16)
    .padStart(4, "0")}`
  const target = WANTED_TAGS.get(key)
  if (!target) return

  if (NUMERIC_TAGS.has(key) && length === 2) {
    state[target] = String(view.getUint16(offset, true))
    return
  }

  if (NUMERIC_TAGS.has(key) && length === 4) {
    state[target] = String(view.getUint32(offset, true))
    return
  }

  state[target] = decoder
    .decode(bytes.slice(offset, offset + length))
    .replace(/\0/g, "")
    .trim()
}

function hasDicomPreamble(bytes: Uint8Array) {
  return (
    bytes[128] === 0x44 &&
    bytes[129] === 0x49 &&
    bytes[130] === 0x43 &&
    bytes[131] === 0x4d
  )
}

function decoderFor(specificCharacterSet?: string) {
  const normalized = specificCharacterSet?.toUpperCase() ?? ""

  if (normalized.includes("ISO_IR 148")) {
    return new TextDecoder("iso-8859-9")
  }

  if (normalized.includes("ISO_IR 100")) {
    return new TextDecoder("iso-8859-1")
  }

  return new TextDecoder("utf-8")
}

function dicomDateTimeToInputValue(date: string, time: string) {
  if (!/^\d{8}$/.test(date)) return ""

  const hour = time.slice(0, 2).padEnd(2, "0") || "00"
  const minute = time.slice(2, 4).padEnd(2, "0") || "00"

  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${hour}:${minute}`
}
