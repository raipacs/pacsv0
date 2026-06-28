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

OpenAI-compatible smoke test:

```bash
RAI_LLM_ENDPOINT=http://localhost:8000/v1/chat/completions \
RAI_LLM_API_KEY=local-test-token \
npm run test:rai-llm
```

## GPU endpoint kurulumu

Ilk canli kurulum icin pratik yol, NVIDIA L4 GPU'lu bir VM veya managed GPU
endpoint uzerinde bu Docker imajini calistirmaktir.

Onerilen minimum:

- GPU: NVIDIA L4 24 GB VRAM
- Disk: 120 GB veya uzeri
- RAM: 32 GB veya uzeri
- Port: 8000 yalnizca HTTPS reverse proxy veya internal load balancer arkasindan
  acilmali

Canli RAI PACS tarafinda Vercel env:

```bash
RAI_LLM_ENDPOINT=https://<rai-llm-host>/v1/chat/completions
RAI_LLM_API_KEY=<strong-random-token>
RAI_LLM_ENDPOINT_MODE=openai-compatible
```

Endpoint acildiktan sonra:

```bash
RAI_LLM_ENDPOINT=https://<rai-llm-host>/v1/chat/completions \
RAI_LLM_API_KEY=<strong-random-token> \
npm run test:rai-llm
```

## Klinik not

RAI LLM ciktilari tanisal karar degildir. Hekim tarafindan duzenlenip
onaylanmadan nihai rapor olarak kullanilamaz.
