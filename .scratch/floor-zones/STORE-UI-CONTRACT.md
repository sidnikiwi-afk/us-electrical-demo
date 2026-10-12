# Existing UI store surface

Controller inventory from prototype/js/ui.js at approved baseline, 12 October 2026. Use this as a navigation pointer for the remaining backend/UI slices, not permission to change legacy storage. v2 create/read/scan/save/copy are only a partial implementation; do not switch UI imports until all used behaviours are supplied and tested.

Current consumer methods/properties:

- acquireOwner
- canWrite
- clearRescue
- create
- dismissJournal
- dismissRescue
- importArchive
- peekLegacy
- promoteRescue
- readJob
- readState
- reconcileLegacy
- rescueRoom
- safeScan
- save
- writeRescue
- writeState

Module exports additionally used by UI: cleanPrefs, canonical, MAX_RESCUES, MAX_JOBS, MAX_ARCHIVE_BYTES, JOB_PREFIX, LEGACY_KEY, buildArchive, isArchiveText, validateArchive, createJobs. The v2 module may expose createJobsV2 and a compatibility alias for UI, but all v2 writes stay under the v2 namespace. Public archive parsing/export and legacy copy must match the approved STORAGE-DESIGN. Preserve checksum recovery, owner/stale locks, rescue capacity, atomic imports, last-open state and readonly fallback.

Boot source anchors: ui.js3251-3300. Storage-event key subscription: ui.js377-381. Rescue and unload/restore: ui.js340-374. Archive export/import: ui.js2374 and2420-2470. Tests should observe public factory/browser journeys, not private helpers. Legacy raw records are downloaded/read-only, never removed by the new UI. No actual user storage is used in workers or tests.
