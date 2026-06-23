import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"

const CAPTCHA_MAX_AGE_MS = 10 * 60 * 1000
const CAPTCHA_MIN_AGE_MS = 900

export type LoginCaptchaChallenge = {
  issuedAt: string
  nonce: string
  token: string
}

export function createLoginCaptchaChallenge(): LoginCaptchaChallenge {
  const issuedAt = String(Date.now())
  const nonce = randomUUID()
  return {
    issuedAt,
    nonce,
    token: signChallenge(issuedAt, nonce),
  }
}

export function verifyLoginCaptcha(formData: FormData) {
  const issuedAt = String(formData.get("captchaIssuedAt") ?? "")
  const nonce = String(formData.get("captchaNonce") ?? "")
  const token = String(formData.get("captchaToken") ?? "")
  const elapsed = Number(formData.get("captchaElapsed") ?? 0)
  const browserSignal = String(formData.get("captchaBrowserSignal") ?? "")
  const trap = String(formData.get("website") ?? "")

  if (trap) return false
  if (browserSignal !== "ready") return false
  if (!issuedAt || !nonce || !token) return false
  if (!Number.isFinite(elapsed) || elapsed < CAPTCHA_MIN_AGE_MS) return false

  const issuedAtMs = Number(issuedAt)
  if (!Number.isFinite(issuedAtMs)) return false

  const age = Date.now() - issuedAtMs
  if (age < CAPTCHA_MIN_AGE_MS || age > CAPTCHA_MAX_AGE_MS) return false

  const expected = signChallenge(issuedAt, nonce)
  return safeEqual(token, expected)
}

function signChallenge(issuedAt: string, nonce: string) {
  return createHmac("sha256", getCaptchaSecret())
    .update(`${issuedAt}.${nonce}`)
    .digest("base64url")
}

function getCaptchaSecret() {
  return (
    process.env.RAI_PACS_LOGIN_CAPTCHA_SECRET ||
    process.env.RAI_PACS_OHIF_LAUNCH_SECRET ||
    process.env.SUPABASE_SECRET_KEY ||
    "rai-pacs-development-login-captcha"
  )
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}
