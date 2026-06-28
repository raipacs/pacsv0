# RAI LLM entegrasyonu

RAI LLM, RAI PACS icin bize ait self-hosted medikal goruntu modeli hattidir.
Baslangic modeli `Qwen/Qwen2.5-VL-7B-Instruct` olarak secildi. Bunun nedeni
modelin acik agirlikli, Hugging Face uzerinden indirilebilir ve Apache-2.0
lisansli olmasidir. Bu, RAI'nin ileride kendi kure edilmis radyoloji verileriyle
fine-tune edilebilir bir model hatti kurmasini kolaylastirir.

## Karsilastirilan acik modeller

| Model | Guc | Kisiti |
| --- | --- | --- |
| `google/medgemma-4b-it` | Medikal/radyoloji odakli image-text model | Health AI Developer Foundations sartlari, gated erisim |
| `Qwen/Qwen2.5-VL-7B-Instruct` | Apache-2.0, guclu acik VLM, fine-tune icin uygun | Genel VLM; medikal domain icin RAI fine-tune gerekir |
| `microsoft/maira-2` | Radyoloji raporlamaya ozel, chest X-ray odakli | Microsoft research license, gated erisim |
| `StanfordAIMI/CheXagent-8b` | Chest X-ray odakli acik model | Daha dar modalite kapsami ve custom code |

## RAI PACS provider

Supabase seed:

- `name`: RAI LLM
- `slug`: `rai-llm`
- `provider_type`: `custom`
- `default_model`: `Qwen/Qwen2.5-VL-7B-Instruct`
- `credential_reference`: `RAI_LLM_ENDPOINT`

Admin AI Servisleri sayfasi acildiginda `rai-llm` provider kaydi yoksa
otomatik olarak olusturulur. Bu davranis migration uygulanmamis ortamlarda
canli UI'in eksik provider ile kalmasini engeller; mevcut provider ayarlari
varsa aktiflik, varsayilan ve credential alanlari ezilmez.

Gerekli secret'lar:

- `RAI_LLM_ENDPOINT`: OpenAI-compatible endpoint URL'i.
- `RAI_LLM_API_KEY`: Endpoint bearer token istiyorsa kullanilir.
- `RAI_LLM_ENDPOINT_MODE`: Varsayilan `openai-compatible`.

Admin > AI Servisleri ekraninda RAI LLM operasyon durumu ayrica gosterilir.
Bu panel provider aktif mi, endpoint env tanimli mi, API token var mi ve hangi
test komutunun calistirilacagini gosterir. Secret degerleri UI'da acik olarak
gosterilmez.

## Servis

Servis kodu `services/rai-llm` altindadir. `POST /v1/chat/completions`
endpoint'i OpenAI-compatible yanit verir. RAI PACS, DICOM'dan uretilmis PNG
preview'leri ve tetkik metadata bilgisini bu endpoint'e gonderir.

Endpoint ayakta oldugunda smoke test:

```bash
RAI_LLM_ENDPOINT=https://<rai-llm-host>/v1/chat/completions \
RAI_LLM_API_KEY=<strong-random-token> \
npm run test:rai-llm
```

Kurulum icin GPU onerisi:

- MVP test: NVIDIA L4 / 24 GB VRAM.
- Daha rahat calisma ve fine-tune hazirligi: NVIDIA A100 / 40 GB veya ustu.

## Gelisim yolu

1. RAI LLM v0: Qwen2.5-VL tabanli self-hosted inference.
2. RAI LLM v0.1: RAI rapor sablonlari ve modalite bazli prompt paketi.
3. RAI LLM v1: Anonimlestirilmis, hekim onayli raporlar ve goruntu preview setiyle LoRA fine-tune.
4. RAI LLM v1.1: Modalite bazli modeller veya router: DX/US/MR/CT.

## Klinik not

RAI LLM on rapor uretir; tanisal karar sistemi degildir. Nihai rapor, yetkili
hekim tarafindan duzenlenip onaylandiktan sonra olusur.
