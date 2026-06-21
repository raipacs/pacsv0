"use server"

import { headers } from "next/headers"

import { requireUser } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/config"
import { createOhifLaunchToken, hasOhifLaunchSecret } from "@/lib/ohif-launch"
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

export async function createOhifViewerLaunchUrl(studyId: string) {
  const user = await requireUser()

  if (!isSupabaseConfigured) {
    return {
      ok: false as const,
      error: "Demo modda OHIF viewer açılamaz.",
    }
  }

  if (!hasOhifLaunchSecret()) {
    return {
      ok: false as const,
      error: "OHIF launch secret tanımlı değil.",
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
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https"
  const origin = host ? `${protocol}://${host}` : "https://app.raipacs.com"
  const token = createOhifLaunchToken({
    organizationId: user.organizationId,
    studyId,
    userId: user.id,
  })
  const dicomJsonUrl = `${origin}/api/ohif/studies/${studyId}?token=${encodeURIComponent(
    token
  )}`
  const url = `https://viewer.ohif.org/viewer/dicomjson?url=${encodeURIComponent(
    dicomJsonUrl
  )}`

  return { ok: true as const, url }
}
