"use client"

import { useMemo, useState } from "react"

type SearchItem = {
  category: string
  href: string
  text: string
  title: string
}

type DevDocsSearchProps = {
  items: SearchItem[]
}

export function DevDocsSearch({ items }: DevDocsSearchProps) {
  const [query, setQuery] = useState("")
  const normalizedQuery = query.trim().toLocaleLowerCase("tr-TR")

  const results = useMemo(() => {
    if (!normalizedQuery) return items.slice(0, 3)

    return items
      .filter((item) =>
        `${item.category} ${item.title} ${item.text}`
          .toLocaleLowerCase("tr-TR")
          .includes(normalizedQuery),
      )
      .slice(0, 6)
  }, [items, normalizedQuery])

  return (
    <div className="dev-docs-search-wrap">
      <div className="dev-docs-search" role="search">
        <span>Arama</span>
        <input
          aria-label="Dokumantasyon arama"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="DICOM, OHIF, AI, HIS, Storage, branch..."
          type="search"
          value={query}
        />
      </div>
      {query ? (
        <div className="dev-docs-search-results">
          {results.length ? (
            results.map((item) => (
              <a href={item.href} key={`${item.category}-${item.href}`}>
                <span>{item.category}</span>
                <strong>{item.title}</strong>
                <small>{item.text}</small>
              </a>
            ))
          ) : (
            <p>Bu arama icin dokuman basligi bulunamadi.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
