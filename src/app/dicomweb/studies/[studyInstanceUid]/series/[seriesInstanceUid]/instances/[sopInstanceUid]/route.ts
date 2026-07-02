import { dicomwebOptions, handleRetrieveInstance } from "@/lib/dicomweb"

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

export async function HEAD(request: Request, context: RouteContext) {
  return handleRetrieveInstance(request, await context.params, "HEAD")
}

export async function GET(request: Request, context: RouteContext) {
  return handleRetrieveInstance(request, await context.params, "GET")
}
