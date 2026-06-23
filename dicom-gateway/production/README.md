# RAI PACS DICOM Gateway VM Runbook

Bu klasor Orthanc Gateway'i kucuk bir Linux VM uzerinde calistirmak icin
production'a yakin PoC paketidir.

## VM Gereksinimi

- Ubuntu 22.04/24.04 LTS veya benzeri Linux
- 2 vCPU, 4 GB RAM baslangic icin yeterli
- Disk: PoC icin 50-100 GB, gercek kullanimda retention politikasina gore daha fazla
- Docker Engine ve Docker Compose plugin
- DNS: `RAI_DICOMWEB_HOSTNAME` VM public IP'sine yonlenmeli

## Portlar

- `4242/tcp`: DICOM C-STORE. Sadece hastane/PACS IP'lerine acilmali.
- `80/tcp`, `443/tcp`: Caddy TLS ve DICOMweb/REST proxy.
- `8042/tcp`: Disari acilmaz; sadece Docker network icinde Orthanc REST.

## Kurulum

```bash
cd dicom-gateway/production
cp .env.example .env
```

`.env` icinde en az sunlari degistirin:

```text
RAI_DICOMWEB_HOSTNAME=dicom.raipacs.com
RAI_ORTHANC_PASSWORD=<strong-password>
RAI_PACS_ORTHANC_PASSWORD=<same-strong-password>
```

Baslatma:

```bash
docker compose up -d
docker compose ps
```

Loglar:

```bash
docker compose logs -f orthanc
docker compose logs -f caddy
```

## Ilk Test

REST/DICOMweb:

```bash
curl -u rai-admin:$RAI_ORTHANC_PASSWORD https://$RAI_DICOMWEB_HOSTNAME/system
curl -u rai-admin:$RAI_ORTHANC_PASSWORD https://$RAI_DICOMWEB_HOSTNAME/dicom-web/studies
```

DICOM hedefi:

```text
AE Title: RAIPACS
Host: <vm-public-or-vpn-ip>
Port: 4242
```

## RAI'ye Aktarma

Orthanc icinde study geldikten sonra repo kokunden:

```bash
npm run sync:orthanc-events
npm run import:orthanc-study
```

Bu komut Orthanc'tan study dosyalarini indirir ve mevcut RAI DICOM import
akisiyle Supabase Storage/Postgres'e aktarir.

Gateway uzerinde timer kuruluysa `rai-orthanc-import.service` once Orthanc
`/changes` olaylarini `dicom_connection_events` tablosuna yazar, sonra bekleyen
study importlarini calistirir. Admin > DICOM Server ekranindaki
`Son baglanti/log olaylari` paneli bu kayitlari gosterir.

## Guvenlik

- `4242/tcp` internete genis acilmamali; firewall veya cloud security group ile
  sadece bilinen kaynak IP'lere izin verilmeli.
- Orthanc parolasi guclu olmali ve repoya yazilmamali.
- Caddy otomatik TLS alir; DNS kaydi VM'e gelmeden HTTPS hazir olmaz.
- Import dogrulamasi otomatiklesmeden `RAI_PACS_ORTHANC_DELETE_AFTER_IMPORT=true`
  yapilmaz.
