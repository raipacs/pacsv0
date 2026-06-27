# MedGemma entegrasyonu

RAI PACS MedGemma'yi dogrudan model olarak indirmez. Uygulama, MedGemma'nin
calistigi harici bir endpoint'e tetkik baglami ve kisa sureli DICOM referanslari
gonderir. Endpoint sonucu JSON on rapor taslagi olarak donmelidir.

## Gerekli secret'lar

- `RAI_MEDGEMMA_ENDPOINT`: MedGemma endpoint URL'i.
- `RAI_MEDGEMMA_API_KEY`: Endpoint Bearer token istiyorsa kullanilir.
- `RAI_MEDGEMMA_ENDPOINT_MODE`: Opsiyonel. `rai-adapter` veya
  `openai-compatible`. Varsayilan `rai-adapter`; endpoint URL'i
  `/v1/chat/completions` icerirse otomatik `openai-compatible` secilir.

## RAI adapter endpoint sozlesmesi

`RAI_MEDGEMMA_ENDPOINT_MODE=rai-adapter` iken RAI asagidaki JSON'u POST eder:

```json
{
  "task": "radiology_pre_report",
  "model": "medgemma-4b-it",
  "patientName": "Hasta adi",
  "study": {
    "accessionNumber": "string",
    "description": "string",
    "instanceCount": 1,
    "modality": "US",
    "patientNumber": "string",
    "seriesCount": 1,
    "studyAt": "2026-06-27T12:00:00.000Z"
  },
  "dicomReferences": [
    {
      "id": "uuid",
      "instanceNumber": 1,
      "signedUrl": "https://...",
      "sizeBytes": 123456,
      "sopInstanceUid": "1.2.3"
    }
  ],
  "expectedJson": {
    "findings": "string",
    "impression": "string",
    "recommendations": "string",
    "confidenceScore": "number 0..1",
    "criticality": "none | low | medium | high"
  }
}
```

Endpoint yaniti su alanlari dondurmelidir:

```json
{
  "findings": "Bulgular...",
  "impression": "Izlenim...",
  "recommendations": "Oneriler...",
  "confidenceScore": 0.55,
  "criticality": "none",
  "usage": {
    "inputTokens": 1200,
    "outputTokens": 300
  }
}
```

## OpenAI-compatible mod

vLLM, SGLang veya benzeri OpenAI uyumlu MedGemma endpoint'i kullaniliyorsa:

- `RAI_MEDGEMMA_ENDPOINT_MODE=openai-compatible`
- `RAI_MEDGEMMA_ENDPOINT=https://.../v1/chat/completions`

Bu modda RAI ayni tetkik baglamini chat completion mesajina JSON olarak koyar.

## Operasyon notu

MedGemma provider'i endpoint tanimlanana kadar pasif kalmalidir. Endpoint ve
gerekirse API key Vercel uzerinde tanimlandiktan sonra Admin > AI Servisleri
ekranindan MedGemma aktif edilebilir.
