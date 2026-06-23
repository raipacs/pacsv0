import { isSupabaseConfigured } from "@/lib/config"
import { createClient } from "@/lib/supabase/server"

export type HisIntegrationProtocol =
  | "hl7_v2_mllp"
  | "fhir_r4"
  | "rest_api"
  | "webhook"
  | "file_drop"

export type HisIntegrationDirection = "inbound" | "outbound" | "bidirectional"
export type HisIntegrationAuthType =
  | "none"
  | "basic"
  | "bearer"
  | "oauth2_client_credentials"
  | "mutual_tls"
  | "vpn"
export type HisIntegrationStatus = "draft" | "active" | "paused" | "error"

export type HisIntegrationSummary = {
  id: string
  name: string
  vendor: string | null
  branchName: string | null
  protocol: HisIntegrationProtocol
  direction: HisIntegrationDirection
  authType: HisIntegrationAuthType
  endpoint: string
  messageTypes: string[]
  status: HisIntegrationStatus
  lastCheckedAt: string | null
  lastSuccessAt: string | null
  lastErrorAt: string | null
  lastErrorMessage: string | null
}

export type HisIntegrationEvent = {
  id: string
  integrationName: string | null
  eventType: string
  direction: HisIntegrationDirection
  messageType: string | null
  patientNumber: string | null
  accessionNumber: string | null
  status: string
  message: string
  occurredAt: string | null
}

type HisIntegrationRow = {
  id: string
  name: string
  vendor: string | null
  protocol: HisIntegrationProtocol
  direction: HisIntegrationDirection
  auth_type: HisIntegrationAuthType
  endpoint_url: string | null
  host: string | null
  port: number | null
  enabled_message_types: string[] | null
  status: HisIntegrationStatus
  last_checked_at: string | null
  last_success_at: string | null
  last_error_at: string | null
  last_error_message: string | null
  branches:
    | {
        name: string | null
      }
    | Array<{
        name: string | null
      }>
    | null
}

type HisIntegrationEventRow = {
  id: string
  event_type: string
  direction: HisIntegrationDirection
  message_type: string | null
  patient_number: string | null
  accession_number: string | null
  status: string
  message: string
  occurred_at: string | null
  his_integrations:
    | {
        name: string | null
      }
    | Array<{
        name: string | null
      }>
    | null
}

export async function getHisIntegrations(
  organizationId: string
): Promise<HisIntegrationSummary[]> {
  if (!isSupabaseConfigured) {
    return [
      {
        id: "demo-hl7",
        name: "Demo HIS HL7",
        vendor: "Generic HIS",
        branchName: "Merkez",
        protocol: "hl7_v2_mllp",
        direction: "bidirectional",
        authType: "vpn",
        endpoint: "10.10.10.20:2575",
        messageTypes: ["ADT", "ORM", "ORU"],
        status: "draft",
        lastCheckedAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
      },
    ]
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("his_integrations")
    .select(
      "id, name, vendor, protocol, direction, auth_type, endpoint_url, host, port, enabled_message_types, status, last_checked_at, last_success_at, last_error_at, last_error_message, branches(name)"
    )
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })

  if (error) return []

  return ((data ?? []) as HisIntegrationRow[]).map((row) => {
    const branch = Array.isArray(row.branches) ? row.branches[0] : row.branches
    return {
      id: row.id,
      name: row.name,
      vendor: row.vendor,
      branchName: branch?.name ?? null,
      protocol: row.protocol,
      direction: row.direction,
      authType: row.auth_type,
      endpoint: row.endpoint_url || [row.host, row.port].filter(Boolean).join(":") || "-",
      messageTypes: row.enabled_message_types ?? [],
      status: row.status,
      lastCheckedAt: row.last_checked_at,
      lastSuccessAt: row.last_success_at,
      lastErrorAt: row.last_error_at,
      lastErrorMessage: row.last_error_message,
    }
  })
}

export async function getHisIntegrationEvents(
  organizationId: string
): Promise<HisIntegrationEvent[]> {
  if (!isSupabaseConfigured) return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("his_integration_events")
    .select(
      "id, event_type, direction, message_type, patient_number, accession_number, status, message, occurred_at, his_integrations(name)"
    )
    .eq("organization_id", organizationId)
    .order("occurred_at", { ascending: false })
    .limit(12)

  if (error) return []

  return ((data ?? []) as HisIntegrationEventRow[]).map((row) => {
    const integration = Array.isArray(row.his_integrations)
      ? row.his_integrations[0]
      : row.his_integrations
    return {
      id: row.id,
      integrationName: integration?.name ?? null,
      eventType: row.event_type,
      direction: row.direction,
      messageType: row.message_type,
      patientNumber: row.patient_number,
      accessionNumber: row.accession_number,
      status: row.status,
      message: row.message,
      occurredAt: row.occurred_at,
    }
  })
}

export function protocolLabel(protocol: HisIntegrationProtocol) {
  if (protocol === "hl7_v2_mllp") return "HL7 v2 / MLLP"
  if (protocol === "fhir_r4") return "FHIR R4"
  if (protocol === "rest_api") return "REST API"
  if (protocol === "webhook") return "Webhook"
  return "Dosya aktarımı"
}

export function directionLabel(direction: HisIntegrationDirection) {
  if (direction === "inbound") return "HIS -> PACS"
  if (direction === "outbound") return "PACS -> HIS"
  return "Çift yönlü"
}

export function authTypeLabel(authType: HisIntegrationAuthType) {
  if (authType === "none") return "Yok"
  if (authType === "basic") return "Basic Auth"
  if (authType === "bearer") return "Bearer token"
  if (authType === "oauth2_client_credentials") return "OAuth2 client credentials"
  if (authType === "mutual_tls") return "Mutual TLS"
  return "VPN / IP izinli"
}

export function integrationStatusLabel(status: HisIntegrationStatus) {
  if (status === "active") return "Aktif"
  if (status === "paused") return "Pasif"
  if (status === "error") return "Hata"
  return "Taslak"
}
