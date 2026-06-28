"use client"

import { useState } from "react"

export function CopyErrorButton({
  className = "",
  text,
}: {
  className?: string
  text: string
}) {
  const [copied, setCopied] = useState(false)
  const value = text.trim()

  if (!value) return null

  return (
    <button
      aria-label="Hatayı kopyala"
      className={`copy-error-button${className ? ` ${className}` : ""}`}
      onClick={async () => {
        await copyToClipboard(value)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      }}
      title={copied ? "Kopyalandı" : "Hatayı kopyala"}
      type="button"
    >
      {copied ? "✓" : "⧉"}
    </button>
  )
}

async function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Fall back to the legacy copy path below.
    }
  }

  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  textarea.style.top = "0"
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand("copy")
  document.body.removeChild(textarea)
}
