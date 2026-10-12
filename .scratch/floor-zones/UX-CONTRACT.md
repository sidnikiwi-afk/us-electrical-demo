# EP-FLOOR-01 UX contract: floor, zones, walls, containment, print

Packet EP-FLOOR-01 v1, snapshot 62c59e2, runtime reference 94d6345. Author: Opus 5.5 (claude-opus-5-5), bounded UI judgement. Status: proposed, for controller acceptance. Nothing here is implemented or tested.

## 0. Scope and fixed rules

- Navigation order is floor, then zone, then wall face, then print. The drawing stays the largest thing on screen at every breakpoint.
- Kept as they are: fitting placement, multi-select heights, copy placement, layers, quote bar, rates, notes, sketches, Jobs, backups, CSV, Recover, offline chip.
- Excluded: new openings, angled or polygon geometry, containment drops, bends, boxes, sizes, prices and measured lengths. The preview's three-wall limit, 250 mm grid and fixed 2700 mm height are not requirements.
- Every change below is one `commit()` (ui.js:173) so undo, redo, revision and save behave like fitting edits. A drag is one history entry, as `dragFitting` does now (ui.js:2998).
- Refusals change nothing and leave no undo frame, which `commit()` already guarantees when the mutation throws.

## 1. Coordinates and names (shared with STORAGE-DESIGN.md)

- Plan space is mm, x to the right, y downwards, origin at the inner corner of walls A and D. This is the existing `planPos` convention (ui.js:880).
- Floor = the existing room: width `room.widthM`, depth `room.depthM`, ceiling `room.heightM`. Exterior walls keep IDs A (top), B (right), C (bottom), D (left).
- Interior walls are `W1`, `W2`, ... from a counter that never goes back. Each is horizontal (y1 = y2) or vertical (x1 = x2), stored with x1 <= x2 and y1 <= y2.
- A face is one side of one wall, named by the side the viewer stands on: `N`, `E`, `S` or `W`. Horizontal walls have N and S faces, vertical walls have E and W faces. Exterior walls have only their inner face: A=S, B=W, C=N, D=E.
- Offsets along a face are measured from the viewer's left end of the whole face, exactly as legacy `fromLeftMm`:
  - S face (viewer looks north): `fromLeft = x - x1`. N face: `fromLeft = x2 - x`.
  - W face (viewer looks east): `fromLeft = y - y1`. E face: `fromLeft = y2 - y`.
  - Worked check against ui.js:885-888: A is an S face (x = f), B a W face (y = f), C an N face (x = W - f), D an E face (y = D - f).
- A face view always uses whole-face offsets, even when a zone clips it. Positions and sketches never change when a zone changes.
- Display names: exterior "Wall A" as now. Interior "W5 west side". In a zone, an interior face lying on the zone edge reads as "North wall (W6)".

## 2. Layout and navigation

- `#view-tabs` becomes the view bar, in this order:
  1. Zone menu (`<select>`, testid `zone-select`): "Whole floor" first, then zones in ID order, then "New zone…". Each job opens on "Whole floor".
  2. `Plan (n)` tab, unchanged.
  3. One button per face in the current scope, with fitting counts using the existing `shown/total` rule (ui.js:1173). Ceiling info text unchanged.
  4. Edge notes for a zone scope, such as "East edge: no wall" or "South edge: wall on 1.50 of 3.00 m". They are text, not buttons.
- With "Whole floor" selected, the face buttons are Wall A to D, then interior faces sorted by wall number and then N, E, S, W. A job without interior walls shows exactly today's tabs: Plan, Wall A, Wall B, Wall C, Wall D.
- With a zone selected, the face buttons list the faces that touch that zone (section 4), clipped to it. Exterior and zone-edge faces come first, sorted N, E, S, W, then interior partitions. The plan tints the zone, outlines it, and draws a short coloured mark on each listed face.
- Changing scope keeps the current face if it is still listed. Otherwise it returns to Plan. Selection and layer visibility are kept unless the selected item can't be seen in the new scope.
- Plan tap priority in Select mode is fitting, route, wall, zone. Tapping inside a zone with nothing else under the pointer selects the zone and switches the Zone menu to it. A tap on uncovered floor clears the selection and leaves the scope alone.
- Zone menu "New zone…" switches to Plan and starts the zone tool (section 3).

## 3. New "Build" mode

- New rail button `Build` (key B, testid `mode-build`) placed after Draw. The rail gains one button, and on phones it stays one row at 360 px wide.
- Build shows a one-line toolbar in the place-palette slot (`#place-palette` position, also on phone). Buttons depend on the view:
  - Plan view: `Add wall`, `Add zone`, `Enter sizes…`, `Cancel`.
  - Face view: `Add trunking`, `Add conduit`, `Enter sizes…`, `Cancel`.
- Every tool works with two taps (pointer up). Pen, mouse and touch behave the same. After the first tap a dot marks it and a live preview follows the pointer when hover exists. The hint line shows the live size.
- Escape, `Cancel`, a view change or a mode change drops a pending first tap. Nothing is committed until the second tap.
- Snap rule for all tools: within 12 screen px of a floor edge, a wall centre line or a wall end, snap to it. Otherwise round to 50 mm. Numeric entry is exact to 1 mm.
- `Enter sizes…` opens a small form with the same fields as the inspector for that object. `Add` validates with the same rules.
- After a successful create the tool stays active, so several walls can go in one after another. The new object is selected and the toast reads "Added W7, 3.25 m long. Undo removes it."

## 4. Zones

- Create: `Add zone`, then tap two opposite corners. Default name "Zone n", where n is the stable zone number. The name field gets focus on desktop and tablet only.
- Inspector for a selected zone, top to bottom:
  - Name (required, 1 to 60 characters, unique ignoring case).
  - From west (mm), From north (mm), Width (mm), Depth (mm).
  - Facts: "4 wall faces, 1 edge without a wall, 9 fittings".
  - Buttons: `Apply`, `Show its walls` (sets scope), `Remove zone`.
- Number fields apply only on `Apply` or Enter, never while typing, because overlap needs all four numbers. Name commits with the existing typing-draft rules.
- Changing From west or From north with the same width and depth moves the zone. There is no drag-move, so a pan gesture can't move a zone by mistake.
- In Select mode a selected zone has four edge handles with 44 px hit areas. A handle drags one edge, snapping as in section 3, and validates on release. A refused drag springs back and shows the message.
- Validation, checked in this order, with the exact copy:
  - Size: "A zone must be at least 100 mm wide and deep."
  - Inside: "Keep the zone inside the floor, which is 9.00 × 6.00 m."
  - Overlap: "Zones can't overlap. This one would cover 0.50 × 2.00 m of Cutting floor." Shared edges are allowed.
  - Name: "Another zone is already called Store."
- Zones never create, move or delete walls, and never change fittings, routes, prices or layers. Floor area outside every zone is allowed and drawn untinted.
- `Remove zone` removes immediately. The toast reads "Removed zone Store. Undo brings it back." If it was the current scope, the scope returns to Whole floor.
- Limit of 30 zones: "This floor already has 30 zones, which is the most it can hold."

## 5. Which faces a zone lists

- A face is listed when the part of its wall inside the zone's closed rectangle has positive length (> 0 mm, so a wall that only touches a corner doesn't count) and the face points into the zone:
  - Wall on the zone's north edge: S face only. South edge: N face. West edge: E face. East edge: W face.
  - Wall strictly inside the zone: both faces, each as its own button.
  - Exterior walls: only the inner face, which always points inward.
- The clip is the overlap range expressed as face offsets `[fromMm, toMm]` (section 1 formulas).
- Edge note: for each zone edge, add up the length of listed faces lying on it. 0 gives "North edge: no wall". Partial gives "North edge: wall on 1.50 of 3.00 m". Full coverage gives no note.
- A zone with no listed faces shows Plan only, with the note "This zone has no walls yet. Add one in Build mode."

## 6. Face view

- Title in the caption: "Cutting floor · W5 west side · 2.50 to 6.00 m of 6.00 m". In Whole floor scope the range is left out.
- The wall rectangle covers only the clip. Its height is `room.heightM`. The ruler shows whole-face offsets. A clipped end shows "Wall continues" with an arrow. Legacy views still show their full length.
- Fittings, routes, sketches and note pins outside the clip are not drawn. If any exist the caption adds "2 fittings and 1 route on this face are outside this zone. Choose Whole floor to see them."
- Place mode on a face view works as it does now, inside the clip only. A tap outside the clip: "Place inside the part of the wall that belongs to this zone."
- Place on Plan: snap to the nearest face within the existing threshold, choosing the face on the side of the wall where the tap landed. Exterior walls offer only their inner face. Downlights still go to the ceiling and stay plan only.
- Multi-select heights, copy placement and layers work on interior faces exactly as on A to D.

## 7. Interior walls

- Create: `Add wall`, then tap start and end. The second point locks to horizontal or vertical, whichever moved further. Length readout reads "W7 · 3.25 m".
- Inspector for a selected interior wall:
  - Horizontal: Line y (mm), Start x (mm), End x (mm). Vertical: Line x (mm), Start y, End y.
  - Facts: "3.25 m · 4 fittings · 1 route".
  - Buttons: `Apply`, `Open west side`, `Open east side` (or N/S), `Remove wall`.
- In Select mode a selected wall shows two end handles (44 px). They drag along the wall's axis only and validate on release.
- Exterior walls can be selected but not edited. The inspector says "Exterior wall. Change its length in Menu → Floor size."
- Validation, with copy:
  - Length: "A wall must be at least 100 mm long."
  - Inside: "Keep the wall inside the floor."
  - Boundary: "That line is already an outside wall." (an interior wall lying on x=0, x=W, y=0 or y=D)
  - Duplicate: "That would overlap W5 along the same line." (collinear overlap > 0 with another interior wall)
  - Limit: "This floor already has 50 added walls, which is the most it can hold."
  - Crossings and T-junctions are allowed.
- Attachments of a wall: fittings on either face, routes on either face, sketches and note pins on either face view.
- Ends and lines keep attached items where they are in plan:
  - Moving an end recomputes each attachment's `fromLeftMm`, `startMm` and `endMm` in the same commit, so plan positions don't change.
  - If any attachment would fall outside the new length the edit is refused, and nothing is clamped.
  - Changing the line value (y for a horizontal wall) moves the whole wall with its attachments, and the toast says so: "Moved W5 by 200 mm. Its 3 fittings and 1 route moved with it."
- Remove: refused while attachments exist. Dialog title "W5 can't be removed yet". Body: "It still has 3 fittings (F12, F14, F20), 1 route (T3) and sketches on its east side. Move or delete them first." Buttons: `Show them` (opens the first face that has attachments with them highlighted) and `OK`.
- Shortening refusal uses the same dialog with the body "This would leave F12 and route T3 off the end of the wall. Move them first, or keep the wall longer."
- A wall with no attachments is removed straight away. Toast: "Removed W5. Undo brings it back." Its ID is never reused.

## 8. Floor size (existing Room size form)

- The menu label becomes "Floor size". Testids `room-*` stay.
- Before the existing `itemsOutside`/`askShrink` path (ui.js:1674), check new geometry. If any interior wall, zone or route would end up outside the new floor, refuse and change nothing: "The floor can't be that small yet. W5, W7 and zone Store would be outside it. Move or remove them first."
- Only when that check passes does the existing fitting choice run, and it still covers fittings on A to D and the ceiling only. Fittings on interior walls never clamp.
- Enlarging is allowed. Interior walls stay where they are. If a wall used to touch an outside wall, the toast says "W5 no longer reaches the outside wall."

## 9. Containment (simple runs)

- A run is a straight horizontal segment on one face: type trunking or conduit, start and end offsets (whole-face), a height and optional notes.
- Create in a face view: `Add trunking` or `Add conduit`, then tap the start and end. The height comes from the first tap, snapped to 50 mm.
- Inspector: Type (select), Start (mm), End (mm), Height (mm), Notes, `Apply`, `Remove run`. A selected run shows two end handles that move along the face. Removing a run never needs a refusal.
- Validation: length at least 50 mm ("A run must be at least 50 mm long."). Both ends on the face ("Keep the run on this wall, which is 3.25 m long."). Height within 0 to ceiling ("Height must be 0 to 2700 mm."). In a zone view, both ends must also be inside the clip.
- Labels: trunking T<n>, conduit C<n>, where n is the stable run number. Changing the type keeps the number (R4 becomes C4), so labels on paper never shift. Gaps in the numbering are expected.
- Symbols: trunking is a solid amber band with a T label, conduit a dashed blue line with a C label. On the plan both are drawn just off the face side of the wall. The legend names both, so colour is never the only cue.
- The Layers panel gets a "Containment" group with "Trunking (n)" and "Conduit (n)" checkboxes. These are view state like layers and are never saved.
- Containment has no rates and never appears in the quote, breakdown or CSV. The run inspector and print legend say "Containment isn't priced or measured in this version."

## 10. Phone and tablet reach

- Breakpoints stay as they are (`PHONE` in ui.js:57, style.css:217).
- Phone view bar:
  - Row 1: Zone menu at full width.
  - Row 2: Plan and the face buttons. Up to 5 buttons keeps the existing 5-column grid (style.css:232). More than 5 becomes one horizontally scrolling row with no wrapping, and the active button scrolls into view.
  - Edge notes go under row 2 in 13 px text, at most 2 lines, with the rest behind "More".
- The Build toolbar uses the place-palette slot. The bottom sheet folds while a tool waits for its second tap, then opens folded after a create, showing just its header ("W7 · 3.25 m").
- Handles and toolbar buttons are at least 44 × 44 px. Handles stay outside the inspector and zoom controls. If a handle sits under a panel, Fit runs before the drag starts.
- Landscape phones keep the side sheet rules in style.css:290-299 and 418-427.

## 11. Print

- The Print dialog keeps both layer choices and the note that the breakdown covers the whole job.
- New fieldset "Wall sheets" with checkboxes "Whole floor (every wall, full length)" and one per zone.
  - Default with Whole floor scope: "Whole floor" ticked, which matches today's pack of four walls.
  - Default with a zone scope: that zone only.
  - "No wall sheets" is allowed. The pack is then the overview plus the breakdown.
- Pack order: numbered floor overview with zones and routes, then wall sheets, then the labour breakdown (existing). "Page n of N" footers stay.
- Wall sheets are de-duplicated by physical face (wall ID + face):
  - Each face prints once.
  - Its range is the smallest single range covering every ticked zone's clip of that face. Whole floor means the full face.
  - Zone boundaries inside the printed range show as dashed lines labelled with the zone name.
- Sheet order: A, B, C, D, then interior walls by number, faces N, E, S, W.
- Sheet title: "Cutting floor, Waiting and till · North wall (A)". Subtitle: "Looking north · 0.00 to 6.00 m of 9.00 m · key plan shows this wall in red".
- Each sheet carries a key plan, the legend line and the active layer label.
- Live count beside the boxes: "8 sheets". If de-duplication merged anything, add "2 walls are shared by the ticked zones and print once."
- Printing from the browser menu still prints the whole job: Whole floor, all layers (ui.js:2022).

## 12. Copy rules

- New strings use plain sentences without em or en dashes. Typographic apostrophes follow the surrounding file (ui.js uses ’). Number formats match the existing ones (m with 2 decimals for lengths, mm for positions).
- Messages name the objects concerned (W5, F12, T3, zone name) and the next action. They never say anything was saved, moved or deleted unless it was.

## 13. Acceptance checks (for Grok tests; all NOT RUN)

1. Legacy sample job: view bar shows Plan, Wall A to D, with the same counts as 94d6345. The print pack has the same sheet count.
2. Floor 9000 × 6000, W5 (6000,0)-(6000,6000), zone Z1 (2500,0)-(6000,6000):
   - Faces listed: A (S, clip 2500-6000), W5 W side (0-6000), C (N, clip 3000-6500).
   - Edge note "West edge: no wall".
3. Fitting at plan (6000, 1000) on W5's E face stores `fromLeftMm` 5000. On the W face it stores 1000.
4. Moving W5's start from y=0 to y=500 keeps that E-face fitting at plan y=1000 and stores 5000. On the W face it stores 500.
5. Removing W5 with F12 attached is refused, the job is byte-identical and there's no undo frame. With no attachments the remove works, and undo brings W5 back as W5.
6. A zone overlapping by 1 mm is refused. A zone sharing an edge is accepted.
7. Zones Z1 and Z2 both touching A, both ticked: one sheet for A, range = hull, dashed boundary between them.
8. Run R2 changed from trunking to conduit: label T2 becomes C2 and the quote total is unchanged.
9. Phone 360 × 740 with 9 faces: zone menu, every face button, Build toolbar and handles reachable. The inspector never covers a pending second tap.

## Controller acceptance correction

Accepted within approved scope on 12 October 2026. The current commit catch does not restore a partially mutated job. New operations must validate on a trial copy before changing the job, or restore the pre-mutation snapshot on failure. A refused change must be byte-identical and add no history frame. Add executable regression proof rather than trusting the existing comment. Interior attachment offsets may be recomputed only to preserve the same physical position on endpoint edits; refuse any edit that would invalidate an attachment.
