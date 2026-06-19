# RAI PACS MVP

Bulut tabanli PACS ve radyoloji is istasyonu.

Canli site:

```text
https://app.raipacs.com
```

## Gelistirme

```bash
npm install
cp .env.example .env.local
npm run dev
```

Next.js gelistirme adresi:

```bash
http://127.0.0.1:4174
```

Supabase env degiskenleri bosken uygulama demo modunda calisir.

## Veritabani

Ilk migration:

```text
supabase/migrations/202606180001_initial_pacs_schema.sql
```

Mimari notlari: `docs/architecture.md`.

DICOM klasor import operasyon notu:

```text
docs/dicom-folder-import-runbook.md
```

## Mevcut statik prototip

GitHub Pages yayini kesilmemesi icin `index.html`, `app.js` ve `styles.css`
dosyalari gecici olarak repoda tutulur. Next.js uygulamasi Vercel'e alindiginda
alan adi yeni deploymente tasinabilir.
