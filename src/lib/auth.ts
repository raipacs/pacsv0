import { redirect } from "next/navigation"

import { isSupabaseConfigured } from "@/lib/config"
import { createClient } from "@/lib/supabase/server"
import type { AppRole } from "@/lib/types"

export type CurrentUser = {
  id: string
  email: string
  fullName: string
  role: AppRole
  organizationId: string
  organizationName: string
  demo: boolean
}

const demoUser: CurrentUser = {
  id: "demo-admin",
  email: "admin@raipacs.com",
  fullName: "RAI PACS Admin",
  role: "admin",
  organizationId: "demo-organization",
  organizationName: "RAI Klinik Görüntüleme",
  demo: true,
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (!isSupabaseConfigured) return demoUser

  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const userId = data?.claims?.sub
  if (!userId) return null

  const { data: membership } = await supabase
    .from("organization_members")
    .select(
      "role, organization_id, profiles(full_name), organizations(name)"
    )
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (!membership) return null

  const profile = Array.isArray(membership.profiles)
    ? membership.profiles[0]
    : membership.profiles
  const organization = Array.isArray(membership.organizations)
    ? membership.organizations[0]
    : membership.organizations

  return {
    id: userId,
    email: String(data.claims.email ?? ""),
    fullName: profile?.full_name ?? String(data.claims.email ?? "Kullanıcı"),
    role: membership.role as AppRole,
    organizationId: membership.organization_id,
    organizationName: organization?.name ?? "RAI PACS",
    demo: false,
  }
}

export async function requireUser() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  return user
}

export async function requireAdmin() {
  const user = await requireUser()
  if (user.role !== "admin") redirect("/worklist")
  return user
}

export async function canManagePatients(
  user: CurrentUser,
  action: "insert" | "update" | "delete" = "insert"
) {
  return canManageTable(user, "patients", action)
}

export async function canManageTable(
  user: CurrentUser,
  tableName: string,
  action: "select" | "insert" | "update" | "delete" = "insert"
) {
  if (user.role === "admin") return true
  if (!isSupabaseConfigured) return false

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("has_group_table_permission", {
    requested_action: action,
    target_organization_id: user.organizationId,
    target_table_name: tableName,
  })

  if (error) return false
  return data === true
}

export async function requirePatientManager() {
  const user = await requireUser()
  const allowed = await canManagePatients(user, "insert")
  if (!allowed) redirect("/worklist")
  return user
}

export async function requireTableManager(
  tableName: string,
  action: "select" | "insert" | "update" | "delete" = "insert"
) {
  const user = await requireUser()
  const allowed = await canManageTable(user, tableName, action)
  if (!allowed) redirect("/worklist")
  return user
}
