export type AiProviderOption = {
  id: string
  name: string
  slug: string
  providerType: string
  defaultModel: string | null
  isActive: boolean
  isDefault: boolean
  requiresCredentials: boolean
}

export type MockAiDraftInput = {
  accessionNumber: string
  description: string | null
  modality: string
  patientName: string
  patientNumber: string
  studyAt: string | null
  instanceCount: number
  seriesCount: number
}

const pricingUsdPerMillionTokens: Record<
  string,
  { input: number; output: number; note: string }
> = {
  "rai-mock": { input: 0, output: 0, note: "Mock geliştirme sağlayıcısı" },
  openai: { input: 1.25, output: 10, note: "Temsili varsayılan fiyat" },
  claude: { input: 3, output: 15, note: "Temsili varsayılan fiyat" },
  gemini: { input: 1.25, output: 10, note: "Temsili varsayılan fiyat" },
}

export function createMockRadiologyDraft(input: MockAiDraftInput) {
  const modality = input.modality || "DICOM"
  const studyName = input.description || "Görüntüleme tetkiki"
  const countText = `${input.seriesCount} seri, ${input.instanceCount} instance`

  return {
    findings: [
      `AI ön değerlendirme ${modality} tetkiki için hazırlanmıştır.`,
      `${studyName} çalışmasında ${countText} metadata üzerinden incelenmek üzere kuyruğa alınmıştır.`,
      "Bu MVP çıktısı görüntü tabanlı tanı koymaz; DICOM serileri, tetkik açıklaması ve klinik rapor taslak akışını doğrulamak için üretilmiştir.",
      "Görüntüler radyolog tarafından viewer üzerinde klinik bağlamla birlikte değerlendirilmelidir.",
    ].join("\n"),
    impression: [
      "AI destekli ön rapor taslağı hazır.",
      "Nihai rapor için hekim değerlendirmesi, düzenlemesi ve onayı gereklidir.",
    ].join("\n"),
    recommendations:
      "Gerçek medikal AI servisi bağlandığında bulgu/ölçüm/seri referansları bu alana otomatik aktarılacaktır.",
    confidenceScore: 0.62,
    criticality: "none" as const,
    sourceSummary: {
      accessionNumber: input.accessionNumber,
      modality,
      patientNumber: input.patientNumber,
      studyAt: input.studyAt,
      instanceCount: input.instanceCount,
      seriesCount: input.seriesCount,
      generator: "rai-mock-radiology-v0",
    },
  }
}

export function estimateTokenUsage({
  findings,
  impression,
  inputContext,
}: {
  findings: string
  impression: string
  inputContext: Record<string, unknown>
}) {
  const inputChars = JSON.stringify(inputContext).length
  const outputChars = `${findings}\n${impression}`.length

  return {
    inputTokens: Math.max(120, Math.ceil(inputChars / 4)),
    outputTokens: Math.max(180, Math.ceil(outputChars / 4)),
  }
}

export function calculateAiUsageCost({
  inputTokens,
  outputTokens,
  providerSlug,
}: {
  inputTokens: number
  outputTokens: number
  providerSlug: string
}) {
  const pricing = pricingUsdPerMillionTokens[providerSlug] ?? {
    input: 0,
    output: 0,
    note: "Fiyat tanımı bekliyor",
  }
  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output

  return {
    currency: "USD",
    inputCost,
    outputCost,
    pricingSnapshot: {
      inputUsdPerMillionTokens: pricing.input,
      outputUsdPerMillionTokens: pricing.output,
      note: pricing.note,
    },
  }
}

export function isMissingAiTableError(error: { code?: string; message?: string } | null) {
  if (!error) return false
  return error.code === "42P01" || /ai_(service_providers|jobs|report_drafts)/i.test(error.message ?? "")
}

export function aiJobStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "draft_ready":
      return "Ön rapor hazır"
    case "queued":
      return "Kuyrukta"
    case "running":
      return "Çalışıyor"
    case "waiting_credentials":
      return "Hesap bilgisi bekliyor"
    case "failed":
      return "Başarısız"
    case "cancelled":
      return "İptal"
    default:
      return "Bekliyor"
  }
}
