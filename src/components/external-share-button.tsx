"use client"

import { useState, useTransition } from "react"

import { createExternalStudyShareUrl } from "@/app/actions/storage"

const SHARE_OPTIONS = [
  { label: "1 saat", value: 60 * 60 },
  { label: "6 saat", value: 6 * 60 * 60 },
  { label: "24 saat", value: 24 * 60 * 60 },
  { label: "72 saat", value: 72 * 60 * 60 },
]

export function ExternalShareButton({ studyId }: { studyId: string }) {
  const [ttlSeconds, setTtlSeconds] = useState(24 * 60 * 60)
  const [shareUrl, setShareUrl] = useState("")
  const [expiresAt, setExpiresAt] = useState("")
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()

  function createShareLink() {
    setError("")
    setCopied(false)

    startTransition(async () => {
      const result = await createExternalStudyShareUrl(studyId, ttlSeconds)

      if (!result.ok) {
        setError(result.error)
        return
      }

      setShareUrl(result.url)
      setExpiresAt(result.expiresAt)

      try {
        await navigator.clipboard.writeText(result.url)
        setCopied(true)
      } catch {
        setCopied(false)
      }
    })
  }

  return (
    <div className="external-share-control">
      <div className="external-share-row">
        <select
          aria-label="Paylaşım süresi"
          value={ttlSeconds}
          onChange={(event) => setTtlSeconds(Number(event.target.value))}
        >
          {SHARE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          className="button subtle"
          type="button"
          disabled={isPending}
          onClick={createShareLink}
        >
          {isPending ? "Hazırlanıyor" : "Paylaş"}
        </button>
      </div>
      {shareUrl ? (
        <div className="external-share-result">
          <input readOnly aria-label="External paylaşım linki" value={shareUrl} />
          <button
            className="button subtle"
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(shareUrl)
              setCopied(true)
            }}
          >
            Kopyala
          </button>
          <span>
            {copied ? "Kopyalandı" : "Hazır"} · {formatExpiry(expiresAt)}
          </span>
        </div>
      ) : null}
      {error ? <p className="inline-error">{error}</p> : null}
    </div>
  )
}

function formatExpiry(value: string) {
  if (!value) return "süreli"
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value))
}
