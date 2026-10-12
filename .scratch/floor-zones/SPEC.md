# Floor, zones, wall sheets and containment

Status: ready-for-agent. Authority: Saeed approved docs/FLOOR-ZONES-IMPLEMENTATION-PLAN.md and its model plan on 12 October 2026. Local tracker is docs/agents/issue-tracker.md. Publication excluded.

## Problem statement

An electrician needs one job-wide floor drawing, work zones, related wall drawings and paper sheets for the site team. The current app supports a single rectangular room with fixed wall views. The design preview demonstrates the desired navigation but uses fixed sample zones and does not save or integrate real fittings.

## Solution

Extend the existing local-first app to an editable rectangular floor with physical walls, named rectangular zones and simple wall-associated containment. Keep drawing space primary, use floor -> zone -> wall -> print navigation, and preserve named jobs, fitting placement, layer filtering, labour totals, backups and offline operation.

## User stories

1. As an electrician, I create a named job and rectangular floor so I can plan one site.
2. I reopen an older job without losing dimensions, fittings, notes or rates.
3. I see the whole floor before selecting any zone.
4. I create a named rectangular zone by entering or drawing its bounds.
5. I resize, move, rename and remove a zone without changing physical walls or fitting quantities.
6. I receive a clear rejection for overlapping, outside-floor or zero-size zones.
7. I can leave some floor uncovered by zones.
8. I choose a zone by menu or tapping its area.
9. I see which physical wall faces belong to the zone and when an edge has no wall.
10. I open a wall face with correct left/right orientation, length and fitting heights.
11. I add a horizontal or vertical interior wall and change its endpoints.
12. I undo or redo wall and zone changes without reusing IDs.
13. I get a safe refusal when deleting or shortening a wall would strand attached fittings/routes.
14. I place and edit fittings on interior walls as well as exterior walls.
15. I keep ceiling fittings on the floor rather than pretending they are wall-mounted.
16. I filter electrical layers without changing prices or losing wall/zone selection.
17. I create a wall-associated trunking or conduit run.
18. I change a run's endpoints, height and type, or remove it.
19. I distinguish containment symbols using a legend, without treating colours alone as the meaning.
20. I see honest unpriced/unsupported containment information rather than invented costs.
21. I save and reopen all floor, zone, wall and route edits.
22. I export/import a single job and all-jobs archive without losing the new data.
23. I receive a usable backup path if storage is blocked or full.
24. I print a readable numbered floor overview and selected wall sheets, with titles and key plans.
25. I can reach controls on desktop, tablet and phone without clipping the drawing or panels.
26. I can update the offline app without old cached code corrupting newer saved records.

## Implementation decisions

- Plain frontend remains; no backend, cloud storage, new runtime dependency or paid API.
- One rectangular floor per job. Rectangular zones have positive bounds, cannot overlap, and need not cover the whole floor.
- Preserve exterior wall identifiers and legacy orientation. New walls have stable monotonically allocated IDs, positive length, axis-aligned endpoints inside the floor and explicit view faces.
- New wall editing must reject duplicate/invalid geometry. No arbitrary polygon floors, angled walls or new wall openings in this release. Existing exterior openings, if any, remain preserved.
- Added wall attachments are stable wall/face references, not indexes into a selected zone. Refuse edits/removal that invalidate fittings, containment, wall notes or sketches; explain which attachments must first be removed or adjusted. No silent reattachment, clamping or data deletion.
- Resize of a floor likewise refuses invalidating geometry/attachments; existing fitting-clamp behaviour requires deliberate user choice and cannot discard new geometry.
- Simple containment is an editable straight wall-face segment with start/end offsets and height, trunking/conduit type and stable ID. Drops, bends, boxes, sizes, prices and automatic route measurement are excluded.
- Zone wall lists derive from physical geometry. Partition faces viewed from opposite sides must have correct mirrored offsets. Print clipped extents honestly and avoid duplicate sheets for the same physical face when multiple zones are selected.
- Add versioned geometry payloads and validators; do not use schema-v1 records to disguise incompatible data. Determine storage namespace/envelope version isolation before implementation. Retain legacy bytes as recovery evidence, copy upgrade atomically, and never allow an older app to overwrite a new record silently.
- All new mutations join existing undo/redo/save transactions, monotonic ID allocation and revision rules.
- UI follows the retained design; edit controls need Opus's bounded interaction contract before corresponding implementation.

## Testing decisions

Approved plan covers public job/geometry operations, backup import/export and saved-job round trips, plus browser journeys and print output. These are the agreed seams, not private helpers. Use literal worked geometry examples as independent expectations. Existing pure core tests and synthetic browser tests are prior art; repair fixture paths before relying on them. Each implementation slice uses one failing behaviour test, implementation, then passing evidence. Controller executes checks on Office; file-only workers must label tests not-run until controller evidence exists.

Include legacy conversion and record isolation, unknown schema/corruption, storage-full/blocked/lock contention, archived imports, undo/redo, negative geometry cases, wall face orientation, stable attachments, layer/price regressions, caption transform stability and offline update. Inspect desktop/tablet/phone screenshots and print PDF. Emulation is not physical device evidence.

## Out of scope

Live publication or merge triggering publication; provider settings; customer-data operations; destructive migrations; pricing workbook edits; raw private-message egress; angled/polygon/multiple-storey geometry; cloud sync; CAD import; containment quantities/pricing/accessories; electrical compliance or circuit design.

## Further notes

The isolated preview is design evidence only. Real-device input remains unverified. Controller owns commits, integration, PR and release gates. Model authority is the approved plan, with exact per-worker admission. The implementation branch may be packaged as a draft PR after the first verified slice; no live-branch merge without release approval.
