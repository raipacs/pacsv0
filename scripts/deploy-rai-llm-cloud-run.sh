#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-rai-pacs}"
REGION="${REGION:-europe-west4}"
SERVICE_NAME="${SERVICE_NAME:-rai-llm}"
REPOSITORY="${REPOSITORY:-rai-pacs}"
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d%H%M%S)}"
MODEL_ID="${RAI_LLM_MODEL_ID:-Qwen/Qwen2.5-VL-7B-Instruct}"
MAX_NEW_TOKENS="${RAI_LLM_MAX_NEW_TOKENS:-1400}"
API_KEY="${RAI_LLM_API_KEY:-}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud bulunamadı. Bu script'i Google Cloud Shell'de veya gcloud kurulu bir ortamda çalıştırın." >&2
  exit 1
fi

if [[ -z "${API_KEY}" ]]; then
  echo "RAI_LLM_API_KEY tanımlı değil. Önce güçlü bir token üretip env olarak verin:" >&2
  echo "export RAI_LLM_API_KEY=\"\$(openssl rand -base64 36 | tr -d '\\n')\"" >&2
  exit 1
fi

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE_NAME}:${IMAGE_TAG}"

echo "Project: ${PROJECT_ID}"
echo "Region: ${REGION}"
echo "Service: ${SERVICE_NAME}"
echo "Image: ${IMAGE_URI}"

gcloud config set project "${PROJECT_ID}" >/dev/null

gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  --project "${PROJECT_ID}"

if ! gcloud artifacts repositories describe "${REPOSITORY}" \
  --location "${REGION}" \
  --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${REPOSITORY}" \
    --repository-format docker \
    --location "${REGION}" \
    --description "RAI PACS container images" \
    --project "${PROJECT_ID}"
fi

gcloud builds submit services/rai-llm \
  --tag "${IMAGE_URI}" \
  --project "${PROJECT_ID}"

gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE_URI}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --platform managed \
  --execution-environment gen2 \
  --gpu 1 \
  --gpu-type nvidia-l4 \
  --cpu 8 \
  --memory 32Gi \
  --concurrency 1 \
  --min-instances 0 \
  --max-instances 1 \
  --no-cpu-throttling \
  --timeout 3600 \
  --port 8000 \
  --allow-unauthenticated \
  --set-env-vars "RAI_LLM_MODEL_ID=${MODEL_ID},RAI_LLM_MAX_NEW_TOKENS=${MAX_NEW_TOKENS},RAI_LLM_API_KEY=${API_KEY}"

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --format 'value(status.url)')"

cat <<EOF

RAI LLM Cloud Run deployment hazır.

Endpoint:
${SERVICE_URL}/v1/chat/completions

Lokal smoke test:
RAI_LLM_ENDPOINT="${SERVICE_URL}/v1/chat/completions" \\
RAI_LLM_API_KEY="<token>" \\
npm run test:rai-llm

Vercel production env:
RAI_LLM_ENDPOINT=${SERVICE_URL}/v1/chat/completions
RAI_LLM_API_KEY=<token>
RAI_LLM_ENDPOINT_MODE=openai-compatible

Not: API token güvenlik nedeniyle burada maskelenmiştir. Script içinde RAI_LLM_API_KEY
env ile verdiğiniz token kullanılır. Aynı token Vercel production env tarafına
RAI_LLM_API_KEY olarak eklenmelidir.
EOF
