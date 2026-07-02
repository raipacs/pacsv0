import { headers } from "next/headers"
import Link from "next/link"

import { getOhifLaunchStudyIds, verifyOhifLaunchToken } from "@/lib/ohif-launch"
import { createOhifDicomJsonFallbackUrl } from "@/lib/ohif-viewer"
import { createServiceClient, isSupabaseServiceConfigured } from "@/lib/supabase/service"

export const dynamic = "force-dynamic"
export const metadata = {
  title: "RAI OHIF Gateway",
}

type OhifGatewayPageProps = {
  searchParams: Promise<{ token?: string }>
}

type StudySummaryRow = {
  accession_number: string
  description: string | null
  id: string
  modality: string
  patients:
    | {
        first_name?: string | null
        last_name?: string | null
        patient_number?: string | null
      }
    | Array<{
        first_name?: string | null
        last_name?: string | null
        patient_number?: string | null
      }>
    | null
  study_at: string | null
  study_instance_uid: string
}

export default async function OhifGatewayPage({ searchParams }: OhifGatewayPageProps) {
  const [{ token }, requestHeaders] = await Promise.all([searchParams, headers()])
  const origin = getRequestOrigin(requestHeaders)
  const launch = token ? verifyOhifLaunchToken(token) : null

  if (!token || !launch) {
    return (
      <main className="rai-ohif-page">
        <section className="rai-ohif-empty">
          <p className="eyebrow">RAI OHIF Gateway</p>
          <h1>OHIF oturumu acilamadi</h1>
          <p>Launch token gecersiz, eksik veya suresi dolmus.</p>
          <Link className="button subtle" href="/worklist">
            Worklist
          </Link>
        </section>
      </main>
    )
  }

  const studyIds = getOhifLaunchStudyIds(launch)
  if (!studyIds.length) {
    return (
      <main className="rai-ohif-page">
        <section className="rai-ohif-empty">
          <p className="eyebrow">RAI OHIF Gateway</p>
          <h1>Tetkik bulunamadi</h1>
          <p>Bu OHIF oturumu icin yetkili tetkik listesi bos.</p>
        </section>
      </main>
    )
  }

  const studies = await loadStudySummaries(launch.organizationId, studyIds)
  const dicomwebRoot = new URL("/dicomweb", origin).toString()
  const configUrl = new URL("/ohif/config", origin)
  configUrl.searchParams.set("token", token)
  const hostedOhifUrl = createOhifDicomJsonFallbackUrl({ origin, studyIds, token })

  return (
    <main className="rai-ohif-page">
      <header className="rai-ohif-toolbar">
        <div>
          <p className="eyebrow">RAI OHIF Gateway</p>
          <h1>OHIF oturumu</h1>
          <p>
            {studies.length || studyIds.length} tetkik · DICOMweb hazir · Signed launch token
          </p>
        </div>
        <nav aria-label="OHIF navigasyonu">
          <Link className="button subtle" href={`/viewer/${studyIds[0]}`}>
            RAI Viewer
          </Link>
          <a className="button primary" href={hostedOhifUrl}>
            RAI OHIF ac
          </a>
          <a className="button subtle" href={hostedOhifUrl} rel="noreferrer" target="_blank">
            Yeni sekmede ac
          </a>
        </nav>
      </header>

      <section className="rai-ohif-layout">
        <aside className="rai-ohif-panel" aria-label="OHIF oturum bilgisi">
          <div>
            <h2>Datasource</h2>
            <dl>
              <div>
                <dt>QIDO/WADO</dt>
                <dd>{dicomwebRoot}</dd>
              </div>
              <div>
                <dt>Config</dt>
                <dd>{configUrl.toString()}</dd>
              </div>
              <div>
                <dt>Kapsam</dt>
                <dd>{launch.scope ?? "study"}</dd>
              </div>
            </dl>
          </div>
          <div>
            <h2>Tetkikler</h2>
            <ul>
              {(studies.length ? studies : studyIds.map(createMissingStudySummary)).map(
                (study) => {
                  const patient = firstRelation(study.patients)
                  return (
                    <li key={study.id}>
                      <strong>{study.description || "DICOM tetkiki"}</strong>
                      <span>
                        {patient
                          ? `${patient.first_name ?? ""} ${patient.last_name ?? ""}`.trim()
                          : "Hasta bilgisi yok"}{" "}
                        · {study.modality} · {formatDateTime(study.study_at)}
                      </span>
                      <small>{study.study_instance_uid}</small>
                    </li>
                  )
                }
              )}
            </ul>
          </div>
        </aside>

        <section className="rai-ohif-launch-panel" aria-label="OHIF launch">
          <div className="rai-ohif-launch-card">
            <div>
              <p className="eyebrow">OHIF Launch</p>
              <h2>RAI self-host OHIF hazir</h2>
              <p>
                Bu gateway signed token ile yetkili tetkikleri RAI domaini altinda
                calisan OHIF Viewer&apos;a aktarir. DICOM nesneleri private storage&apos;da
                kalir; OHIF yalnizca RAI DICOMweb ve viewer-data endpointlerini kullanir.
              </p>
            </div>
            <div className="rai-ohif-launch-actions">
              <a className="button primary" href={hostedOhifUrl}>
                RAI OHIF ac
              </a>
              <a className="button subtle" href={hostedOhifUrl} rel="noreferrer" target="_blank">
                Yeni sekmede ac
              </a>
            </div>
            <dl>
              <div>
                <dt>Tetkik</dt>
                <dd>{studies.length || studyIds.length}</dd>
              </div>
              <div>
                <dt>Gateway</dt>
                <dd>{origin}</dd>
              </div>
              <div>
                <dt>DICOMweb</dt>
                <dd>{dicomwebRoot}</dd>
              </div>
              <div>
                <dt>Viewer</dt>
                <dd>{new URL("/ohif-viewer", origin).toString()}</dd>
              </div>
            </dl>
          </div>
        </section>
      </section>
    </main>
  )
}

async function loadStudySummaries(organizationId: string, studyIds: string[]) {
  if (!isSupabaseServiceConfigured()) return []

  const { data, error } = await createServiceClient()
    .from("studies")
    .select(
      "id, study_instance_uid, accession_number, modality, description, study_at, patients(patient_number, first_name, last_name)"
    )
    .eq("organization_id", organizationId)
    .in("id", studyIds)
    .order("study_at", { ascending: false })

  if (error) throw new Error(`OHIF tetkik listesi alinamadi: ${error.message}`)
  return (data ?? []) as StudySummaryRow[]
}

function createMissingStudySummary(id: string): StudySummaryRow {
  return {
    accession_number: "-",
    description: "Yetkili tetkik",
    id,
    modality: "-",
    patients: null,
    study_at: null,
    study_instance_uid: id,
  }
}

function getRequestOrigin(requestHeaders: Headers) {
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https"
  return host ? `${protocol}://${host}` : "https://app.raipacs.com"
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function formatDateTime(value: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(date)
}
