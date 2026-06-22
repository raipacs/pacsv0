"use client"

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react"

type PrivacyModeContextValue = {
  enabled: boolean
  maskId: (value: string) => string
  maskName: (value: string) => string
  toggle: () => void
}

const PrivacyModeContext = createContext<PrivacyModeContextValue | null>(null)
const STORAGE_KEY = "rai-pacs-privacy-mode"
const PRIVACY_MODE_EVENT = "rai-pacs-privacy-mode-change"

export function PrivacyModeProvider({ children }: { children: ReactNode }) {
  const enabled = useSyncExternalStore(
    subscribeToPrivacyMode,
    getPrivacyModeSnapshot,
    getServerPrivacyModeSnapshot
  )

  const value = useMemo<PrivacyModeContextValue>(
    () => ({
      enabled,
      maskId,
      maskName,
      toggle: () => {
        window.localStorage.setItem(STORAGE_KEY, enabled ? "off" : "on")
        window.dispatchEvent(new Event(PRIVACY_MODE_EVENT))
      },
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
      <span className="privacy-eye" aria-hidden="true" />
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

function getPrivacyModeSnapshot() {
  return window.localStorage.getItem(STORAGE_KEY) === "on"
}

function getServerPrivacyModeSnapshot() {
  return false
}

function subscribeToPrivacyMode(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener(PRIVACY_MODE_EVENT, callback)

  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(PRIVACY_MODE_EVENT, callback)
  }
}
