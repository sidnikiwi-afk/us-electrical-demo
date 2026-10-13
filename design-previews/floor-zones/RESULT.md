# Result: floor, zones and containment design preview

## Files

- `DESIGN.md`: scenario, interaction model, zone, room and layer explanation, request map, proposed choices
- `design/index.html`, `design/style.css`, `design/app.js`: the static preview. No dependencies, no network requests and no browser storage.
- `verify.mjs`: Playwright check at 1280x800, 768x1024 and 390x844
- `evidence/`: written by `verify.mjs` (screenshots, `desktop-print-sheets.pdf`, `verify-result.json`). It is empty until the script runs.

Nothing under `reference/` was edited. The live app was not touched, and there was no Git activity.

## How interactions work

These respond directly to clicks and taps: zone selection (menu or tap on the plan), Whole floor and Wall view, wall buttons, route selection, Show trunking, Show conduit, the type menu for each route, the panel toggle, print zone ticks and Escape.

Assisted (the preview applies constraints): Draw a wall snaps to 250 mm, keeps walls straight, refuses walls shorter than 500 mm or on top of an existing wall, and allows three at most. Add sample wall places a fixed 1.5 m partition on the Waiting and till / Cutting floor edge.

Mock: all job data is invented. Route positions and heights are fixed sample values, and changing a route's type does not move it. Added walls last until reload. The Print button opens the browser's own print dialog. It is not an export.

## Proposed and supported

The preview supports one floor with four zones, wall views per zone, added straight walls, trunking and conduit display and switching, and a print pack.

Proposed only (listed in DESIGN.md): rectangular zones, the rule for which walls belong to a zone, a 2700 mm ceiling, 250 mm snapping, A4 landscape sheets, and route data without sizes or accessories. Zone editing, route editing, saving, quotes and layers are not built.

## Test command

```
node verify.mjs
```

It uses `/home/agent/.nvm/versions/node/v22.23.1/lib/node_modules/playwright/index.mjs` (override with `PLAYWRIGHT_MODULE`). It serves `design/` from a temporary local server and exits 1 if any check fails.

The controller's first run (`verify.log`, copies in `evidence-first-run/`) passed everything except "two taps draw a snapped wall" on tablet and phone. The drawn wall ended at 4750 mm instead of 4500 mm. The cause was a layout shift in the preview, and both the preview and the test are corrected. See `CORRECTION-RESULT.md`. The corrected version has not been run yet.

## Limitations

- Not run in a browser by me. Layout, SVG text sizes on phones and the print output need the controller's run and a look at the screenshots.
- Wall sheets for long walls use small text on phone screens. The printed A4 sheet is the intended reading size.
- The add-wall interaction is a bounded sample. It does not cover angles, openings in new walls or editing a wall once placed.
- Symbols are proposals and have not been checked against any drawing standard the site team uses.
- Real touch and pencil input are untested.

HUMANIZER_PASS_COMPLETE

Next owner: controller
