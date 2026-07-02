import { createOhifLaunchToken } from "@/lib/ohif-launch"

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
