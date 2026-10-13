# 01-RESULT: EP-FLOOR-01 UI and storage contract

Packet: EP-FLOOR-01 v1, 12 October 2026. Frozen snapshot 62c59e290218a0742d31d95e4d09ca03f3adfb04. Runtime and release reference 94d6345. The PACKET.md file hash was NOT COMPUTED, because the packet allowed no shell access. The controller should record it.
Worker: Opus 5.5 medium, claude-opus-5-5. Ticket: .scratch/floor-zones/issues/01.md (contract items 2 and 3 only).

## VERDICT

DELIVERED, pending controller acceptance. Both contracts exist, and the humanizer pass is done. Tests: NOT RUN.

## Narrative

The UX contract defines the following, with exact copy and worked geometry:
- the view bar: zone menu, then Plan, then face buttons
- a single Build mode that creates everything with two taps
- left-offset face rules that match legacy `fromLeftMm`
- refusals before any wall removal, shortening or floor shrink that would strand attachments
- simple runs with stable T/C numbers
- phone reach
- print sheets de-duplicated by physical face

The storage design keeps schema 2 jobs in a separate `surface.jobs.v2.` namespace, with envelope v2 and job schemaVersion 2. New code never writes or removes v1 keys. It copies older jobs with sha markers and offers, rather than merges, edits the old app made later. Rollback, quota, lock and import paths are spelled out, with 12 acceptance cases.

## COVERAGE

- Packet item 1 → UX-CONTRACT.md:
  - zones: §2, §4, §5
  - stable faces: §1, §5, §6
  - wall add, edit and delete refusals: §7, §8
  - containment: §9
  - mobile: §10
  - print: §11
  - acceptance checks: §13
- Packet item 2 → STORAGE-DESIGN.md:
  - the namespace and version decision: §2
  - validators: §3
  - copy-upgrade: §4
  - failed writes: §5
  - old-tab concurrency: §6
  - imports: §7
  - rollback: §8
  - acceptance cases: §9
- Packet item 3 → this file and the humanizer pass below.

## EVIDENCE (source anchors, all read only)

- jobs.js:11-20 prefixes, :75 envelope v1 check, :131 archive v1 check, :197 scan scope, :233-261 writeNew/readback, :287 stale check, :332-399 legacy copy and markers, :463-511 archive import.
- core.js:5-6 schema constants, :343-348 validateJob version check, :433-452 normaliseJob passes unknown fields through. That last point is why schemaVersion can't stay 1.
- ui.js:57 PHONE, :173-211 commit/undo/redo, :880-888 planPos wall orientation, :1168-1201 tabs, :1642-1676 room form and shrink, :1983-2024 print, :2998 drag history, :3251-3299 boot.
- sw.js:3, 8 cache name and atomic precache. style.css:217-299 phone layout.
- Design: SPEC.md, FLOOR-ZONES-IMPLEMENTATION-PLAN.md, design-previews/floor-zones/DESIGN.md, index.html and app.js:30-192, 541-580 (face derivation, print with no de-duplication).
- Source tokens read: about 40k, which is inside the 45k budget. I searched ui.js for the parts I needed (3311 lines) rather than reading it whole. I didn't read prototype/css in full or the preview style.css.

## Assumptions

- A1. Wall-view sketches and pins are stored in face millimetre coordinates. I saw `job.annotations[view]` at ui.js:3012 but not the coordinate transform. The controller should check this before relying on UX §1 "never change when a zone changes".
- A2. The existing exterior openings mentioned in SPEC aren't in the v1 job record (core.js has no openings field). Nothing in this contract handles them.
- A3. Sizes and limits are my picks and can be changed: 50 mm snap, 12 px snap radius, 100 mm minimum wall and zone, 50 mm minimum run, 50 walls, 30 zones, 100 routes.
- A4. The menu label "Room size" becomes "Floor size", and testids stay the same.

## UNRESOLVED (controller or Saeed decision)

- U1. Downgrade export, meaning "save a copy for the older version". A v2 job with no floor data could convert back to v1 without loss. This is left out to keep scope tight, so after a rollback, work done in v2 isn't available in the old app.
- U2. Freeing space taken by old v1 records is destructive and needs separate approval. Until then, storage use grows by about the size of the copied jobs.
- U3. The release notes need rollback wording before publication: "jobs edited in this version don't appear in older versions".
- U4. I haven't checked physical touch and pen behaviour for two-tap tools or handles. Emulation doesn't count as device evidence.

## Permitted outputs written

Only these three files:
- .scratch/floor-zones/UX-CONTRACT.md
- .scratch/floor-zones/STORAGE-DESIGN.md
- .scratch/floor-zones/01-RESULT.md

I didn't edit any source file. I ran no shell, Git, network or storage commands, and launched no subagents. I made no commit, push or PR.

## HUMANIZER pass

I checked the new user-facing strings in UX §4, §7-§11 and STORAGE §4-§5 against HUMANIZER.md:
- They contain no em or en dashes, no rule-of-three padding and no AI vocabulary.
- Each message says what happened, names the objects involved and gives the next step.
- They use active voice where an actor exists ("Undo brings it back", "Move them first").
- Nothing claims a save or deletion that didn't happen.

"Wall continues" replaces an arrow-only cue so the meaning doesn't rely on a symbol alone. The apostrophe style follows ui.js (’).

HUMANIZER_PASS_COMPLETE

## NEXT

Controller:
1. Verify the anchors and A1.
2. Accept or amend both contracts.
3. Decide U1 to U3.
4. Then raise Grok tickets in this order: versioned model and validators with storage cases 1-12, then floor and zone editing, then containment and print.

Tests: NOT RUN. No test execution is claimed.
