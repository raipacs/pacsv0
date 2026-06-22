"use server"

import { redirect } from "next/navigation"
import { z } from "zod"

import { isSupabaseConfigured } from "@/lib/config"
import { createClient } from "@/lib/supabase/server"

export type LoginState = {
  error?: string
}

const loginSchema = z.object({
  email: z.preprocess((value) => normalizeLoginEmail(value), z.email()),
  password: z.string().min(8),
})

export async function signIn(
  _state: LoginState,
  formData: FormData
): Promise<LoginState> {
  if (!isSupabaseConfigured) redirect("/worklist")

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })

  if (!parsed.success) {
    return { error: "Gecerli e-posta ve en az 8 karakterli parola girin." }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) return { error: "E-posta veya parola hatali." }
  redirect("/worklist")
}

export async function signOut() {
  if (isSupabaseConfigured) {
    const supabase = await createClient()
    await supabase.auth.signOut()
  }
  redirect("/login")
}

function normalizeLoginEmail(value: unknown) {
  const email = String(value ?? "").trim().toLocaleLowerCase("tr-TR")
  if (!email || email.includes("@")) return email
  return `${email}@raipacs.com`
}
