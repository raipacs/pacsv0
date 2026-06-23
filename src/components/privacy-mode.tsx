"use client"

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

type PrivacyModeContextValue = {
  enabled: boolean
  maskId: (value: string) => string
  maskName: (value: string) => string
  toggle: () => void
}

const PrivacyModeContext = createContext<PrivacyModeContextValue | null>(null)

export function PrivacyModeProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false)

  const value = useMemo<PrivacyModeContextValue>(
    () => ({
      enabled,
      maskId,
      maskName,
      toggle: () => setEnabled((current) => !current),
    }),
    [enabled]
  )

  return (
    <PrivacyModeContext.Provider value={value}>
      {children}
    </PrivacyModeContext.Provider>
  )
}

export function PrivacyToggle() {
  const { enabled, toggle } = usePrivacyMode()

  return (
    <button
      className={`privacy-toggle${enabled ? " active" : ""}`}
      type="button"
      aria-pressed={enabled}
      aria-label={enabled ? "Hasta bilgilerini göster" : "Hasta bilgilerini gizle"}
      title={enabled ? "Hasta bilgilerini göster" : "Hasta bilgilerini gizle"}
      onClick={toggle}
    >
      <span className="privacy-toggle-label">Privacy</span>
      <span className="privacy-switch" aria-hidden="true">
        <span />
      </span>
    </button>
  )
}

export function MaskedPatientName({ value }: { value: string }) {
  const { enabled, maskName } = usePrivacyMode()
  return <>{enabled ? maskName(value) : value}</>
}

export function MaskedPatientId({ value }: { value: string }) {
  const { enabled, maskId } = usePrivacyMode()
  return <>{enabled ? maskId(value) : value}</>
}

export function usePrivacyMode() {
  const context = useContext(PrivacyModeContext)
  if (!context) {
    throw new Error("usePrivacyMode must be used inside PrivacyModeProvider.")
  }
  return context
}

function maskName(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => maskToken(part, 1))
    .join(" ")
}

function maskId(value: string) {
  return maskToken(value, 2)
}

function maskToken(value: string, visibleEdge: number) {
  const chars = Array.from(value.trim())
  if (chars.length <= visibleEdge * 2) return value

  const first = chars.slice(0, visibleEdge).join("")
  const last = chars.slice(-visibleEdge).join("")
  const maskedLength = Math.min(6, Math.max(2, chars.length - visibleEdge * 2))
  return `${first}${"*".repeat(maskedLength)}${last}`
}
