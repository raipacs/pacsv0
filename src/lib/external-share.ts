import { createHmac, timingSafeEqual } from "node:crypto"

const MAX_SHARE_TTL_SECONDS = 72 * 60 * 60

export type ExternalStudySharePayload = {
  exp: number
  organizationId: string
  scope: "study-viewer"
  studyId: string
  userId: string
}

export function createExternalStudyShareToken({
  now = Date.now(),
  ttlSeconds,
  ...payload
}: Omit<ExternalStudySharePayload, "exp" | "scope"> & {
  now?: number
  ttlSeconds: number
}) {
  const boundedTtl = Math.max(5 * 60, Math.min(MAX_SHARE_TTL_SECONDS, ttlSeconds))
  const exp = Math.floor(now / 1000) + boundedTtl
  const encodedPayload = base64UrlEncode(
    JSON.stringify({
      exp,
      organizationId: payload.organizationId,
      scope: "study-viewer",
      studyId: payload.studyId,
      userId: payload.userId,
    } satisfies ExternalStudySharePayload)
  )

  return `${encodedPayload}.${sign(encodedPayload)}`
}

export function verifyExternalStudyShareToken(token: string, studyId?: string) {
  const [encodedPayload, signature] = token.split(".")
  if (!encodedPayload || !signature) return null
  if (!constantTimeEqual(signature, sign(encodedPayload))) return null

  let parsed: ExternalStudySharePayload
  try {
    parsed = JSON.parse(base64UrlDecode(encodedPayload)) as ExternalStudySharePayload
  } catch {
    return null
  }

  if (parsed.scope !== "study-viewer") return null
  if (studyId && parsed.studyId !== studyId) return null
  if (parsed.exp < Math.floor(Date.now() / 1000)) return null

  return parsed
}

export function formatShareExpiry(token: string) {
  const payload = verifyExternalStudyShareToken(token)
  if (!payload) return null
  return new Date(payload.exp * 1000)
}

function sign(value: string) {
  return createHmac("sha256", getSecret()).update(value).digest("base64url")
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

function getSecret() {
  const secret =
    process.env.RAI_PACS_EXTERNAL_SHARE_SECRET ||
    process.env.RAI_PACS_OHIF_LAUNCH_SECRET ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY

  if (!secret) {
    throw new Error("External paylaşım secret tanımlı değil.")
  }

  return secret
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString("base64url")
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8")
}
