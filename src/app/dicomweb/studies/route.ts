import { dicomwebOptions, handleQidoStudies } from "@/lib/dicomweb"

export function OPTIONS(request: Request) {
  return dicomwebOptions(request)
}

export function GET(request: Request) {
  return handleQidoStudies(request)
}
