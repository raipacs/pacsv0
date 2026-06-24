import { buildShareResponse } from "@/lib/share-response"

type RouteContext = {
  params: Promise<{ token: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params

  return buildShareResponse(decodeURIComponent(token))
}
