# Surface drawing-to-labour prototype

A browser prototype for an electrician: draw a room plan, tap fittings onto the
walls with a pen, and get an honest running labour total. Plain HTML/CSS/JS ES
modules — no dependencies, no build step, no outbound requests. All data stays
in this browser on this device (`localStorage`), plus downloadable JSON/CSV
backups and a print pack.

**Example labour rates only. Not a quotation, electrical design or compliance
tool. Tested with simulated pen and touch — not yet tried on a real iPad or Surface,
and palm rejection is unverified.**

## Run it

```sh
cd prototype
python3 -m http.server 8817 --bind 127.0.0.1
# open http://127.0.0.1:8817/
```

Opening over `file://` will not work (ES modules + service worker need HTTP).
The service worker caches the app for offline use after the first online visit.

## Three-minute guided test

1. **Start** — pick "Try the sample job" (a made-up barber shop, 12 fittings,
   £310.00 with one unpriced fitting named F12) or "Start a blank job" and enter
   a room size (0.10–20 m; height 0.10–5 m).
2. **Place fittings** — Place mode, pick a type, tap near a wall in the plan
   (taps in the open floor are refused with guidance; taps past a wall's end
   clamp to the end). Downlights are placed by tapping the ceiling area in the
   plan view.
3. **Check orientation** — open Wall B/C/D tabs: offsets follow the
   "viewed from inside" oracle (B = plan y, C = W−x, D = D−y); downlights
   appear as labelled projection ticks, never wall-mounted.
4. **Select/Drag** — click the **Select** button in the left rail first, then
   tap a fitting to edit it (in Place mode a tap places a new fitting instead —
   that is intentional). A tap with a small wobble (under ~10 screen px) only
   selects; dragging carries the fitting from wherever you grabbed it (drags
   clamp to the wall; ceiling downlights are grabbable by their centre), forms
   one Undo step, and survives pointercancel and two-finger pinch without a
   half-move. Fittings stay grabbable a little beyond their symbol; fittings on
   hidden layers are never targets; when two sit at the same spot the app asks
   which one you meant instead of guessing. Edit type/wall/position/notes in
   the inspector, delete, then Undo/Redo (IDs are stable, revisions never
   reused).
5. **Rates** — change a rate or leave it blank; the total honestly switches to
   "£X so far — total incomplete" and names what needs a price.
6. **Sketches & notes** — Draw and Notes modes are never priced; Clear sketches
   asks first. Ink is capped at 100 strokes per view, notes at 100 pins.
7. **Print / export** — Menu → Print (4-page pack: plan, walls, breakdown,
   disclaimers), Download backup (JSON) / CSV (injection-safe quoting).
8. **Offline** — reload with the network off; the job survives. A failed save
   (storage blocked) keeps the job on screen and offers a backup download.

## Checks

Test counts change between builds, so this file doesn't list them. The release
notes for each build say what was checked and what wasn't.
This download contains the runnable app and guide; development test tools and
internal review records are kept separately. The print pack fits four A4 sheets:
plan, walls A+B, walls C+D, and labour breakdown.

## Status

On phones, details start closed to leave room for the drawing. Tap Show details to
edit a fitting or the room. On tablets and computers, Hide details retracts the
right panel and expands the drawing. Show breakdown opens a scrolling panel with Close
and Edit rates kept within reach. The fitting picker sits below the drawing.

After pen input, fingers move and zoom by default. Turn Finger drawing on to
draw or place with a finger too. A pen in use, or used within the last second,
still takes priority. Simulated palm lift/cancel checks passed; real iPadOS
Safari and Pencil behaviour remain unverified. An update may need a second
refresh before the new layout appears; saved jobs stay in the same browser.

The Draw tool accepts wider finger contacts when no pen is active, and Clear
sketches keeps the current tool selected. Menu includes a local Drawing check
with the build name (currently "Electrical jobs update 1") and the last input result. It contains no job
content and sends nothing to a server. Browser-injected touch checks supplement
the earlier synthetic-event tests; actual iPad confirmation is still needed.

When editing a position or note, press Enter or tap elsewhere before closing
or reloading the page. Text still being edited is not saved until you leave
its field.

Complete for prototype review: placement, orientation oracle, drag/clamp,
undo/redo, honest incomplete totals, import validation (hostile + sparse
backups), caps, offline service worker, print pack, portrait layout with the
total and breakdown reachable on phones and tablets.

Not complete / known limits: no real iPad or Surface hardware testing (simulated pen
and touch only), no multi-room jobs, no cloud sync (by design); the print pack
fits four A4 sheets (verified via `pdftoppm` renders) but its legibility on
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

Before you roll back, read this: the old version can open only one job; download all jobs first.

1. Open Jobs and tap Download all jobs. Keep that file. It holds every readable
   job and can be imported back into this version later.
2. Roll back. The older version opens one job only, the one it had before the
   upgrade (or the last one it saved).
3. If you do new work while on the older version, download a backup of that
   job from its Menu before you upgrade again. The older version can't see the
   other jobs, so the all-jobs file is your copy of them.
4. After upgrading again, open Jobs. If the older version changed its job, the
   app offers to add it as a new job; your other jobs stay as they were.

This is a prototype. It has been tested in desktop browsers with simulated pen
and touch on tablet and phone screen sizes. That isn't the same as testing on
a real iPad, iPhone or Surface, which still needs doing.

## Electrical layers

Use **Try layers demo** for a separate made-up workshop covering lighting, sockets and fused spurs, and three-phase points. The original barber-shop sample remains 12 fittings and £310 so far. The two new work types have no default labour price.

**Layers** controls the floor plan and all four wall views. Show one group, any combination, or all. Other / unassigned holds existing or unknown fittings until you assign them. Sketches and notes are shared by all layers. Hiding a fitting does not remove it from the job or change its price. The quantities, labour total and CSV always cover the whole job.

Each fitting can have one layer. Its work type supplies the default; changing work type resets the layer to that default. A custom layer is saved with the fitting. View filters reset to All when a job opens. Old backups load without editing; missing new price fields become unpriced. Backups containing the new fitting types cannot be opened in older versions of the app.

Print defaults to all layers. The optional shown-layers print filters only the drawing pages and labels their scope. The labour page always includes the whole job. The browser’s own Print command produces the all-layer pack.

## Set height for several

The Select tool has a “Set height for several” mode (button in the Room details and under a wall fitting's height field). Tap fittings on the drawing to add or remove them — on any wall — type one height in millimetres and press Apply. One Apply is one undo step, and one Undo restores every fitting it changed.

Safety rules: a ceiling fitting's stored value is a plan position, not a height, so ceiling fittings can never be added (a toast says so, and the core function refuses them too). The raw typed value is range-checked (0 to the room's ceiling height) before rounding to the nearest millimetre; there is no silent clamping. Fittings on hidden layers are removed from the list when the layer is hidden, and IDs that no longer exist or have moved to the ceiling are dropped with a toast; Apply re-checks every ID and changes nothing if any is stale. Only `heightMm` changes — IDs, counts, positions along walls, types, layers, rates and the price breakdown are untouched. Applying a height every selected fitting already has adds no undo step. Cancel, Escape or switching tools leaves the job unchanged. A tap only toggles when the pointer moved less than 12 px, so panning and pinching never change the selection, and a cancelled touch never toggles. The typed value is kept while you tap more fittings.
