"use client"

import { useActionState } from "react"

import { signIn, type LoginState } from "@/app/actions/auth"

const initialState: LoginState = {}

export function LoginForm({ demoMode }: { demoMode: boolean }) {
  const [state, action, pending] = useActionState(signIn, initialState)

  return (
    <form action={action} className="login-form">
      <label>
        E-posta
        <input
          name="email"
          type="text"
          autoComplete="email"
          defaultValue={demoMode ? "admin@raipacs.com" : ""}
          inputMode="email"
          placeholder="doctor veya doctor@raipacs.com"
          required
        />
      </label>
      <label>
        Parola
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          defaultValue={demoMode ? "demo-password" : ""}
          minLength={8}
          required
        />
      </label>
      {state.error ? <p className="form-error">{state.error}</p> : null}
      <button type="submit" className="button primary" disabled={pending}>
        {pending ? "Giriş yapılıyor..." : demoMode ? "Demo panele gir" : "Giriş yap"}
      </button>
    </form>
  )
}
