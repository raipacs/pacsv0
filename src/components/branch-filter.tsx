import Link from "next/link"

import type { BranchOption } from "@/lib/branches"

type BranchFilterProps = {
  basePath: string
  branches: BranchOption[]
  selectedBranch: BranchOption | null
}

export function BranchFilter({
  basePath,
  branches,
  selectedBranch,
}: BranchFilterProps) {
  if (!branches.length) return null

  return (
    <section className="branch-filter" aria-label="Şube filtresi">
      <div>
        <span>Şube</span>
        <strong>{selectedBranch?.name ?? "Merkez"}</strong>
      </div>
      <nav>
        {branches.map((branch) => (
          <Link
            className={branch.id === selectedBranch?.id ? "active" : ""}
            href={`${basePath}?branch=${encodeURIComponent(branch.slug)}`}
            key={branch.id}
          >
            {branch.name}
          </Link>
        ))}
      </nav>
    </section>
  )
}
