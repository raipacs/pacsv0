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
3. Bridge servis taslagini ekle.
4. Bridge ile RAI Storage'a kopyalama ve Postgres upsert yap.
5. RAI Viewer'in ayni tetkiki Storage'dan actigini dogrula.
