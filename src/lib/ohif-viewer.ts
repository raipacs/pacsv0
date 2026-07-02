import { createOhifLaunchToken } from "@/lib/ohif-launch"

const PUBLIC_OHIF_VIEWER_ORIGIN = "https://viewer.ohif.org"
const RAI_OHIF_VIEWER_PATH = "/ohif-viewer/viewer/dicomjson"

export function createOhifDicomJsonViewerUrl({
  origin,
  organizationId,
  returnUrl,
  studyId,
  userId,
}: {
  origin: string
  organizationId: string
  returnUrl?: string
  studyId: string
  userId: string
}) {
  const token = createOhifLaunchToken({
    organizationId,
    studyId,
    userId,
  })
  const manifestOrigin = getRaiOhifOrigin(origin)
  const dicomJsonUrl = `${manifestOrigin}/viewer-data/studies/${studyId}?token=${encodeURIComponent(
    token
  )}`

  return createRaiHostedOhifDicomJsonUrl({ manifestUrl: dicomJsonUrl, origin, returnUrl })
}

export function createOhifDicomJsonSessionViewerUrl({
  origin,
  organizationId,
  returnUrl,
  studyIds,
  userId,
}: {
  origin: string
  organizationId: string
  returnUrl?: string
  studyIds: string[]
  userId: string
}) {
  const normalizedStudyIds = Array.from(new Set(studyIds.filter(Boolean))).slice(0, 50)
  const token = createOhifLaunchToken({
    organizationId,
    scope: "study-session",
    studyIds: normalizedStudyIds,
    userId,
  })
  const manifestOrigin = getRaiOhifOrigin(origin)
  const dicomJsonUrl = `${manifestOrigin}/viewer-data/ohif-session?token=${encodeURIComponent(
    token
  )}`

  return createRaiHostedOhifDicomJsonUrl({ manifestUrl: dicomJsonUrl, origin, returnUrl })
}

export function createRaiOhifViewerUrl({
  origin,
  organizationId,
  studyId,
  userId,
}: {
  origin: string
  organizationId: string
  studyId: string
  userId: string
}) {
  const token = createOhifLaunchToken({
    organizationId,
    studyId,
    userId,
  })
  return createRaiOhifLaunchUrl({ origin, token })
}

export function createRaiOhifSessionViewerUrl({
  origin,
  organizationId,
  studyIds,
  userId,
}: {
  origin: string
  organizationId: string
  studyIds: string[]
  userId: string
}) {
  const normalizedStudyIds = Array.from(new Set(studyIds.filter(Boolean))).slice(0, 50)
  const token = createOhifLaunchToken({
    organizationId,
    scope: "study-session",
    studyIds: normalizedStudyIds,
    userId,
  })
  return createRaiOhifLaunchUrl({ origin, token })
}

export function createOhifDicomJsonFallbackUrl({
  origin,
  returnUrl,
  studyIds,
  token,
}: {
  origin: string
  returnUrl?: string
  studyIds: string[]
  token: string
}) {
  const normalizedStudyIds = Array.from(new Set(studyIds.filter(Boolean))).slice(0, 50)
  const manifestPath =
    normalizedStudyIds.length > 1
      ? "/viewer-data/ohif-session"
      : `/viewer-data/studies/${normalizedStudyIds[0]}`
  const manifestUrl = new URL(manifestPath, origin)
  manifestUrl.searchParams.set("token", token)

  return createRaiHostedOhifDicomJsonUrl({
    manifestUrl: manifestUrl.toString(),
    origin,
    returnUrl,
  })
}

export function createPublicOhifDicomJsonFallbackUrl({
  origin,
  studyIds,
  token,
}: {
  origin: string
  studyIds: string[]
  token: string
}) {
  const normalizedStudyIds = Array.from(new Set(studyIds.filter(Boolean))).slice(0, 50)
  const manifestPath =
    normalizedStudyIds.length > 1
      ? "/viewer-data/ohif-session"
      : `/viewer-data/studies/${normalizedStudyIds[0]}`
  const manifestUrl = new URL(manifestPath, origin)
  manifestUrl.searchParams.set("token", token)

  return `${PUBLIC_OHIF_VIEWER_ORIGIN}/viewer/dicomjson?url=${encodeURIComponent(
    manifestUrl.toString()
  )}`
}

function createRaiOhifLaunchUrl({ origin, token }: { origin: string; token: string }) {
  const baseOrigin = getRaiOhifOrigin(origin)
  const url = new URL("/ohif", baseOrigin)
  url.searchParams.set("token", token)
  return url.toString()
}

function createRaiHostedOhifDicomJsonUrl({
  manifestUrl,
  origin,
  returnUrl,
}: {
  manifestUrl: string
  origin: string
  returnUrl?: string
}) {
  const url = new URL(RAI_OHIF_VIEWER_PATH, getRaiOhifOrigin(origin))
  url.searchParams.set("url", manifestUrl)
  if (returnUrl) url.searchParams.set("returnUrl", returnUrl)
  return url.toString()
}

function getRaiOhifOrigin(origin: string) {
  return process.env.NEXT_PUBLIC_RAI_OHIF_ORIGIN || origin
}
