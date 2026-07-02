import { dicomwebOptions, handleRetrieveFrames } from "@/lib/dicomweb"

type RouteContext = {
  params: Promise<{
    frameList: string
    seriesInstanceUid: string
    sopInstanceUid: string
    studyInstanceUid: string
  }>
}

export function OPTIONS(request: Request) {
  return dicomwebOptions(request)
}

export async function GET(request: Request, context: RouteContext) {
  return handleRetrieveFrames(request, await context.params)
}
