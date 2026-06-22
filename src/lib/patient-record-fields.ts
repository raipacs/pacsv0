import type { PatientExternalData, PatientExternalValue } from "@/lib/types"

export const PATIENT_RECORD_FIELDS = [
  "Id",
  "HastaTipiId",
  "Adi",
  "Soyadi",
  "CinsiyetId",
  "AnneAdi",
  "BabaAdi",
  "DogumTarihi",
  "MedulaSigortaliTuruId",
  "AnneTCKimlikNo",
  "SGKKurumId",
  "OSSKurumId",
  "AKKurumId",
  "IndirimGrubuId",
  "KartNo",
  "GSM",
  "SabitTel",
  "Fax",
  "IlIdEv",
  "IlceIdEv",
  "EvAdresi",
  "PostaKoduEv",
  "Email",
  "UyrukId",
  "KimlikIlId",
  "KimlikIlceId",
  "KimlikKoyMahalle",
  "KimlikSeriNo",
  "KimlikCiltNo",
  "KimlikAileNo",
  "KimlikSiraNo",
  "KimlikVerilisTarihi",
  "KimlikVerildigiIlceId",
  "KanGrubuId",
  "MedeniHaliId",
  "MeslekId",
  "EgitimDurumuId",
  "GelirDurumuId",
  "EngelDurumuId",
  "IndirimPersonelId",
  "AktifHastaId",
  "IsEmailIstemiyor",
  "IsSMSIstemiyor",
  "IsKvkkIzin",
  "IptalAciklamaId",
  "IptalAciklamasi",
  "OperationTypeId",
  "CreatedByLoginId",
  "CreatedDate",
  "ModifiedByLoginId",
  "ModifiedDate",
  "State",
  "RecordStamp",
  "DogumYeri",
  "UlkeIdEv",
  "IndirimAciklama",
  "TCKimlikNo",
  "PasaportNo",
  "MedulaDevredilenKurumId",
  "AktarimHastaId",
  "UlkeIdIs",
  "IlIdIs",
  "IlceIdIs",
  "IsAdresi",
  "KimlikTipiId",
  "TaahhutAdresPlakaKodu",
  "TaahhutAdresIlceAdi",
  "TaahhutAdresCaddeSokak",
  "TaahhutAdresDisKapiNo",
  "TaahhutTelNumara",
  "MedulaOrtodontiFormNo",
  "AnneSoyadi",
  "WebSifresi",
  "WebSifreTarihi",
  "DedeAdi",
  "YupassNo",
  "SicilNo",
  "IsRandevuHatarlatmaIstemiyor",
  "IsBizdeDogan",
  "DogumSirasi",
  "IsTercumanGereksinimiVar",
  "ErisimKanaliId",
  "ErisimKanaliAciklama",
  "CalistigiKurumId",
  "GercekAdi",
  "GercekSoyadi",
  "GercekGSM",
  "KurumSicilNo",
  "AracPlakasi",
  "EskiMeslekId",
  "SubeId",
  "AktarimHastaNo",
  "HastaId",
  "IletisimDilId",
  "UlkeId",
  "AnneHastaId",
  "YabanciHastaTipiId",
  "KayitKaynagiId",
  "SearchKey",
  "IdentityId",
  "Email2",
  "UlkeIdEvDiger",
  "IlIdEvDiger",
  "IlceIdEvDiger",
  "EvAdresiDiger",
  "CocukSirasi",
  "ComedLisNo",
  "ComedLisOwnerTenantId",
  "ComedLisOwnerId",
  "MerkezId",
  "GuvenlikSeviyesiId",
  "CariId",
  "UlkeTelefonKoduId",
  "AranmaDurumuId",
  "UlkeTelefonKodu",
  "PoliceTuru",
  "MahalleIdEv",
  "CaddeSokakEv",
  "BinaNoEv",
  "DaireNoEv",
  "KatNoEv",
  "PoliceAdi",
  "IsMobilUser",
  "LastMobileLoginDate",
  "GsmE164",
] as const

export const PATIENT_EMPTY_RECORD_FIELDS = [
  "AktarimSayisi",
  "AltErisimKanaliId",
  "CagriMerkeziAktarimTarihi",
  "CocukSirasi",
  "DepartmanId",
  "DilId",
  "EntegrasyonKodu",
  "HastaGrubuId",
  "HastaGrubuIds",
  "IsPersonel",
  "IsSosyalMedyadaPaylasilabilir",
  "KokHucreNumarasi",
  "MerkezAktarimSayac",
  "PacsHastaNo",
  "PostaKoduEvDiger",
  "PostaKoduIs",
  "SirketBilgisi",
  "TaahhutAdresIcKapiNo",
  "TaahhutAdresPostaKodu",
  "TaahhutEPosta",
  "YakinAdi",
  "YakinGSM",
  "YakinlikId",
  "YakinlikSirasi",
  "YakinlikTipiId",
  "YakinSoyadi",
  "YakinTel",
  "YardimHakkiId",
  "Adi2",
] as const

const ALL_PATIENT_RECORD_FIELDS = [
  ...PATIENT_RECORD_FIELDS,
  ...PATIENT_EMPTY_RECORD_FIELDS,
] as const

const ACRONYMS = new Map([
  ["Id", "ID"],
  ["GSM", "GSM"],
  ["SMS", "SMS"],
  ["KVKK", "KVKK"],
  ["TC", "TC"],
  ["TCKimlikNo", "TC Kimlik No"],
  ["YupassNo", "YUPASS No"],
  ["PacsHastaNo", "PACS Hasta No"],
])

export type PatientRecordRow = {
  key: string
  label: string
  value: string
  source: PatientRecordSource
  isBlank: boolean
}

type PatientRecordSource =
  | "PendikHastanesi"
  | "VeriIcermeyenKolonlar"
  | "Ek alan"

export function buildPatientRecordRows(
  data: PatientExternalData | null | undefined
): PatientRecordRow[] {
  if (!data) return []

  const ordered = ALL_PATIENT_RECORD_FIELDS.map((key) => ({
    key,
    source: (PATIENT_EMPTY_RECORD_FIELDS.includes(
      key as (typeof PATIENT_EMPTY_RECORD_FIELDS)[number]
    )
      ? "VeriIcermeyenKolonlar"
      : "PendikHastanesi") as PatientRecordSource,
    value: data[key],
  }))

  const extras = Object.entries(data)
    .filter(([key]) => !ALL_PATIENT_RECORD_FIELDS.includes(key as never))
    .map(([key, value]) => ({ key, source: "Ek alan" as const, value }))

  return [...ordered, ...extras].map((row) => {
    const value = formatPatientRecordValue(row.value)
    return {
      key: row.key,
      label: formatPatientRecordLabel(row.key),
      value,
      source: row.source,
      isBlank: value === "-",
    }
  })
}

export function formatPatientRecordValue(value: PatientExternalValue): string {
  if (value === null || value === undefined || value === "") return "-"
  if (typeof value === "boolean") return value ? "Evet" : "Hayır"
  return String(value)
}

function formatPatientRecordLabel(key: string) {
  const direct = ACRONYMS.get(key)
  if (direct) return direct

  return key
    .replace(/TCKimlikNo/g, "TC Kimlik No")
    .replace(/([a-zçğıöşü])([A-ZÇĞİÖŞÜ])/g, "$1 $2")
    .replace(/([A-ZÇĞİÖŞÜ]+)([A-ZÇĞİÖŞÜ][a-zçğıöşü])/g, "$1 $2")
    .replace(/\bId\b/g, "ID")
    .replace(/\bNo\b/g, "No")
}
