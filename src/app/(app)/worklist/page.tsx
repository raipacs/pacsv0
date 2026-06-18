import Link from "next/link"

import { WorklistTable } from "@/components/worklist-table"
import { requireUser } from "@/lib/auth"
import { getWorklist } from "@/lib/data"

export const metadata = { title: "Worklist" }

export default async function WorklistPage() {
  const user = await requireUser()
  const studies = await getWorklist(user.organizationId)
  const urgent = studies.filter((study) => study.priority === "Acil").length
  const reporting = studies.filter(
    (study) => study.status === "Raporlanıyor"
  ).length

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Radyoloji operasyonu</p>
          <h1>Worklist</h1>
          <p>Atanmış ve bekleyen tetkikleri tek ekrandan yönetin.</p>
        </div>
        <Link className="button primary" href="/worklist/upload">
          DICOM yükle
        </Link>
      </header>
      <section className="metric-row">
        <article>
          <span>Bugün gelen</span>
          <strong>{studies.length}</strong>
        </article>
        <article>
          <span>Acil</span>
          <strong>{urgent}</strong>
        </article>
        <article>
          <span>Raporlanıyor</span>
          <strong>{reporting}</strong>
        </article>
        <article>
          <span>Ort. açılış</span>
          <strong>1.8 sn</strong>
        </article>
      </section>
      <WorklistTable studies={studies} />
    </>
  )
}
