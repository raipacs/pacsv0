import { createHmac, timingSafeEqual } from "node:crypto"

const TOKEN_TTL_SECONDS = 60 * 60

type OhifLaunchPayload = {
  exp: number
  organizationId: string
  studyId: string
  userId: string
}

export function createOhifLaunchToken(
  payload: Omit<OhifLaunchPayload, "exp">,
  now = Date.now()
) {
  const exp = Math.floor(now / 1000) + TOKEN_TTL_SECONDS
  const encodedPayload = base64UrlEncode(
    JSON.stringify({
      exp,
      organizationId: payload.organizationId,
      studyId: payload.studyId,
      userId: payload.userId,
    } satisfies OhifLaunchPayload)
  )
  return `${encodedPayload}.${sign(encodedPayload)}`
}

export function verifyOhifLaunchToken(token: string, studyId: string) {
  const [encodedPayload, signature] = token.split(".")
  if (!encodedPayload || !signature) return null
  if (!constantTimeEqual(signature, sign(encodedPayload))) return null

  let parsed: OhifLaunchPayload
  try {
    parsed = JSON.parse(base64UrlDecode(encodedPayload)) as OhifLaunchPayload
  } catch {
    return null
  }

  if (parsed.studyId !== studyId) return null
  if (parsed.exp < Math.floor(Date.now() / 1000)) return null

  return parsed
}

export function hasOhifLaunchSecret() {
  return Boolean(readSecret())
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
  const secret = readSecret()

  if (!secret) {
    throw new Error(
      "RAI_PACS_OHIF_LAUNCH_SECRET veya SUPABASE_SECRET_KEY tanımlı değil."
    )
  }

  return secret
}

function readSecret() {
  return (
    process.env.RAI_PACS_OHIF_LAUNCH_SECRET ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
  )
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString("base64url")
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8")
}
