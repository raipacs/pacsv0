import { createOhifLaunchToken } from "@/lib/ohif-launch"

const PUBLIC_OHIF_VIEWER_ORIGIN = "https://viewer.ohif.org"

export function createOhifDicomJsonViewerUrl({
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
  const dicomJsonUrl = `${origin}/viewer-data/studies/${studyId}?token=${encodeURIComponent(
    token
  )}`

  return `https://viewer.ohif.org/viewer/dicomjson?url=${encodeURIComponent(
    dicomJsonUrl
  )}`
}

export function createOhifDicomJsonSessionViewerUrl({
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
  const dicomJsonUrl = `${origin}/viewer-data/ohif-session?token=${encodeURIComponent(
    token
  )}`

  return `https://viewer.ohif.org/viewer/dicomjson?url=${encodeURIComponent(
    dicomJsonUrl
  )}`
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
  const baseOrigin = process.env.NEXT_PUBLIC_RAI_OHIF_ORIGIN || origin
  const url = new URL("/ohif", baseOrigin)
  url.searchParams.set("token", token)
  return url.toString()
}
