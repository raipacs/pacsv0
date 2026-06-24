import { buildShareResponse } from "@/lib/share-response"

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const token = requestUrl.searchParams.get("token") ?? ""
  const shareId = requestUrl.searchParams.get("s") ?? ""

  return buildShareResponse({ shareId, token })
}
