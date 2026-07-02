import { dicomwebOptions, handleStudyMetadata } from "@/lib/dicomweb"

type RouteContext = {
  params: Promise<{ studyInstanceUid: string }>
}

export function OPTIONS(request: Request) {
  return dicomwebOptions(request)
}

export async function GET(request: Request, context: RouteContext) {
  const { studyInstanceUid } = await context.params
  return handleStudyMetadata(request, studyInstanceUid)
}
