import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import { isSupabaseConfigured } from "@/lib/config"
import { updateSession } from "@/lib/supabase/proxy"

export async function proxy(request: NextRequest) {
  if (isDeveloperDocsHost(request)) {
    const rewriteUrl = request.nextUrl.clone()
    if (!rewriteUrl.pathname.startsWith("/dev")) {
      rewriteUrl.pathname = `/dev${rewriteUrl.pathname === "/" ? "" : rewriteUrl.pathname}`
    }
    return NextResponse.rewrite(rewriteUrl)
  }

  if (isOhifHost(request) && shouldRewriteOhifHostPath(request.nextUrl.pathname)) {
    const rewriteUrl = request.nextUrl.clone()
    rewriteUrl.pathname = `/ohif${rewriteUrl.pathname === "/" ? "" : rewriteUrl.pathname}`
    return NextResponse.rewrite(rewriteUrl)
  }

  if (!isSupabaseConfigured) return NextResponse.next()
  return updateSession(request)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}

function isDeveloperDocsHost(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0].toLowerCase()
  return host === "dev.raipacs.com"
}

function isOhifHost(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0].toLowerCase()
  return host === "ohif.raipacs.com"
}

function shouldRewriteOhifHostPath(pathname: string) {
  return ![
    "/_next",
    "/api",
    "/dicomweb",
    "/favicon.ico",
    "/ohif",
    "/viewer-data",
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}
