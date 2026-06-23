"use client"

import { useActionState, useEffect, useRef, useState } from "react"

import { signIn, type LoginState } from "@/app/actions/auth"
import type { LoginCaptchaChallenge } from "@/lib/login-captcha"

const initialState: LoginState = {}

export function LoginForm({
  captcha,
  demoMode,
}: {
  captcha: LoginCaptchaChallenge
  demoMode: boolean
}) {
  const [state, action, pending] = useActionState(signIn, initialState)
  const startedAtRef = useRef<number | null>(null)
  const [browserSignal, setBrowserSignal] = useState("")
  const [elapsed, setElapsed] = useState("0")

  useEffect(() => {
    startedAtRef.current = Date.now()
    const timeout = window.setTimeout(() => {
      setBrowserSignal("ready")
      setElapsed(String(Date.now() - (startedAtRef.current ?? Date.now())))
    }, 950)

    return () => window.clearTimeout(timeout)
  }, [])

  const refreshElapsed = () => {
    setElapsed(String(Date.now() - (startedAtRef.current ?? Date.now())))
  }

  return (
    <form
      action={action}
      className="login-form"
      onSubmit={refreshElapsed}
    >
      <input name="captchaIssuedAt" type="hidden" value={captcha.issuedAt} />
      <input name="captchaNonce" type="hidden" value={captcha.nonce} />
      <input name="captchaToken" type="hidden" value={captcha.token} />
      <input name="captchaBrowserSignal" type="hidden" value={browserSignal} />
      <input name="captchaElapsed" type="hidden" value={elapsed} />
      <label className="captcha-trap" aria-hidden="true">
        Kurum web sitesi
        <input
          name="website"
          tabIndex={-1}
          autoComplete="off"
          inputMode="text"
        />
      </label>
      <label>
        E-posta
        <input
          name="email"
          type="text"
          autoComplete="email"
          inputMode="email"
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
