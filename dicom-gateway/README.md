# RAI PACS DICOM Gateway

Bu klasor RAI PACS icin ilk Orthanc tabanli DICOM Gateway PoC kurulumudur.
Amac, klasik DICOM protokoluyle gelen goruntuleri RAI metadata ve Storage
akisi ile bulusturmaktir.

## Portlar

- DICOM C-STORE: `4242`
- Orthanc REST UI: `127.0.0.1:8042`
- DICOMweb root: `http://127.0.0.1:8042/dicom-web/`
- WADO legacy root: `http://127.0.0.1:8042/wado`

HTTP portu varsayilan olarak sadece localhost'a aciktir. Production'da REST ve
DICOMweb erisimi TLS, VPN veya reverse proxy arkasina alinmadan internete
acilmamalidir.

## Calistirma

```bash
cd dicom-gateway
docker compose up -d
```

Arayuz:

```text
http://127.0.0.1:8042
```

Varsayilan test kullanicisi:

```text
rai-admin / change-this-password
```

Production veya paylasimli test ortamina gecmeden once
`orthanc/orthanc.json` icindeki parolayi mutlaka degistirin.

## Modalite Ayari

Modalite veya dis PACS tarafinda hedef:

```text
AE Title: RAIPACS
Host: <gateway-host>
Port: 4242
```

## RAI Entegrasyon Hedefi

PoC'nin sonraki adimi bridge komutudur:

1. Orthanc yeni instance aldiginda olayi yakalar.
2. Instance metadata'sini Orthanc REST API'den okur.
3. Hasta/tetkik/seri/instance kayitlarini Supabase Postgres'e upsert eder.
4. Orijinal DICOM dosyasini RAI Storage `dicom-originals` bucket'ina tasir.
5. RAI Viewer ve OHIF icin DICOMweb veya mevcut signed URL akisini hazirlar.

Bu PoC'de Orthanc kalici ana arsiv degil, DICOM protokol kapisi olarak
konumlandirilmistir. Ana hasta/tetkik is akisi RAI uygulamasinda kalir.

## Orthanc Study Import Bridge

Repo kokunden calistirilir. Komut, Orthanc'taki tek bir study'nin instance
dosyalarini gecici klasore indirir ve mevcut `import:dicom-folder` akisini
calistirir.

Gerekli RAI import env degiskenleri:

```text
RAI_PACS_SUPABASE_URL=
RAI_PACS_SUPABASE_PUBLISHABLE_KEY=
RAI_PACS_IMPORT_EMAIL=
RAI_PACS_IMPORT_PASSWORD=
```

Orthanc env degiskenleri icin `dicom-gateway/.env.example` dosyasini baz alin:

```bash
RAI_PACS_ORTHANC_URL=http://127.0.0.1:8042
RAI_PACS_ORTHANC_USERNAME=rai-admin
RAI_PACS_ORTHANC_PASSWORD=change-this-password
RAI_PACS_ORTHANC_STUDY_ID=<orthanc-study-id>
npm run import:orthanc-study
```

Study internal ID bilinmiyorsa `StudyInstanceUID` ile de arama yapilabilir:

```bash
RAI_PACS_ORTHANC_STUDY_UID=1.2.840....
npm run import:orthanc-study
```

PoC sirasinda `RAI_PACS_ORTHANC_DELETE_AFTER_IMPORT=false` kalsin. Import
sonrasi otomatik silme, ancak Storage ve Postgres dogrulamasi otomatiklestikten
sonra acilmali.
