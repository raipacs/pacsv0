import { dicomwebOptions, handleSeriesMetadata } from "@/lib/dicomweb"

type RouteContext = {
  params: Promise<{ seriesInstanceUid: string; studyInstanceUid: string }>
}

export function OPTIONS(request: Request) {
  return dicomwebOptions(request)
}

export async function GET(request: Request, context: RouteContext) {
  const { seriesInstanceUid, studyInstanceUid } = await context.params
  return handleSeriesMetadata(request, studyInstanceUid, seriesInstanceUid)
}
