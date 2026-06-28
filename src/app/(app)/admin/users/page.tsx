import Link from "next/link"

import {
  createAccessGroup,
  updateMemberBranchAccess,
  updateGroupMembership,
  updateGroupPermission,
  updateMemberAccess,
} from "@/app/actions/admin"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Admin" }

type ProfileRef = { full_name: string | null } | null
type MemberRow = {
  user_id: string
  role: "admin" | "doctor" | string
  is_active: boolean | null
  branch_id: string | null
  profiles: ProfileRef | ProfileRef[]
}
type BranchRow = {
  id: string
  name: string
  is_main: boolean | null
}
type BranchAccessRow = {
  branch_id: string
  user_id: string
  is_active: boolean | null
}
type GroupRow = {
  id: string
  name: string
  slug: string
  description: string | null
}
type GroupMemberRow = {
  group_id: string
  user_id: string
  is_active: boolean | null
}
type PermissionRow = {
  group_id: string
  table_name: string
  can_select: boolean | null
  can_insert: boolean | null
  can_update: boolean | null
  can_delete: boolean | null
}

const permissionTables = [
  ["patients", "Hasta kartı"],
  ["studies", "Tetkikler"],
  ["series", "Seriler"],
  ["instances", "DICOM instance"],
  ["reports", "Raporlar"],
  ["study_assignments", "Atamalar"],
  ["dicom_import_jobs", "Import kuyruğu"],
  ["dicom_modalities", "Modaliteler"],
  ["ai_service_providers", "AI servisleri"],
  ["ai_jobs", "AI iş kuyruğu"],
  ["ai_report_drafts", "AI ön raporları"],
  ["ai_usage_events", "AI token tüketimi"],
  ["branches", "Şubeler"],
  ["organization_members", "Kullanıcı üyelikleri"],
  ["access_groups", "Gruplar"],
  ["group_table_permissions", "Grup yetkileri"],
] as const

const responsibilityPresets = [
  {
    title: "Radyolog",
    text: "Worklist, viewer, rapor yazma ve rapor güncelleme akışları.",
  },
  {
    title: "Teknisyen",
    text: "Modalite aktarımı, DICOM import, tetkik düzeltme ve kalite kontrol.",
  },
  {
    title: "Supervisor",
    text: "Hasta/tetkik düzeltme, şube koordinasyonu ve operasyon takibi.",
  },
  {
    title: "Admin",
    text: "Kullanıcı, grup, şube, DICOM Server ve HIS entegrasyon yönetimi.",
  },
  {
    title: "Hasta kayıt",
    text: "Demografi, HIS kaynak alanları ve erişim kontrolüyle kayıt yönetimi.",
  },
]

export default async function UsersPage() {
  const admin = await requireAdmin()
  const supabase = await createClient()

  const [
    membersResult,
    branchesResult,
    branchAccessResult,
    groupsResult,
    groupMembersResult,
    permissionsResult,
  ] = await Promise.all([
      supabase
        .from("organization_members")
        .select("user_id, role, is_active, branch_id, profiles(full_name)")
        .eq("organization_id", admin.organizationId)
        .order("role", { ascending: true }),
      supabase
        .from("branches")
        .select("id, name, is_main")
        .eq("organization_id", admin.organizationId)
        .order("is_main", { ascending: false })
        .order("name", { ascending: true }),
      supabase
        .from("organization_member_branches")
        .select("user_id, branch_id, is_active")
        .eq("organization_id", admin.organizationId)
        .eq("is_active", true),
      supabase
        .from("access_groups")
        .select("id, name, slug, description")
        .eq("organization_id", admin.organizationId)
        .order("name", { ascending: true }),
      supabase
        .from("access_group_members")
        .select("group_id, user_id, is_active")
        .eq("organization_id", admin.organizationId)
        .eq("is_active", true),
      supabase
        .from("group_table_permissions")
        .select("group_id, table_name, can_select, can_insert, can_update, can_delete")
        .eq("organization_id", admin.organizationId),
    ])

  const members = ((membersResult.data ?? []) as MemberRow[]).sort((a, b) =>
    memberName(a, admin).localeCompare(memberName(b, admin), "tr")
  )
  const branches = (branchesResult.data ?? []) as BranchRow[]
  const branchAccessRows = isMissingBranchAccessTableError(branchAccessResult.error)
    ? []
    : ((branchAccessResult.data ?? []) as BranchAccessRow[])
  const groups = (groupsResult.data ?? []) as GroupRow[]
  const groupMembers = (groupMembersResult.data ?? []) as GroupMemberRow[]
  const permissions = (permissionsResult.data ?? []) as PermissionRow[]
  const branchById = new Map(branches.map((branch) => [branch.id, branch]))
  const branchAccessByUser = branchAccessRows.reduce<Map<string, Set<string>>>((acc, row) => {
    const values = acc.get(row.user_id) ?? new Set<string>()
    values.add(row.branch_id)
    acc.set(row.user_id, values)
    return acc
  }, new Map())
  members.forEach((member) => {
    if (!member.branch_id) return
    const values = branchAccessByUser.get(member.user_id) ?? new Set<string>()
    values.add(member.branch_id)
    branchAccessByUser.set(member.user_id, values)
  })
  const branchAccessReady = !branchAccessResult.error
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const groupsByUser = groupMembers.reduce<Map<string, GroupRow[]>>((acc, row) => {
    const group = groupById.get(row.group_id)
    if (!group) return acc
    acc.set(row.user_id, [...(acc.get(row.user_id) ?? []), group])
    return acc
  }, new Map())
  const permissionsByGroupTable = new Map(
    permissions.map((permission) => [
      `${permission.group_id}:${permission.table_name}`,
      permission,
    ])
  )
  const activeUsers = members.filter((member) => member.is_active !== false).length
  const adminUsers = members.filter((member) => member.role === "admin").length

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Yönetim</p>
          <h1>Admin</h1>
          <p>Kullanıcı, grup, rol ve RIS/PACS sorumluluklarını buradan yönetin.</p>
        </div>
        <div className="page-actions">
          <Link className="button subtle" href="/admin/branches">
            Şubeler
          </Link>
          <Link className="button subtle" href="/admin/dicom-server">
            DICOM Server
          </Link>
          <Link className="button subtle" href="/admin/his-integration">
            HIS Entegrasyonu
          </Link>
          <Link className="button subtle" href="/admin/ai-services">
            AI Servisleri
          </Link>
        </div>
      </header>

      <section className="metric-row admin-user-metrics">
        <article>
          <span>Aktif kullanıcı</span>
          <strong>
            {activeUsers}/{members.length}
          </strong>
        </article>
        <article>
          <span>Admin yetkili</span>
          <strong>{adminUsers}</strong>
        </article>
        <article>
          <span>Grup</span>
          <strong>{groups.length}</strong>
        </article>
        <article>
          <span>Şube</span>
          <strong>{branches.length}</strong>
        </article>
      </section>

      <section className="data-panel admin-section">
        <div className="panel-heading">
          <h2>Kullanıcı yönetimi</h2>
        </div>
        <div className="responsive-table">
          <table className="admin-users-table">
            <thead>
              <tr>
                <th>Kullanıcı</th>
                <th>Rol ve varsayılan şube</th>
                <th>Gruplar</th>
                <th>Sorumluluk</th>
                <th>Şube yetkileri</th>
                <th>Durum</th>
                <th>Güncelle</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const userGroups = groupsByUser.get(member.user_id) ?? []
                const branch = member.branch_id ? branchById.get(member.branch_id) : null
                const userBranchAccess = branchAccessByUser.get(member.user_id) ?? new Set<string>()
                const availableGroups = groups.filter(
                  (group) => !userGroups.some((item) => item.id === group.id)
                )

                return (
                  <tr key={member.user_id}>
                    <td>
                      <strong>{memberName(member, admin)}</strong>
                      <span>{member.user_id === admin.id ? admin.email : shortId(member.user_id)}</span>
                    </td>
                    <td>
                      <form action={updateMemberAccess} className="compact-admin-form">
                        <input name="memberUserId" type="hidden" value={member.user_id} />
                        <label>
                          Ad soyad
                          <input
                            name="fullName"
                            defaultValue={memberName(member, admin)}
                            placeholder="Ad soyad"
                            required
                          />
                        </label>
                        <label>
                          Rol
                          <select name="role" defaultValue={member.role === "admin" ? "admin" : "doctor"}>
                            <option value="admin">Admin</option>
                            <option value="doctor">Klinik kullanıcı</option>
                          </select>
                        </label>
                        <label>
                          Varsayılan şube
                          <select name="branchId" defaultValue={member.branch_id ?? ""} required>
                            <option value="" disabled>
                              Şube seç
                            </option>
                            {branches.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="checkbox-line">
                          <input
                            defaultChecked={member.is_active !== false}
                            name="isActive"
                            type="checkbox"
                          />
                          Aktif
                        </label>
                        <button className="button subtle" type="submit">
                          Kaydet
                        </button>
                      </form>
                      <small>{branch?.name ?? "Varsayılan şube seçilmemiş"}</small>
                    </td>
                    <td>
                      <div className="chip-list">
                        {userGroups.length ? (
                          userGroups.map((group) => (
                            <span className="permission-chip" key={group.id}>
                              {group.name}
                            </span>
                          ))
                        ) : (
                          <span className="muted-text">Grup yok</span>
                        )}
                      </div>
                    </td>
                    <td>{responsibilityText(member.role, userGroups)}</td>
                    <td>
                      <form action={updateMemberBranchAccess} className="branch-access-form">
                        <input name="memberUserId" type="hidden" value={member.user_id} />
                        {branches.map((item) => (
                          <label className="checkbox-line" key={item.id}>
                            <input
                              defaultChecked={userBranchAccess.has(item.id)}
                              disabled={!branchAccessReady}
                              name="branchIds"
                              type="checkbox"
                              value={item.id}
                            />
                            {item.name}
                            {item.is_main ? " (Merkez)" : ""}
                          </label>
                        ))}
                        <button className="button subtle" disabled={!branchAccessReady} type="submit">
                          Şubeleri kaydet
                        </button>
                        {!branchAccessReady ? (
                          <small>Şube yetki migration&apos;ı bekleniyor.</small>
                        ) : null}
                      </form>
                    </td>
                    <td>
                      <span
                        className={`health-badge ${member.is_active === false ? "warning" : "ok"}`}
                      >
                        {member.is_active === false ? "Pasif" : "Aktif"}
                      </span>
                    </td>
                    <td>
                      <form action={updateGroupMembership} className="stacked-admin-form">
                        <input name="memberUserId" type="hidden" value={member.user_id} />
                        <input name="intent" type="hidden" value="add" />
                        <select name="groupId" defaultValue="">
                          <option value="" disabled>
                            Gruba ekle
                          </option>
                          {availableGroups.map((group) => (
                            <option key={group.id} value={group.id}>
                              {group.name}
                            </option>
                          ))}
                        </select>
                        <button className="button subtle" disabled={!availableGroups.length} type="submit">
                          Ekle
                        </button>
                      </form>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-user-grid">
        <section className="data-panel admin-section">
          <div className="panel-heading">
            <h2>Grup yönetimi</h2>
          </div>
          <div className="group-card-list">
            {groups.map((group) => {
              const memberIds = groupMembers
                .filter((item) => item.group_id === group.id)
                .map((item) => item.user_id)
              const groupUsers = members.filter((member) => memberIds.includes(member.user_id))

              return (
                <article className="group-card" key={group.id}>
                  <div>
                    <h3>{group.name}</h3>
                    <p>{group.description || "Özel açıklama yok."}</p>
                  </div>
                  <div className="chip-list">
                    {groupUsers.length ? (
                      groupUsers.map((member) => (
                        <form action={updateGroupMembership} key={member.user_id}>
                          <input name="memberUserId" type="hidden" value={member.user_id} />
                          <input name="groupId" type="hidden" value={group.id} />
                          <input name="intent" type="hidden" value="remove" />
                          <button className="permission-chip removable-chip" type="submit">
                            {memberName(member, admin)} x
                          </button>
                        </form>
                      ))
                    ) : (
                      <span className="muted-text">Üye yok</span>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section className="data-panel admin-section">
          <div className="panel-heading">
            <h2>Yeni grup</h2>
          </div>
          <form action={createAccessGroup} className="admin-create-group">
            <label>
              Grup adı
              <input name="name" placeholder="Örn. Technicians" required />
            </label>
            <label>
              Açıklama
              <textarea
                name="description"
                placeholder="RIS/PACS içindeki görev ve kapsam"
                rows={4}
              />
            </label>
            <button className="button primary" type="submit">
              Grup oluştur
            </button>
          </form>
        </section>
      </section>

      <details className="data-panel admin-section collapsible-panel" open>
        <summary className="panel-heading">
          <h2>Yetki matrisi</h2>
          <span className="panel-toggle">Liste</span>
        </summary>
        <div className="responsive-table">
          <table className="permission-matrix">
            <thead>
              <tr>
                <th>Grup</th>
                <th>Alan</th>
                <th>Oku</th>
                <th>Ekle</th>
                <th>Düzenle</th>
                <th>Sil</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {groups.flatMap((group) =>
                permissionTables.map(([tableName, label]) => {
                  const permission =
                    permissionsByGroupTable.get(`${group.id}:${tableName}`) ?? null

                  return (
                    <tr key={`${group.id}-${tableName}`}>
                      <td>
                        <strong>{group.name}</strong>
                        <span>{group.slug}</span>
                      </td>
                      <td>{label}</td>
                      <PermissionForm
                        groupId={group.id}
                        permission={permission}
                        tableName={tableName}
                      />
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </details>

      <section className="data-panel admin-section">
        <div className="panel-heading">
          <h2>RIS/PACS sorumluluk şablonları</h2>
        </div>
        <div className="responsibility-grid">
          {responsibilityPresets.map((preset) => (
            <article key={preset.title}>
              <strong>{preset.title}</strong>
              <p>{preset.text}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  )
}

function PermissionForm({
  groupId,
  permission,
  tableName,
}: {
  groupId: string
  permission: PermissionRow | null
  tableName: string
}) {
  const formId = `permission-${groupId}-${tableName}`

  return (
    <>
      <td>
        <input
          defaultChecked={Boolean(permission?.can_select)}
          form={formId}
          name="canSelect"
          type="checkbox"
        />
      </td>
      <td>
        <input
          defaultChecked={Boolean(permission?.can_insert)}
          form={formId}
          name="canInsert"
          type="checkbox"
        />
      </td>
      <td>
        <input
          defaultChecked={Boolean(permission?.can_update)}
          form={formId}
          name="canUpdate"
          type="checkbox"
        />
      </td>
      <td>
        <input
          defaultChecked={Boolean(permission?.can_delete)}
          form={formId}
          name="canDelete"
          type="checkbox"
        />
      </td>
      <td>
        <form action={updateGroupPermission} className="permission-row-form" id={formId}>
          <input name="groupId" type="hidden" value={groupId} />
          <input name="tableName" type="hidden" value={tableName} />
          <button className="button subtle" type="submit">
            Kaydet
          </button>
        </form>
      </td>
    </>
  )
}

function memberName(member: MemberRow, admin: { id: string; fullName: string | null; email: string }) {
  if (member.user_id === admin.id) return admin.fullName || "RAI PACS Admin"

  const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles
  return profile?.full_name || `Kullanıcı ${shortId(member.user_id)}`
}

function shortId(value: string) {
  return `${value.slice(0, 8)}...${value.slice(-4)}`
}

function responsibilityText(role: string, groups: GroupRow[]) {
  if (role === "admin") return "Sistem, kullanıcı, DICOM Server ve entegrasyon yönetimi"

  const slugs = groups.map((group) => group.slug)
  if (slugs.includes("supervisors")) return "Operasyon, hasta/tetkik düzeltme ve kalite kontrol"
  if (slugs.includes("doctors")) return "Worklist, viewer, raporlama ve klinik okuma"
  if (slugs.includes("technicians")) return "DICOM import, modalite aktarımı ve çekim takibi"
  return "Temel RIS/PACS erişimi"
}

function isMissingBranchAccessTableError(error: { code?: string; message?: string } | null) {
  if (!error) return false
  return (
    error.code === "42P01" ||
    /organization_member_branches|schema cache|does not exist|relation/i.test(error.message ?? "")
  )
}
