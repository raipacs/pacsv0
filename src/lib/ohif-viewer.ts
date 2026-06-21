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
  const dicomJsonUrl = `${origin}/api/ohif/studies/${studyId}?token=${encodeURIComponent(
    token
  )}`

  return `https://viewer.ohif.org/viewer/dicomjson?url=${encodeURIComponent(
    dicomJsonUrl
  )}`
}
