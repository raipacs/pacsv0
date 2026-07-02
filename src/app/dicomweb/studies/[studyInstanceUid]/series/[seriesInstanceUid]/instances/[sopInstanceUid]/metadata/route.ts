import { dicomwebOptions, handleInstanceMetadata } from "@/lib/dicomweb"

type RouteContext = {
  params: Promise<{
    seriesInstanceUid: string
    sopInstanceUid: string
    studyInstanceUid: string
  }>
}

export function OPTIONS(request: Request) {
  return dicomwebOptions(request)
}

export async function GET(request: Request, context: RouteContext) {
  const { seriesInstanceUid, sopInstanceUid, studyInstanceUid } = await context.params
  return handleInstanceMetadata(
    request,
    studyInstanceUid,
    seriesInstanceUid,
    sopInstanceUid
  )
}
