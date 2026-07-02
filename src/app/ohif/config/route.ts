import { NextResponse } from "next/server"

import { getOhifLaunchStudyIds, verifyOhifLaunchToken } from "@/lib/ohif-launch"

export const dynamic = "force-dynamic"

export function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders() })
}

export function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const token = requestUrl.searchParams.get("token") ?? ""
  const launch = verifyOhifLaunchToken(token)

  if (!launch) {
    return NextResponse.json(
      { error: "OHIF launch token gecersiz veya suresi doldu." },
      { headers: corsHeaders(), status: 401 }
    )
  }

  const dicomwebRoot = new URL("/dicomweb", requestUrl.origin).toString()

  return NextResponse.json(
    {
      auth: {
        expiresAt: launch.exp,
        scope: launch.scope ?? "study",
        studyIds: getOhifLaunchStudyIds(launch),
      },
      dataSources: [
        {
          configuration: {
            enableStudyLazyLoad: true,
            imageRendering: "wadors",
            qidoRoot: dicomwebRoot,
            requestOptions: {
              auth: `Bearer ${token}`,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
            supportsFuzzyMatching: false,
            supportsWildcard: true,
            thumbnailRendering: "wadors",
            wadoRoot: dicomwebRoot,
            wadoUriRoot: dicomwebRoot,
          },
          friendlyName: "RAI PACS DICOMweb",
          namespace: "@ohif/extension-default.dataSourcesModule.dicomweb",
          sourceName: "rai-pacs-dicomweb",
        },
      ],
      defaultDataSourceName: "rai-pacs-dicomweb",
      name: "RAI PACS OHIF",
      version: "0.2.0-dev",
    },
    { headers: corsHeaders() }
  )
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Headers": "accept, authorization, content-type, origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "private, no-store",
  }
}
