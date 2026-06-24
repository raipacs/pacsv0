import { decodeDicomPreview, type DicomPreview } from "@/lib/dicom-viewer"

type DecodeRequest = {
  id: number
  buffer: ArrayBuffer
}

type DecodeResponse =
  | {
      id: number
      ok: true
      preview: DicomPreview
    }
  | {
      id: number
      ok: false
      error: string
    }

const worker = self as unknown as {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<DecodeRequest>) => void
  ): void
  postMessage(message: DecodeResponse, transfer?: Transferable[]): void
}

worker.addEventListener("message", async (event: MessageEvent<DecodeRequest>) => {
  const { id, buffer } = event.data

  try {
    const preview = await decodeDicomPreview(buffer)
    const transferList: Transferable[] = []

    if (preview.pixels) {
      transferList.push(preview.pixels.buffer)
    }

    worker.postMessage({ id, ok: true, preview } satisfies DecodeResponse, transferList)
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : "DICOM çözümlenemedi."
    worker.postMessage({ id, ok: false, error } satisfies DecodeResponse)
  }
})
