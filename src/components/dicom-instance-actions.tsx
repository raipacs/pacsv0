"use client"

import { useState, useTransition } from "react"

import { createDicomSignedUrl } from "@/app/actions/storage"

export function DicomInstanceActions({
  instanceId,
}: {
  instanceId: string
}) {
  const [error, setError] = useState("")
  const [isPending, startTransition] = useTransition()

  function openSignedUrl() {
    setError("")
    startTransition(async () => {
      const result = await createDicomSignedUrl(instanceId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      window.open(result.url, "_blank", "noopener,noreferrer")
    })
  }

  return (
    <span className="inline-actions">
      <button
        className="button subtle small"
        type="button"
        disabled={isPending}
        onClick={openSignedUrl}
      >
        {isPending ? "Hazirlaniyor" : "Signed URL"}
      </button>
      {error ? <span className="inline-error">{error}</span> : null}
    </span>
  )
}
