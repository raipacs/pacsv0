import { startAiPreReport } from "@/app/actions/ai"
import type { AiProviderOption } from "@/lib/ai-reporting"

export function AiLaunchControl({
  providers,
  returnTo,
  studyId,
  unavailableReason,
}: {
  providers: AiProviderOption[]
  returnTo: string
  studyId: string
  unavailableReason?: string
}) {
  const activeProviders = providers.filter((provider) => provider.isActive)
  const defaultProvider =
    activeProviders.find((provider) => provider.isDefault) ?? activeProviders[0] ?? null
  const disabled = Boolean(unavailableReason) || !defaultProvider

  return (
    <form action={startAiPreReport} className="ai-launch-control">
      <input name="studyId" type="hidden" value={studyId} />
      <input name="returnTo" type="hidden" value={returnTo} />
      <select
        aria-label="AI servisi"
        defaultValue={defaultProvider?.id ?? ""}
        disabled={disabled}
        name="providerId"
        title={unavailableReason ?? "AI servisi seç"}
      >
        {defaultProvider ? null : <option value="">AI servisi yok</option>}
        {providers.map((provider) => (
          <option disabled={!provider.isActive} key={provider.id} value={provider.id}>
            {provider.name}
            {provider.defaultModel ? ` · ${provider.defaultModel}` : ""}
            {provider.isActive ? "" : " · hesap bekliyor"}
          </option>
        ))}
      </select>
      <button className="button primary ai-launch-button" disabled={disabled} type="submit">
        AI
      </button>
    </form>
  )
}
