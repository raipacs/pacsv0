import { isSupabaseConfigured } from "@/lib/config"
import { createClient } from "@/lib/supabase/server"
import type { CurrentUser } from "@/lib/auth"

export type BranchSummary = {
  id: string
  name: string
  slug: string
  code: string | null
  isMain: boolean
  isActive: boolean
  patientCount: number
  studyCount: number
  modalityCount: number
  lastStudyAt: string | null
}

export type BranchOption = {
  id: string
  name: string
  slug: string
  code: string | null
  isMain: boolean
}

type BranchRow = {
  id: string
  name: string
  slug: string
  code: string | null
  is_main: boolean
  is_active: boolean
}

type StudyBranchRow = {
  branch_id: string | null
  study_at: string | null
  received_at: string | null
}

type BranchCountRow = {
  branch_id: string | null
}

export async function getBranchSummaries(
  organizationId: string
): Promise<BranchSummary[]> {
  if (!isSupabaseConfigured) {
    return [
      {
        id: "demo-branch",
        name: "Merkez",
        slug: "merkez",
        code: "MERKEZ",
        isMain: true,
        isActive: true,
        patientCount: 0,
        studyCount: 0,
        modalityCount: 0,
        lastStudyAt: null,
      },
    ]
  }

  const supabase = await createClient()
  const { data: branches, error } = await supabase
    .from("branches")
    .select("id, name, slug, code, is_main, is_active")
    .eq("organization_id", organizationId)
    .order("is_main", { ascending: false })
    .order("name")

  if (error) return []

  const branchRows = (branches ?? []) as BranchRow[]
  const [patientsResult, studiesResult, modalitiesResult] = await Promise.all([
    supabase
      .from("patients")
      .select("branch_id")
      .eq("organization_id", organizationId)
      .is("archived_at", null),
    supabase
      .from("studies")
      .select("branch_id, study_at, received_at")
      .eq("organization_id", organizationId),
    supabase
      .from("dicom_modalities")
      .select("branch_id")
      .eq("organization_id", organizationId),
  ])

  const patients = (patientsResult.data ?? []) as BranchCountRow[]
  const studies = (studiesResult.data ?? []) as StudyBranchRow[]
  const modalities = (modalitiesResult.data ?? []) as BranchCountRow[]

  return branchRows.map((branch) => {
    const branchPatients = patients.filter((patient) => patient.branch_id === branch.id)
    const branchStudies = studies.filter((study) => study.branch_id === branch.id)
    const branchModalities = modalities.filter(
      (modality) => modality.branch_id === branch.id
    )
    const lastStudyAt =
      branchStudies
        .map((study) => study.received_at ?? study.study_at)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null

    return {
      id: branch.id,
      name: branch.name,
      slug: branch.slug,
      code: branch.code,
      isMain: branch.is_main,
      isActive: branch.is_active,
      patientCount: branchPatients.length,
      studyCount: branchStudies.length,
      modalityCount: branchModalities.length,
      lastStudyAt,
    }
  })
}

export async function getBranchOptions(organizationId: string): Promise<BranchOption[]> {
  if (!isSupabaseConfigured) {
    return [
      {
        id: "demo-branch",
        name: "Merkez",
        slug: "merkez",
        code: "MERKEZ",
        isMain: true,
      },
    ]
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("branches")
    .select("id, name, slug, code, is_main")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("is_main", { ascending: false })
    .order("name")

  if (error || !data?.length) return []

  return ((data ?? []) as BranchRow[]).map((branch) => ({
    id: branch.id,
    name: branch.name,
    slug: branch.slug,
    code: branch.code,
    isMain: branch.is_main,
  }))
}

export async function getAuthorizedBranchOptions({
  organizationId,
  user,
}: {
  organizationId: string
  user?: Pick<CurrentUser, "defaultBranchId" | "id" | "role"> | null
}): Promise<BranchOption[]> {
  const branches = await getBranchOptions(organizationId)
  if (!isSupabaseConfigured || !user || user.role === "admin" || !branches.length) {
    return orderBranchesByDefault(branches, user?.defaultBranchId ?? null)
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("organization_member_branches")
    .select("branch_id")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("is_active", true)

  if (error) {
    if (isMissingBranchAccessTableError(error)) {
      return orderBranchesByDefault(branches, user.defaultBranchId)
    }

    return user.defaultBranchId
      ? branches.filter((branch) => branch.id === user.defaultBranchId)
      : []
  }

  const allowedBranchIds = new Set((data ?? []).map((row) => String(row.branch_id)))
  if (user.defaultBranchId) allowedBranchIds.add(user.defaultBranchId)

  const authorizedBranches = branches.filter((branch) => allowedBranchIds.has(branch.id))
  return orderBranchesByDefault(
    authorizedBranches.length ? authorizedBranches : branches.filter((branch) => branch.id === user.defaultBranchId),
    user.defaultBranchId
  )
}

export async function resolveSelectedBranch(
  organizationId: string,
  requestedSlug?: string,
  user?: Pick<CurrentUser, "defaultBranchId" | "id" | "role"> | null
) {
  const branches = await getAuthorizedBranchOptions({ organizationId, user })
  const normalizedSlug = requestedSlug?.trim().toLowerCase()
  const selectedBranch =
    branches.find((branch) => branch.slug === normalizedSlug) ??
    branches.find((branch) => branch.id === user?.defaultBranchId) ??
    branches.find((branch) => branch.isMain) ??
    branches.find((branch) => branch.slug === "merkez") ??
    branches[0] ??
    null

  return { branches, selectedBranch }
}

function orderBranchesByDefault(branches: BranchOption[], defaultBranchId: string | null) {
  if (!defaultBranchId) return branches

  return [...branches].sort((left, right) => {
    if (left.id === defaultBranchId) return -1
    if (right.id === defaultBranchId) return 1
    if (left.isMain && !right.isMain) return -1
    if (!left.isMain && right.isMain) return 1
    return left.name.localeCompare(right.name, "tr")
  })
}

function isMissingBranchAccessTableError(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    /organization_member_branches|schema cache|does not exist|relation/i.test(error.message ?? "")
  )
}
