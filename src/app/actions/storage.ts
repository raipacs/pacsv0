"use server"

import { headers } from "next/headers"

import { requireUser } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/config"
import { createClient } from "@/lib/supabase/server"

export async function createDicomSignedUrl(instanceId: string) {
  const user = await requireUser()

  if (!isSupabaseConfigured) {
    return {
      ok: false as const,
      error: "Demo modda signed URL üretilemez.",
    }
  }

  const supabase = await createClient()
  const { data: instance, error } = await supabase
    .from("instances")
    .select("storage_bucket, storage_key")
    .eq("id", instanceId)
    .eq("organization_id", user.organizationId)
    .maybeSingle()

  if (error) return { ok: false as const, error: error.message }
  if (!instance) {
    return { ok: false as const, error: "DICOM instance bulunamadı." }
  }

  const { data, error: signedUrlError } = await supabase.storage
    .from(instance.storage_bucket)
    .createSignedUrl(instance.storage_key, 300, { download: true })

  if (signedUrlError) {
    return { ok: false as const, error: signedUrlError.message }
  }

  return { ok: true as const, url: data.signedUrl }
}

export async function createDicomSignedUrls(instanceIds: string[]) {
  const user = await requireUser()
  const uniqueIds = Array.from(new Set(instanceIds)).filter(Boolean).slice(0, 16)

  if (!isSupabaseConfigured) {
    return {
      ok: false as const,
      error: "Demo modda signed URL üretilemez.",
    }
  }

  if (!uniqueIds.length) {
    return { ok: true as const, urls: {} as Record<string, string> }
  }

  const supabase = await createClient()
  const { data: instances, error } = await supabase
    .from("instances")
    .select("id, storage_bucket, storage_key")
    .in("id", uniqueIds)
    .eq("organization_id", user.organizationId)

  if (error) return { ok: false as const, error: error.message }
  if (!instances?.length) {
    return { ok: false as const, error: "DICOM instance bulunamadı." }
  }

  const byBucket = new Map<string, { id: string; path: string }[]>()
  for (const instance of instances) {
    const items = byBucket.get(instance.storage_bucket) ?? []
    items.push({ id: instance.id, path: instance.storage_key })
    byBucket.set(instance.storage_bucket, items)
  }

  const urls: Record<string, string> = {}
  for (const [bucket, items] of byBucket) {
    const { data, error: signedUrlError } = await supabase.storage
      .from(bucket)
      .createSignedUrls(
        items.map((item) => item.path),
        300,
        { download: true }
      )

    if (signedUrlError) {
      return { ok: false as const, error: signedUrlError.message }
    }

    data.forEach((signedUrl, index) => {
      const item = items[index]
      if (item && signedUrl.signedUrl) urls[item.id] = signedUrl.signedUrl
    })
  }

  return { ok: true as const, urls }
}

export async function createOhifViewerLaunchUrl(studyId: string) {
  const user = await requireUser()

  if (!isSupabaseConfigured) {
    return {
      ok: false as const,
      error: "Demo modda OHIF viewer açılamaz.",
    }
  }

  const supabase = await createClient()
  const { data: study, error } = await supabase
    .from("studies")
    .select("id")
    .eq("id", studyId)
    .eq("organization_id", user.organizationId)
    .maybeSingle()

  if (error) return { ok: false as const, error: error.message }
  if (!study) {
    return { ok: false as const, error: "Tetkik bulunamadı." }
  }

  const requestHeaders = await headers()
  const referer = requestHeaders.get("referer")
  const fromPatient = referer?.match(/\/patients\/([^/?#]+)/)?.[1]
  const url = fromPatient
    ? `/viewer/${studyId}?patientId=${encodeURIComponent(fromPatient)}`
    : `/viewer/${studyId}`

  return { ok: true as const, url }
}
