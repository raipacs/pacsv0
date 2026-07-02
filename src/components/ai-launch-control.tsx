"use client"

import { useMemo, useState } from "react"
import { useFormStatus } from "react-dom"

import { startAiPreReport } from "@/app/actions/ai"
import { CopyErrorButton } from "@/components/copy-error-button"
import { aiProviderMark, type AiProviderOption } from "@/lib/ai-reporting"

type AiLaunchJobStatus = {
  completedAt: string | null
  createdAt: string
  errorMessage: string | null
  modelName: string | null
  providerName: string
  status: string
}

export function AiLaunchControl({
  initialProviderId,
  latestJob,
  providers,
  reuseProviderId,
  returnTo,
  studyId,
  unavailableReason,
}: {
  initialProviderId?: string
  latestJob: AiLaunchJobStatus | null
  providers: AiProviderOption[]
  reuseProviderId?: string
  returnTo: string
  studyId: string
  unavailableReason?: string
}) {
  const activeProviders = providers.filter((provider) => provider.isActive)
  const defaultProvider =
    activeProviders.find((provider) => provider.isDefault) ?? activeProviders[0] ?? null
  const initialProvider =
    activeProviders.find((provider) => provider.id === initialProviderId) ?? defaultProvider
  const disabled = Boolean(unavailableReason) || !defaultProvider
  const [selectedProviderId, setSelectedProviderId] = useState(initialProvider?.id ?? "")
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
        reuseProviderId={reuseProviderId}
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
  reuseProviderId,
  selectedProvider,
  selectedProviderId,
  unavailableReason,
}: {
  disabled: boolean
  latestJob: AiLaunchJobStatus | null
  onProviderChange: (providerId: string) => void
  providers: AiProviderOption[]
  reuseProviderId?: string
  selectedProvider: AiProviderOption | null
  selectedProviderId: string
  unavailableReason?: string
}) {
  const { pending } = useFormStatus()
  const isDisabled = disabled || pending
  const shouldForceRerun = Boolean(reuseProviderId && reuseProviderId === selectedProviderId)
  const statusText = pending
    ? formatPendingAiJob(selectedProvider)
    : unavailableReason || formatLatestAiJob(latestJob, selectedProvider, shouldForceRerun)
  const canCopyLatestError =
    !pending &&
    ["endpoint_waking", "failed"].includes(latestJob?.status ?? "") &&
    Boolean(latestJob?.errorMessage)

  return (
    <>
      {shouldForceRerun ? (
        <input name="forceAiRunProviderId" type="hidden" value={selectedProviderId} />
      ) : null}
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
            {formatProviderName(provider)}
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
      <span className="ai-launch-status-row">
        <span
          className={`ai-launch-status${pending ? " is-running" : ""}`}
          aria-live="polite"
          title={statusText}
        >
          {statusText}
        </span>
        {canCopyLatestError ? <CopyErrorButton text={statusText} /> : null}
      </span>
    </>
  )
}

function formatPendingAiJob(provider: AiProviderOption | null) {
  if (!provider) return "AI çalışıyor..."

  const label = `${formatProviderName(provider)}${provider.defaultModel ? ` · ${provider.defaultModel}` : ""}`
  if (provider.slug === "medgemma") {
    return `${label} çalışıyor... Endpoint uyanıyorsa 1-2 dk sürebilir.`
  }
  if (provider.slug === "rai-orchestrator") {
    return `${label} uygun AI sağlayıcısına yönlendiriliyor...`
  }

  return `${label} çalışıyor...`
}

function formatLatestAiJob(
  job: AiLaunchJobStatus | null,
  selectedProvider: AiProviderOption | null,
  shouldForceRerun: boolean
) {
  if (shouldForceRerun && selectedProvider) {
    return `${formatProviderName(selectedProvider)} ile önceki rapor açıldı. Yeniden çalıştırmak için AI'ya tekrar basın.`
  }

  if (!job) return "AI otomatik çalışmaz; butona basınca seçili servis başlar."

  const when = formatShortDateTime(job.completedAt ?? job.createdAt)
  const provider = `${job.providerName}${job.modelName ? ` · ${job.modelName}` : ""}`
  const status = aiJobStatusLabel(job.status)
  const error = ["endpoint_waking", "failed"].includes(job.status) && job.errorMessage ? ` · ${job.errorMessage}` : ""

  return `Son AI: ${status} · ${provider} · ${when}${error}`
}

function formatProviderName(provider: AiProviderOption) {
  return `${aiProviderMark({ providerType: provider.providerType, slug: provider.slug })} ${provider.name}`
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
    case "endpoint_waking":
      return "Endpoint uyanıyor"
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
    timeZone: "Europe/Istanbul",
  }).format(new Date(value))
}
