"use client"

import { useMemo, useState } from "react"

import type { WorklistStudy } from "@/lib/types"

export function WorklistTable({ studies }: { studies: WorklistStudy[] }) {
  const [query, setQuery] = useState("")
  const [modality, setModality] = useState("Tumu")

  const modalities = ["Tumu", ...new Set(studies.map((study) => study.modality))]
  const visible = useMemo(() => {
    const normalized = query.toLocaleLowerCase("tr-TR")
    return studies.filter((study) => {
      const matchesModality = modality === "Tumu" || study.modality === modality
      const searchable = [
        study.patientName,
        study.patientNumber,
        study.accessionNumber,
        study.description,
      ]
        .join(" ")
        .toLocaleLowerCase("tr-TR")
      return matchesModality && searchable.includes(normalized)
    })
  }, [modality, query, studies])

  return (
    <section className="data-panel">
      <div className="table-tools">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Hasta, protokol veya accession ara"
        />
        <div className="segmented">
          {modalities.map((item) => (
            <button
              key={item}
              type="button"
              className={item === modality ? "active" : ""}
              onClick={() => setModality(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="responsive-table">
        <table>
          <thead>
            <tr>
              <th>Hasta</th>
              <th>Tetkik</th>
              <th>Modalite</th>
              <th>Tarih</th>
              <th>Oncelik</th>
              <th>Durum</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((study) => (
              <tr key={study.id}>
                <td>
                  <strong>{study.patientName}</strong>
                  <span>{study.patientNumber}</span>
                </td>
                <td>
                  <strong>{study.description}</strong>
                  <span>{study.accessionNumber}</span>
                </td>
                <td>
                  <span className="modality">{study.modality}</span>
                </td>
                <td>{study.date}</td>
                <td>
                  <span className={`status ${study.priority.toLowerCase()}`}>
                    {study.priority}
                  </span>
                </td>
                <td>{study.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
