import { createClient as createSupabaseClient } from "@supabase/supabase-js"

export function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = getSupabaseServiceKey()

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase service istemcisi için ortam değişkenleri eksik.")
  }

  return createSupabaseClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "rai-pacs-ohif-bridge" } },
  })
}

export function isSupabaseServiceConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && getSupabaseServiceKey())
}

function getSupabaseServiceKey() {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
}
