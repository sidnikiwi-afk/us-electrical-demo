# Surface drawing-to-labour prototype

A browser prototype for an electrician: draw a room plan, tap fittings onto the
walls with a pen, and get an honest running labour total. Plain HTML/CSS/JS ES
modules, with no dependencies, no build step, and no outbound requests. All data stays
in this browser on this device (`localStorage`), plus downloadable JSON/CSV
backups and a print pack.

**Example labour rates only. Not a quotation, electrical design or compliance
tool. Tested with simulated pen and touch. Not yet tried on a real iPad, with
Apple Pencil, on Safari, or on a Surface pen. Palm rejection is unverified.**

## Zones, walls, faces, containment, print

Build mode adds named rectangular zones. Enter the sizes, or resize a zone by
its edge handles. The new zone is selected. Choosing another zone in the menu
keeps the current fitting when that fitting is still on screen.

Build mode also adds straight interior walls. A wall does not appear just
because a zone exists. Each interior wall has two faces. Open a face to see
that side, with dimensions along the floor. When a zone is selected, the face
shows only the stretch that belongs to the zone. A face that sits on a ticked
zone edge is titled with that edge, for example "North wall (W6)". "Wall
continues" marks a face that runs past the zone. The phone details panel folds
away to leave room for the drawing.

Trunking and conduit are drawn on a face. They are not priced. They never
appear in the quote, the labour breakdown, or the CSV. The warning on screen
is exactly: Containment isn't priced or measured in this version.

Menu, then Print. A job with no zones, no interior walls, and no containment
still prints the original four-page pack: plan, walls A and B together, walls
C and D together, and the labour breakdown. Any other job prints a floor
overview, one sheet for each chosen wall face, and the labour breakdown. Tick
the whole floor, or tick the zones you want. Shared zone boundaries print each
zone name on its own side of the line, and a shared wall prints once. A wall
with no fittings says "No fittings on this wall." Print can use every layer,
or only the layers currently shown. The labour page always covers the whole
job. The sheet count in the dialog is the number of wall sheets, and the PDF
page count is meant to match the numbered pages.

Older jobs are offered as copies in separate version-two storage. Their original
records stay untouched. Download a backup before switching versions. Older
apps cannot read version-two exports. Keep both versions' exports.

## Run it

```sh
cd prototype
python3 -m http.server 8817 --bind 127.0.0.1
# open http://127.0.0.1:8817/
```

Opening over `file://` will not work (ES modules and the service worker need HTTP).
The service worker caches the app for offline use after the first online visit.

## Three-minute guided test

1. Start. Pick "Try the sample job" (a made-up barber shop, 12 fittings,
   £310.00 with one unpriced fitting named F12) or "Start a blank job" and enter
   a room size (0.10 to 20 m; height 0.10 to 5 m).
2. Place fittings. Place mode, pick a type, tap near a wall in the plan
   (taps in the open floor are refused with guidance; taps past a wall's end
   clamp to the end). Downlights are placed by tapping the ceiling area in the
   plan view.
3. Check orientation. Open Wall B, C, and D: offsets follow the
   "viewed from inside" oracle (B = plan y, C = W minus x, D = D minus y). Downlights
   appear as labelled projection ticks, never wall-mounted.
4. Select and drag. Click Select in the left rail first, then
   tap a fitting to edit it. In Place mode a tap places a new fitting instead.
   That is intentional. A tap with a small wobble (under about 10 screen px) only
   selects. Dragging carries the fitting from wherever you grabbed it (drags
   clamp to the wall; ceiling downlights are grabbable by their centre), forms
   one Undo step, and survives pointercancel and a two-finger pinch without a
   half-move. Fittings stay grabbable a little beyond their symbol. Fittings on
   hidden layers are never targets. When two sit at the same spot the app asks
   which one you meant instead of guessing. Edit type, wall, position, and notes in
   the inspector, delete, then Undo and Redo. IDs stay stable, and revisions are never
   reused.
5. Rates. Change a rate or leave it blank. The total says the price so far is
   incomplete and names what needs a price.
6. Sketches and notes. Draw and Notes are never priced. Clear sketches
   asks first. Ink is capped at 100 strokes per view, notes at 100 pins.
7. Print and export. Menu, then Print, as described above. Download backup
   (JSON) and CSV (injection-safe quoting). Containment runs are omitted from
   both the quote and the CSV.
8. Offline. Reload with the network off. The job survives. A failed save
   (storage blocked) keeps the job on screen and offers a backup download.

## Checks

Test counts change between builds, so this file doesn't list them. The release
notes for each build say what was checked and what wasn't.
This download contains the runnable app and guide. Development test tools and
internal review records are kept separately. A job with no zones, interior
walls, or containment still fits four A4 sheets: plan, walls A and B, walls C
and D, and labour breakdown. A job that uses those tools prints one numbered
page per overview, wall face, and labour sheet.

## Status

On phones, details start closed to leave room for the drawing. Tap Show details to
edit a fitting, a zone, or the room. On tablets and computers, Hide details retracts the
right panel and expands the drawing. Show breakdown opens a scrolling panel with Close
and Edit rates kept within reach. The fitting picker sits below the drawing.

After pen input, fingers move and zoom by default. Turn Finger drawing on to
draw or place with a finger too. A pen in use, or used within the last second,
still takes priority. Simulated palm lift and cancel checks passed. Real iPadOS
Safari, Apple Pencil, and Surface pen behaviour remain unverified. An update may need a second
refresh before the new layout appears. Saved jobs stay in the same browser.

The Draw tool accepts wider finger contacts when no pen is active, and Clear
sketches keeps the current tool selected. Menu includes a local Drawing check
with the build name (currently "Electrical jobs update 1") and the last input result. It contains no job
content and sends nothing to a server. Browser-injected touch checks supplement
the earlier synthetic-event tests. Actual iPad and Safari confirmation is still needed.

When editing a position or note, press Enter or tap elsewhere before closing
or reloading the page. Text still being edited is not saved until you leave
its field. While you type, the status says the changes are unsaved. It says
saved on this device only after the job is stored.

Complete for prototype review: placement, orientation oracle, drag and clamp,
undo and redo, honest incomplete totals, import validation (hostile and sparse
backups), caps, offline service worker, print pack, portrait layout with the
total and breakdown reachable on phones and tablets. Zones, interior walls,
face views, and containment are in this build, with the limits named above.

Not complete, and known limits: no real iPad, Safari, or Surface hardware testing (simulated pen
and touch only), no multi-room jobs, no cloud sync (by design). Legibility on
physical paper has not been reviewed by a human.

## Jobs on this device

Current build: Electrical jobs update 1. Menu shows it under Drawing check.

The app keeps up to 20 jobs in this browser on this device. Nothing is sent to
a server and nothing syncs, so another browser or device has its own list. Tap
the job name at the top to open Jobs: switch job, rename the open one, start a
new one or download all jobs as one file. Menu also has Jobs.

Prices are example labour rates. A fitting without a rate stays unpriced and
the total says it is incomplete. The app doesn't guess a price for it.

If a room has no ceiling height yet, wall heights can't be set above 0 mm and
Set height for several asks for the room size first. The app doesn't assume a
ceiling height. Enter the room height to place fittings at a real height.

## Rolling back to the older version

Before you roll back, read this: the old version can open only one job. Download all jobs first.

1. Open Jobs and tap Download all jobs. Keep that file. It holds every readable
   job and can be imported back into this version later.
2. Roll back. The older version opens one job only, the one it had before the
   upgrade (or the last one it saved).
3. If you do new work while on the older version, download a backup of that
   job from its Menu before you upgrade again. The older version can't see the
   other jobs, so the all-jobs file is your copy of them.
4. After upgrading again, open Jobs. If the older version changed its job, the
   app offers to add it as a new job. Your other jobs stay as they were.

Older apps cannot read version-two exports. Their original records stay
untouched. Download backups before switching versions.

This is a prototype. It has been tested in desktop browsers with simulated pen
and touch on tablet and phone screen sizes. That isn't the same as testing on
a real iPad, iPhone, Safari, or Surface, which still needs doing.

## Electrical layers

Use **Try layers demo** for a separate made-up workshop covering lighting, sockets and fused spurs, and three-phase points. The original barber-shop sample remains 12 fittings and £310 so far. The two new work types have no default labour price.

**Layers** controls the floor plan, the exterior wall views, and interior face views. Show one group, any combination, or all. Other / unassigned holds existing or unknown fittings until you assign them. Sketches and notes are shared by all layers. Hiding a fitting does not remove it from the job or change its price. The quantities, labour total, and CSV always cover the whole job. Containment runs stay out of those three.

Each fitting can have one layer. Its work type supplies the default. Changing work type resets the layer to that default. A custom layer is saved with the fitting. View filters reset to All when a job opens. Old backups load without editing. Missing new price fields become unpriced. Backups containing the new fitting types cannot be opened in older versions of the app.

Print defaults to all layers. The optional shown-layers print filters only the drawing pages and labels their scope. The labour page always includes the whole job. The browser's own Print command produces the all-layer pack.

## Set height for several

The Select tool has a "Set height for several" mode (button in the Room details and under a wall fitting's height field). Tap fittings on the drawing to add or remove them, on any wall, type one height in millimetres, and press Apply. One Apply is one undo step, and one Undo restores every fitting it changed.

Safety rules: a ceiling fitting's stored value is a plan position, not a height, so ceiling fittings can never be added (a toast says so, and the core function refuses them too). The raw typed value is range-checked (0 to the room's ceiling height) before rounding to the nearest millimetre. There is no silent clamping. Fittings on hidden layers are removed from the list when the layer is hidden, and IDs that no longer exist or have moved to the ceiling are dropped with a toast. Apply re-checks every ID and changes nothing if any is stale. Only `heightMm` changes. IDs, counts, positions along walls, types, layers, rates, and the price breakdown are untouched. Applying a height every selected fitting already has adds no undo step. Cancel, Escape, or switching tools leaves the job unchanged. A tap only toggles when the pointer moved less than 12 px, so panning and pinching never change the selection, and a cancelled touch never toggles. The typed value is kept while you tap more fittings.

If storage fills before older jobs can be copied, Jobs, then Download older jobs,
exports their original-format archive. Their saved records remain untouched.
