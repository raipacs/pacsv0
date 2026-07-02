# OHIF and DICOMweb Roadmap

## Current phase

RAI PACS currently opens OHIF through signed `dicomjson` manifests:

- RAI OHIF gateway: `/ohif`
- Self-host OHIF config contract: `/ohif/config`
- Single study: `/viewer-data/studies/:studyId`
- Patient session: `/viewer-data/ohif-session`
- Instance proxy: `/viewer-data/instances/:instanceId`

This keeps OHIF usable without exposing Supabase Storage directly. RAI Viewer now launches
OHIF through the RAI-controlled `/ohif` gateway first. `viewer.ohif.org` remains the fallback UI
until a self-hosted OHIF static build is deployed under `ohif.raipacs.com`.

## Phase 2 read-only foundation

The first DICOMweb read-only layer is now available under `/dicomweb`:

- `GET /dicomweb/studies`
- `GET /dicomweb/studies/{StudyInstanceUID}/series`
- `GET /dicomweb/studies/{StudyInstanceUID}/series/{SeriesInstanceUID}/instances`
- `GET /dicomweb/studies/{StudyInstanceUID}/metadata`
- `GET /dicomweb/studies/{StudyInstanceUID}/series/{SeriesInstanceUID}/metadata`
- `GET /dicomweb/studies/{StudyInstanceUID}/series/{SeriesInstanceUID}/instances/{SOPInstanceUID}/metadata`
- `GET /dicomweb/studies/{StudyInstanceUID}/series/{SeriesInstanceUID}/instances/{SOPInstanceUID}`
- `GET /dicomweb/studies/{StudyInstanceUID}/series/{SeriesInstanceUID}/instances/{SOPInstanceUID}/frames/{frameList}`

Authorization supports the current RAI app session or a Bearer/query launch token. When a
launch token is used, access is restricted to the studies included in that token.

Frame-level WADO-RS has an MVP implementation. Native uncompressed pixel data and
encapsulated compressed frame fragments are returned as `multipart/related` responses.
The next hardening step is broader transfer-syntax validation against real modality datasets.

The RAI OHIF gateway is also available:

- `GET /ohif?token=...`: launch page with study list, DICOMweb root and fallback OHIF viewer.
- `GET /ohif/config?token=...`: signed DICOMweb datasource config for a future self-host OHIF build.
- `ohif.raipacs.com`: host rewrite is prepared so the same app can serve gateway, config, DICOMweb and viewer-data paths.

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
2. Validate frame-level WADO-RS against MR, CT, DX and US modality datasets.
3. Add signed launch handoff from RAI Viewer to the RAI OHIF gateway. Done.
4. Deploy OHIF as a separate Vercel or Cloud Run app under `ohif.raipacs.com`.
5. Configure OHIF datasource from `/ohif/config` and route QIDO/WADO to `/dicomweb`.
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
The `/ohif/config` contract is the bridge from the current fallback viewer to the future
RAI-hosted OHIF application.
