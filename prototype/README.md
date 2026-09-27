# Surface drawing-to-labour prototype

A browser prototype for an electrician: draw a room plan, tap fittings onto the
walls with a pen, and get an honest running labour total. Plain HTML/CSS/JS ES
modules — no dependencies, no build step, no outbound requests. All data stays
in this browser on this device (`localStorage`), plus downloadable JSON/CSV
backups and a print pack.

**Example labour rates only. Not a quotation, electrical design or compliance
tool. Tested with simulated pen and touch — not yet tried on a real Surface,
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
   that is intentional). Drag it (drags clamp to the wall; ceiling downlights
   are grabbable by their centre), edit type/wall/position/notes in the
   inspector, delete, then Undo/Redo (IDs are stable, revisions never reused).
5. **Rates** — change a rate or leave it blank; the total honestly switches to
   "£X so far — total incomplete" and names what needs a price.
6. **Sketches & notes** — Draw and Notes modes are never priced; Clear sketches
   asks first. Ink is capped at 100 strokes per view, notes at 100 pins.
7. **Print / export** — Menu → Print (4-page pack: plan, walls, breakdown,
   disclaimers), Download backup (JSON) / CSV (injection-safe quoting).
8. **Offline** — reload with the network off; the job survives. A failed save
   (storage blocked) keeps the job on screen and offers a backup download.

## Checks

The current version passed 20 data tests and 28 browser journeys.
This download contains the runnable app and guide; development test tools and
internal review records are kept separately. The print pack fits four A4 sheets:
plan, walls A+B, walls C+D, and labour breakdown.

## Status

On phones, details start closed to leave room for the drawing. Tap Details to
edit a fitting or the room. Show breakdown opens a scrolling panel with Close
and Edit rates kept within reach. The fitting picker sits below the drawing.

When editing a position or note, press Enter or tap elsewhere before closing
or reloading the page. Text still being edited is not saved until you leave
its field.

Complete for prototype review: placement, orientation oracle, drag/clamp,
undo/redo, honest incomplete totals, import validation (hostile + sparse
backups), caps, offline service worker, print pack, portrait layout with the
total and breakdown always visible and clickable above the bottom sheet.

Not complete / known limits: no real Surface hardware testing (simulated pen
and touch only), no multi-room jobs, no cloud sync (by design); the print pack
fits four A4 sheets (verified via `pdftoppm` renders) but its legibility on
physical paper has not been reviewed by a human.
