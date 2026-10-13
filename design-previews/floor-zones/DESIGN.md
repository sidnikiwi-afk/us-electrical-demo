# Floor, zones and containment: design proposal

Status: proposal for review. The preview is in `design/index.html`. It does not change or link to the live prototype.

## Scenario

Sam is pricing a refit of a small barber shop (invented). The shop is 9 m by 6 m. It has a front room with a waiting bench, a till and three cutting chairs. Behind a wall there is a staff room and a store with the distribution board. Sam draws the floor once, splits it into four zones and checks each wall where sockets and containment go. Then Sam prints a pack for the site team: one overview sheet plus one sheet per wall for the zones being worked on that week.

## Interaction model: floor, then zone, then wall, then print

1. Floor. The whole floor plan opens first and fills the screen. It shows exterior walls (thick), interior walls (thin), doors, windows, fittings, trunking and conduit. Users can add a wall by tapping its start and end points.
2. Zone. The user picks a zone from the Zone menu or taps it on the plan. The selected zone is tinted and outlined. The panel shows what the zone contains.
3. Wall. The wall buttons under the view switch list only the walls of the selected zone. Picking one opens its wall view, and Whole floor goes back to the plan. If a zone side has no wall, the bar says so ("East: zone edge, no wall") so nobody looks for a drawing that cannot exist.
4. Print. Print preview starts with the zone being worked on. The user can tick more zones. The pack is a numbered overview sheet, then one sheet per wall with a title like "Cutting floor · North wall (W1, exterior)" and a small key plan.

The drawing stays the main thing on screen. The details panel opens on the right on desktop and tablet and folds away with Hide panel. On phones it opens as a bottom sheet and starts closed. Drawing a wall closes it so the plan is free to tap.

## Zone, room and electrical layer

A room is a space closed in by walls. A zone is a part of the floor that you choose to work on and print as one set of sheets. It can be a whole room, part of a room or several rooms. In the sample, Waiting and till and Cutting floor share one room with no wall between them. That is why each of those zones has only three wall views until someone adds a wall.

An electrical layer is a filter by kind of work (lighting, sockets and spurs, three-phase), as in the live prototype. Layers hide or show fittings everywhere. Zones choose which part of the floor and which walls you look at. They work independently, and the preview does not include the layer filter.

## Requests mapped to controls

| Request (12 October) | Control or state in the preview |
| --- | --- |
| Draw a full floor plan for one job, with additional walls | Whole floor view; Draw a wall on the plan (two taps, snapped); Add sample wall; Remove added walls; added walls appear in orange as "W7 new" |
| Divide the plan into zones | Zone menu, tap a zone on the plan, tinted zone outlines, zone summary in the panel |
| Produce wall views based on those zones | Wall buttons for the selected zone; Wall view with fittings, heights, openings, routes, wall ends and length; "zone edge, no wall" notes |
| Print usable plans for the site team | Print preview with numbered sheets: overview plus wall sheets for ticked zones, key plan, legend line; Print uses the browser's print dialog |
| Show trunking and conduit routes with clear symbols | Trunking is a solid amber band labelled T1, T2. Conduit is a dashed blue line labelled C1, C2. Drops are circles on the plan and vertical runs on walls. Show trunking and Show conduit checkboxes, a type menu per route, a legend with counts |

## Proposed choices (not confirmed by the requests)

- Zones are rectangles that follow wall centre lines. Drawing or editing zone outlines is not designed yet.
- A wall belongs to a zone when it lies on the zone edge or crosses the zone. A partition inside a zone gives two wall views, one for each side.
- Added walls are straight, interior, 100 mm thick, snapped to 250 mm and limited to three. Real jobs will need angled walls, thickness choices and openings.
- Ceiling height is 2700 mm for every wall.
- Routes sit on one face of a wall at a fixed height. Containment sizes, fixings, bends, boxes and prices are left as "Not set".
- T and C labels are renumbered when a route changes type, so the label always matches the symbol.
- The print pack is A4 landscape, one wall per sheet.
- Ceiling lights appear on the plan only. Ceiling-level containment is not shown.

## Not covered

Saving, export, live quote figures, links to labour rates, layer filtering inside zones, moving fittings, editing routes on the drawing, circuit design and compliance checks. The preview has no save or export buttons, and it does not read or write the live app's stored jobs.
