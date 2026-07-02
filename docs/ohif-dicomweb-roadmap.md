# OHIF and DICOMweb Roadmap

## Current phase

RAI PACS currently opens OHIF through signed `dicomjson` manifests:

- Single study: `/viewer-data/studies/:studyId`
- Patient session: `/viewer-data/ohif-session`
- Instance proxy: `/viewer-data/instances/:instanceId`

This keeps OHIF usable without exposing Supabase Storage directly. The limitation is that
`viewer.ohif.org` remains an external UI and its study list is session-manifest based.

## Phase 2 read-only foundation

The first DICOMweb read-only layer is now available under `/dicomweb`:

- `GET /dicomweb/studies`
- `GET /dicomweb/studies/{StudyInstanceUID}/series`
- `GET /dicomweb/studies/{StudyInstanceUID}/series/{SeriesInstanceUID}/instances`
- `GET /dicomweb/studies/{StudyInstanceUID}/metadata`
- `GET /dicomweb/studies/{StudyInstanceUID}/series/{SeriesInstanceUID}/metadata`
- `GET /dicomweb/studies/{StudyInstanceUID}/series/{SeriesInstanceUID}/instances/{SOPInstanceUID}/metadata`
- `GET /dicomweb/studies/{StudyInstanceUID}/series/{SeriesInstanceUID}/instances/{SOPInstanceUID}`

Authorization supports the current RAI app session or a Bearer/query launch token. When a
launch token is used, access is restricted to the studies included in that token.

Frame-level WADO-RS is intentionally not marked complete yet. It needs explicit frame
extraction and multipart response handling, especially for compressed DICOM transfer syntaxes.

## Phase 2 target

Move to a RAI-controlled OHIF + DICOMweb deployment:

- `ohif.raipacs.com`: self-hosted OHIF build with RAI branding and no public OHIF banner.
- `dicomweb.raipacs.com`: RAI DICOMweb gateway.
- `GET /dicomweb/studies`: QIDO-RS study search.
- `GET /dicomweb/studies/:studyInstanceUid/series`: QIDO-RS series search.
- `GET /dicomweb/studies/:studyInstanceUid/series/:seriesInstanceUid/instances`: QIDO-RS instance search.
- `GET /dicomweb/studies/:studyInstanceUid/series/:seriesInstanceUid/instances/:sopInstanceUid/frames/:frame`: WADO-RS frames.
- `POST /dicomweb/studies`: STOW-RS import path for future integrations.

## Implementation order

1. Complete DICOMweb read APIs backed by current PostgreSQL metadata and Supabase Storage.
2. Add frame-level WADO-RS responses for OHIF's native DICOMweb renderer.
3. Add OAuth/session handoff from RAI Viewer to self-host OHIF.
4. Deploy OHIF as a separate Vercel or Cloud Run app under `ohif.raipacs.com`.
5. Configure OHIF datasource to `dicomweb.raipacs.com`.
6. Keep current `viewer.ohif.org` links as fallback until self-host OHIF is stable.

## Security baseline

- Use short-lived signed RAI session tokens for OHIF launch.
- Keep DICOM objects private in Storage.
- Do not expose raw bucket URLs to the browser.
- Restrict CORS to `app.raipacs.com`, `ohif.raipacs.com`, and approved staging domains.
- Log QIDO/WADO access by organization, branch, user, study and IP.

## Operational notes

The current multi-study dicomjson route is the bridge. It is enough for testing OHIF study
navigation today, but it should not be treated as the final enterprise PACS viewer layer.
