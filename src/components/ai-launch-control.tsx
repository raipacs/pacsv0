"use client"

import { useMemo, useState } from "react"
import { useFormStatus } from "react-dom"

import { startAiPreReport } from "@/app/actions/ai"
import type { AiProviderOption } from "@/lib/ai-reporting"

type AiLaunchJobStatus = {
  completedAt: string | null
  createdAt: string
  errorMessage: string | null
  modelName: string | null
  providerName: string
  status: string
}

export function AiLaunchControl({
  latestJob,
  providers,
  returnTo,
  studyId,
  unavailableReason,
}: {
  latestJob: AiLaunchJobStatus | null
  providers: AiProviderOption[]
  returnTo: string
  studyId: string
  unavailableReason?: string
}) {
  const activeProviders = providers.filter((provider) => provider.isActive)
  const defaultProvider =
    activeProviders.find((provider) => provider.isDefault) ?? activeProviders[0] ?? null
  const disabled = Boolean(unavailableReason) || !defaultProvider
  const [selectedProviderId, setSelectedProviderId] = useState(defaultProvider?.id ?? "")
  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? defaultProvider,
    [defaultProvider, providers, selectedProviderId]
  )

  return (
    <form action={startAiPreReport} className="ai-launch-control">
      <input name="studyId" type="hidden" value={studyId} />
      <input name="returnTo" type="hidden" value={returnTo} />
      <AiLaunchFields
        disabled={disabled}
        latestJob={latestJob}
        onProviderChange={setSelectedProviderId}
        providers={providers}
        selectedProvider={selectedProvider}
        selectedProviderId={selectedProviderId}
        unavailableReason={unavailableReason}
      />
    </form>
  )
}

function AiLaunchFields({
  disabled,
  latestJob,
  onProviderChange,
  providers,
  selectedProvider,
  selectedProviderId,
  unavailableReason,
}: {
  disabled: boolean
  latestJob: AiLaunchJobStatus | null
  onProviderChange: (providerId: string) => void
  providers: AiProviderOption[]
  selectedProvider: AiProviderOption | null
  selectedProviderId: string
  unavailableReason?: string
}) {
  const { pending } = useFormStatus()
  const isDisabled = disabled || pending
  const selectedProviderLabel = selectedProvider
    ? `${selectedProvider.name}${selectedProvider.defaultModel ? ` · ${selectedProvider.defaultModel}` : ""}`
    : "AI servisi yok"
  const statusText = pending
    ? `${selectedProviderLabel} çalışıyor...`
    : unavailableReason || formatLatestAiJob(latestJob)

  return (
    <>
      <select
        aria-label="AI servisi"
        disabled={isDisabled}
        name="providerId"
        onChange={(event) => onProviderChange(event.target.value)}
        title={unavailableReason ?? "AI servisi seç"}
        value={selectedProviderId}
      >
        {selectedProvider ? null : <option value="">AI servisi yok</option>}
        {providers.map((provider) => (
          <option disabled={!provider.isActive} key={provider.id} value={provider.id}>
            {provider.name}
            {provider.defaultModel ? ` · ${provider.defaultModel}` : ""}
            {provider.isActive ? "" : " · hesap bekliyor"}
          </option>
        ))}
      </select>
      <button
        aria-live="polite"
        className="button primary ai-launch-button"
        disabled={isDisabled}
        type="submit"
      >
        {pending ? "AI çalışıyor..." : "AI"}
      </button>
      <span
        className={`ai-launch-status${pending ? " is-running" : ""}`}
        aria-live="polite"
        title={statusText}
      >
        {statusText}
      </span>
    </>
  )
}

function formatLatestAiJob(job: AiLaunchJobStatus | null) {
  if (!job) return "AI otomatik çalışmaz; butona basınca seçili servis başlar."

  const when = formatShortDateTime(job.completedAt ?? job.createdAt)
  const provider = `${job.providerName}${job.modelName ? ` · ${job.modelName}` : ""}`
  const status = aiJobStatusLabel(job.status)
  const error = job.status === "failed" && job.errorMessage ? ` · ${job.errorMessage}` : ""

  return `Son AI: ${status} · ${provider} · ${when}${error}`
}

function aiJobStatusLabel(status: string) {
  switch (status) {
    case "draft_ready":
      return "Ön rapor hazır"
    case "failed":
      return "Başarısız"
    case "running":
      return "Çalışıyor"
    case "waiting_credentials":
      return "Hesap bekliyor"
    default:
      return status
  }
}

function formatShortDateTime(value: string | null) {
  if (!value) return "-"
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value))
}
