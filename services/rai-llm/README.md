# RAI LLM service

RAI LLM, RAI PACS icin self-hosted medikal goruntu on rapor model hattidir.
Ilk surum Apache-2.0 lisansli `Qwen/Qwen2.5-VL-7B-Instruct` tabanindan baslar
ve RAI tarafinda kure edilecek radyoloji verileriyle fine-tune edilebilir.

Bu servis OpenAI-compatible `POST /v1/chat/completions` endpoint'i sunar.
RAI PACS tarafinda `RAI_LLM_ENDPOINT` bu endpoint'e isaret eder.

## Neden Qwen2.5-VL?

- Acik agirlikli ve Hugging Face uzerinden indirilebilir.
- Apache-2.0 lisansi RAI'ye ticari ve fine-tune edilebilir bir baslangic alani verir.
- DICOM'dan uretilen PNG preview goruntulerini ve tetkik metadata bilgisini ayni
  prompt icinde kullanabilir.
- MedGemma gibi medikal modellerle karsilastirma yapilabilir; RAI LLM kendi
  kurumsal model hattimiz olarak ilerler.

## Ortam degiskenleri

- `RAI_LLM_MODEL_ID`: Varsayilan `Qwen/Qwen2.5-VL-7B-Instruct`.
- `RAI_LLM_API_KEY`: Opsiyonel bearer token.
- `RAI_LLM_MAX_NEW_TOKENS`: Varsayilan `1400`.

RAI PACS / Vercel tarafinda:

- `RAI_LLM_ENDPOINT=https://<gpu-endpoint>/v1/chat/completions`
- `RAI_LLM_API_KEY=<bearer-token>`
- `RAI_LLM_ENDPOINT_MODE=openai-compatible`

## Lokal GPU test

```bash
cd services/rai-llm
docker build -t rai-llm:local .
docker run --gpus all -p 8000:8000 \
  -e RAI_LLM_API_KEY=local-test-token \
  rai-llm:local
```

Health check:

```bash
curl http://localhost:8000/health
```

## Klinik not

RAI LLM ciktilari tanisal karar degildir. Hekim tarafindan duzenlenip
onaylanmadan nihai rapor olarak kullanilamaz.
