# DICOM Gateway Architecture

RAI PACS'in dosya yukleme akisi Supabase Storage ve Postgres metadata uzerinde
calisiyor. Hastane cihazlari ve PACS sistemleri icin buna ek olarak DICOM
protokol katmani gerekir. Ilk asamada bu katman Orthanc ile kurulacak bir
gateway olarak tasarlanir.

## Hedef Mimari

```text
Modality / Hospital PACS
        |
        | DICOM C-STORE
        v
Orthanc Gateway (AE: RAIPACS)
        |
        | REST/DICOMweb metadata + original object pull
        v
RAI Import Bridge
        |
        +--> Supabase Postgres: patients, studies, series, instances
        |
        +--> Supabase Storage: dicom-originals
        |
        v
RAI App + RAI Viewer + OHIF
```

## Orthanc'in Rolu

Orthanc bu asamada RAI'nin yerine gecen ana PACS degildir. Rolu:

- C-STORE ile DICOM kabul etmek
- DICOMweb endpoint sunmak
- REST API ile metadata ve dosya erisimi saglamak
- Import bridge icin gecici/staging arayuz olmak

## Neden DICOM Server Gerekli?

Storage bucket DICOM dosyalarini saklar, fakat DICOM cihazlari genellikle dosya
upload degil DICOM protokolu kullanir. Bu nedenle su kabiliyetler icin DICOM
server gerekir:

- AE Title yonetimi
- C-STORE alimi
- DICOMweb QIDO/WADO/STOW uyumu
- Modalite/PACS baglanti testleri
- Daha sonra C-FIND, C-MOVE veya C-GET ihtiyaclari

## Guvenlik Notlari

- DICOM portu sadece gerekli hastane/VPN IP'lerine acilmali.
- Orthanc REST UI internete dogrudan acilmamali.
- Basic auth parolalari repoya yazilmamali; PoC parolasi production icin
  kullanilmamali.
- Gateway loglari ve audit kayitlari HIS/PACS entegrasyonu icin saklanmali.
- Object Storage'a aktarimdan sonra Orthanc retention politikasi netlesmeli.

## Sonraki Sprint

1. Orthanc'i lokal veya kucuk bir cloud VM'de calistir.
2. DICOM export klasorunden `storescu` veya Orthanc REST ile test instance
   gonder.
3. `npm run import:orthanc-study` ile Orthanc study'sini RAI Storage ve
   Postgres'e aktar.
4. RAI Viewer'in ayni tetkiki Storage'dan actigini dogrula.
5. Daha sonra bridge'i manuel komuttan worker/webhook servis haline getir.

## Bridge Komutu

`scripts/import-orthanc-study.mjs` ilk bridge adimidir. Bu komut:

- Orthanc REST API'ye Basic Auth ile baglanir.
- `RAI_PACS_ORTHANC_STUDY_ID` veya `RAI_PACS_ORTHANC_STUDY_UID` ile tek study
  secer.
- Study altindaki tum series ve instance ID'lerini toplar.
- Her instance icin `/instances/{id}/file` endpoint'inden orijinal DICOM'u
  indirir.
- Gecici bir klasor olusturur.
- Mevcut `scripts/import-dicom-folder.mjs` komutunu ayni import kimligi ile
  calistirir.

Bu tasarim mevcut ve test edilmis klasor import mantigini tekrar kullanir.
Ileride webhook/worker servis yazarken ayni cekirdek import mantigi ayrica
modul haline getirilebilir.
