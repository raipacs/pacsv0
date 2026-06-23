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

PoC'nin sonraki adimi bir bridge servisidir:

1. Orthanc yeni instance aldiginda olayi yakalar.
2. Instance metadata'sini Orthanc REST API'den okur.
3. Hasta/tetkik/seri/instance kayitlarini Supabase Postgres'e upsert eder.
4. Orijinal DICOM dosyasini RAI Storage `dicom-originals` bucket'ina tasir.
5. RAI Viewer ve OHIF icin DICOMweb veya mevcut signed URL akisini hazirlar.

Bu PoC'de Orthanc kalici ana arsiv degil, DICOM protokol kapisi olarak
konumlandirilmistir. Ana hasta/tetkik is akisi RAI uygulamasinda kalir.
