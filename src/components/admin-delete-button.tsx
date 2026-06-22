"use client"

import { useFormStatus } from "react-dom"

import { deletePatient, deleteStudy } from "@/app/actions/admin"

type DeleteStudyButtonProps = {
  studyId: string
  returnTo: string
}

type DeletePatientButtonProps = {
  patientId: string
}

export function DeleteStudyButton({ studyId, returnTo }: DeleteStudyButtonProps) {
  return (
    <form
      action={deleteStudy}
      className="inline-action-form"
      onSubmit={(event) => {
        if (!window.confirm("Bu tetkik ve Storage'daki DICOM dosyaları silinsin mi?")) {
          event.preventDefault()
        }
      }}
    >
      <input name="studyId" type="hidden" value={studyId} />
      <input name="returnTo" type="hidden" value={returnTo} />
      <DeleteSubmitButton label="Tetkik sil" pendingLabel="Siliniyor..." />
    </form>
  )
}

export function DeletePatientButton({ patientId }: DeletePatientButtonProps) {
  return (
    <form
      action={deletePatient}
      className="inline-action-form"
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Bu hasta, tüm tetkikleri ve Storage'daki DICOM dosyaları silinsin mi?"
          )
        ) {
          event.preventDefault()
        }
      }}
    >
      <input name="patientId" type="hidden" value={patientId} />
      <DeleteSubmitButton label="Hasta sil" pendingLabel="Siliniyor..." />
    </form>
  )
}

function DeleteSubmitButton({
  label,
  pendingLabel,
}: {
  label: string
  pendingLabel: string
}) {
  const { pending } = useFormStatus()

  return (
    <button className="button danger small" disabled={pending} type="submit">
      {pending ? pendingLabel : label}
    </button>
  )
}
