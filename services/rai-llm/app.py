import base64
import io
import json
import os
import time
import uuid
from typing import Any

import torch
from fastapi import FastAPI, Header, HTTPException
from PIL import Image
from pydantic import BaseModel, Field
from qwen_vl_utils import process_vision_info
from transformers import AutoProcessor, Qwen2_5_VLForConditionalGeneration


MODEL_ID = os.getenv("RAI_LLM_MODEL_ID", "Qwen/Qwen2.5-VL-7B-Instruct")
API_KEY = os.getenv("RAI_LLM_API_KEY", "")
MAX_NEW_TOKENS = int(os.getenv("RAI_LLM_MAX_NEW_TOKENS", "1400"))

app = FastAPI(title="RAI LLM", version="0.1.0")
model = None
processor = None


class ChatMessage(BaseModel):
  role: str
  content: str | list[dict[str, Any]]


class ChatCompletionRequest(BaseModel):
  messages: list[ChatMessage]
  model: str | None = None
  temperature: float = 0.2
  max_tokens: int | None = Field(default=None, alias="max_tokens")


def require_api_key(authorization: str | None) -> None:
  if not API_KEY:
    return
  if authorization != f"Bearer {API_KEY}":
    raise HTTPException(status_code=401, detail="Invalid RAI LLM API key")


def load_model() -> None:
  global model, processor
  if model is not None and processor is not None:
    return

  processor = AutoProcessor.from_pretrained(MODEL_ID)
  model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
    MODEL_ID,
    device_map="auto",
    torch_dtype="auto",
  )
  model.eval()


def decode_data_url(value: str) -> Image.Image:
  if "," not in value:
    raise ValueError("image_url must be a data URL")
  _, encoded = value.split(",", 1)
  data = base64.b64decode(encoded)
  return Image.open(io.BytesIO(data)).convert("RGB")


def normalize_content(content: str | list[dict[str, Any]]) -> str | list[dict[str, Any]]:
  if isinstance(content, str):
    return content

  normalized: list[dict[str, Any]] = []
  for item in content:
    item_type = item.get("type")
    if item_type == "text":
      normalized.append({"type": "text", "text": str(item.get("text", ""))})
      continue

    if item_type == "image_url":
      image_url = item.get("image_url")
      url = image_url.get("url") if isinstance(image_url, dict) else image_url
      if not isinstance(url, str):
        continue
      normalized.append({"type": "image", "image": decode_data_url(url)})

  return normalized


def normalize_messages(messages: list[ChatMessage]) -> list[dict[str, Any]]:
  normalized_messages: list[dict[str, Any]] = []
  for message in messages:
    role = "assistant" if message.role == "assistant" else message.role
    if role not in {"system", "user", "assistant"}:
      role = "user"
    normalized_messages.append(
      {
        "role": role,
        "content": normalize_content(message.content),
      }
    )
  return normalized_messages


def extract_json_object(text: str) -> str:
  stripped = text.strip()
  if stripped.startswith("{") and stripped.endswith("}"):
    return stripped

  start = stripped.find("{")
  end = stripped.rfind("}")
  if start >= 0 and end > start:
    candidate = stripped[start : end + 1]
    try:
      json.loads(candidate)
      return candidate
    except json.JSONDecodeError:
      return stripped

  return stripped


@app.get("/health")
def health() -> dict[str, Any]:
  return {
    "model": MODEL_ID,
    "ready": model is not None,
    "service": "rai-llm",
  }


@app.post("/v1/chat/completions")
def chat_completions(
  request: ChatCompletionRequest,
  authorization: str | None = Header(default=None),
) -> dict[str, Any]:
  require_api_key(authorization)
  load_model()

  assert model is not None
  assert processor is not None

  messages = normalize_messages(request.messages)
  prompt = processor.apply_chat_template(
    messages,
    add_generation_prompt=True,
    tokenize=False,
  )
  image_inputs, video_inputs = process_vision_info(messages)
  inputs = processor(
    text=[prompt],
    images=image_inputs,
    videos=video_inputs,
    padding=True,
    return_tensors="pt",
  ).to(model.device)

  with torch.inference_mode():
    generated_ids = model.generate(
      **inputs,
      do_sample=request.temperature > 0,
      max_new_tokens=request.max_tokens or MAX_NEW_TOKENS,
      temperature=request.temperature,
    )

  generated_ids = [
    output_ids[len(input_ids) :]
    for input_ids, output_ids in zip(inputs.input_ids, generated_ids, strict=True)
  ]
  output_text = processor.batch_decode(
    generated_ids,
    clean_up_tokenization_spaces=False,
    skip_special_tokens=True,
  )[0]
  content = extract_json_object(output_text)
  prompt_tokens = int(inputs.input_ids.shape[-1])
  completion_tokens = max(1, len(content) // 4)

  return {
    "id": f"chatcmpl-{uuid.uuid4().hex}",
    "model": request.model or MODEL_ID,
    "object": "chat.completion",
    "created": int(time.time()),
    "choices": [
      {
        "index": 0,
        "finish_reason": "stop",
        "message": {
          "role": "assistant",
          "content": content,
        },
      }
    ],
    "usage": {
      "prompt_tokens": prompt_tokens,
      "completion_tokens": completion_tokens,
      "total_tokens": prompt_tokens + completion_tokens,
    },
  }
