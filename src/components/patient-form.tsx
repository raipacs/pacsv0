"use client"

import { useActionState } from "react"

import { createPatient, type PatientFormState } from "@/app/actions/patients"

const initialState: PatientFormState = {}

export function PatientForm() {
  const [state, action, pending] = useActionState(createPatient, initialState)

  return (
    <form action={action} className="upload-form">
      <fieldset disabled={pending}>
        <div className="form-grid">
          <label>
            Hasta no
            <input name="patientNumber" placeholder="Boşsa otomatik üretilir" />
          </label>
          <label>
            Cinsiyet
            <select name="sex" defaultValue="U">
              <option value="U">Belirtilmedi</option>
              <option value="F">Kadın</option>
              <option value="M">Erkek</option>
              <option value="O">Diğer</option>
            </select>
          </label>
          <label>
            Ad
            <input name="firstName" autoComplete="given-name" required />
          </label>
          <label>
            Soyad
            <input name="lastName" autoComplete="family-name" required />
          </label>
          <label>
            Doğum tarihi
            <input name="birthDate" type="date" />
          </label>
          <label>
            Telefon
            <input name="phone" autoComplete="tel" placeholder="+90 ..." />
          </label>
          <label className="wide">
            E-posta
            <input name="email" type="email" autoComplete="email" />
          </label>
          <label>
            TC kimlik no
            <input name="nationalId" inputMode="numeric" maxLength={20} />
          </label>
          <label>
            Pasaport no
            <input name="passportNumber" maxLength={40} />
          </label>
          <label>
            Anne adı
            <input name="motherName" autoComplete="off" />
          </label>
          <label>
            Baba adı
            <input name="fatherName" autoComplete="off" />
          </label>
          <label>
            Doğum yeri
            <input name="birthPlace" autoComplete="address-level2" />
          </label>
          <label>
            Mobil E.164
            <input name="mobilePhoneE164" inputMode="tel" />
          </label>
          <label>
            Kaynak sistem
            <input name="sourceSystem" placeholder="HIS, DICOM, manuel" />
          </label>
          <label>
            Kaynak hasta ID
            <input name="externalPatientId" />
          </label>
        </div>
      </fieldset>
      {state.error ? <p className="form-status error">{state.error}</p> : null}
      <button className="button primary" type="submit" disabled={pending}>
        {pending ? "Kaydediliyor..." : "Hastayı kaydet"}
      </button>
    </form>
  )
}
