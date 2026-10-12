# Correction result: two-tap wall on tablet and phone

## Failure

In the first run, `[tablet] two taps draw a snapped wall` and `[phone] two taps draw a snapped wall` failed. The expected wall was `[7000,3000,7000,4500]` and the actual wall was `[7000,3000,7000,4750]`. Desktop passed. Every other check passed on all three sizes (`verify.log`, `evidence-first-run/verify-result.json`).

## Root cause: product layout shift (not pixel rounding)

The hint line above the plan changes text when the first tap lands. Before that tap it reads "Drawing a wall: tap where it starts. Press Esc or Stop drawing to cancel." (73 characters). After it, the hint reads "Start at 7000, 3000 mm. Now tap where the wall ends." (52 characters). The caption had no fixed height. On the narrow canvas (about 438 px on tablet with the panel open, 390 px on phone) the first message wraps to two lines and the second fits on one. So the caption lost one line, about 19 px, and the SVG under it grew by the same amount. The plan is width-limited and centred vertically (`xMidYMid meet`), so the drawing moved up by about half that, roughly 10 px.

The test computed both tap positions before the first tap. The second tap therefore landed about 10 px lower on the drawing than intended. At 23.7 mm/px (tablet) and 26.7 mm/px (phone), that is about 235 to 265 mm. y = 4500 + about 250 rounds to the 4750 grid line. The first tap was correct (3000) because it happened before the shift, and x was unaffected. On desktop both messages fit on one line, so nothing moved and the check passed. The tablet screenshot `evidence-first-run/tablet-4-floor-with-added-walls.png` shows the title and hint stacked on separate lines in that canvas width.

This was not touch pixel rounding. Rounding moves a tap by at most half a pixel, about 13 mm. The target 4500 lies on the 250 mm grid, and the nearest snap boundaries (4375 and 4625) are about 5 px away. The fixture coordinates were unambiguous, so I didn't change them.

The product mapping (screen to plan through `getScreenCTM`, then the snap) was correct. The fault was the drawing moving under the user between the two taps of one action. A real user would see the start marker jump about 10 px, which is a UX defect in its own right.

## Changes

- `design/style.css`: the caption above the drawing now has a fixed height. The title takes one line, with an ellipsis if it is too long. The hint always takes exactly two lines (`height: 2.7em`, clamped to 2 lines). Status messages can no longer change the drawing's size or position. The longest current message fits in two lines at the phone width. The full text stays in the DOM, so the `role="status"` announcement is unchanged.
- `verify.mjs`:
  - The second tap position is now computed after the first tap, from the plan as it is on screen at that moment.
  - A new check, `plan does not move between the two taps`, compares the SVG screen transform before and after the first tap. Without the CSS fix it would fail, so the bug cannot hide behind the fresher fixture.
  - The endpoint assertion is unchanged and still exact: `[7000,3000,7000,4500]`.
- `RESULT.md`: the test section now records the first run, the fault and this correction.

I didn't change `app.js`, `index.html`, `evidence-first-run/` or `design-first-run/`, and I didn't loosen any assertions.

## Evidence

- First run, read only: `verify.log`, `evidence-first-run/verify-result.json`, `evidence-first-run/tablet-4-floor-with-added-walls.png`.
- New evidence: none yet. `evidence/` still holds the first run's output until the controller reruns `node verify.mjs`, which overwrites it. I haven't run the corrected script or preview, so no pass is claimed.

Expected on rerun: the new `plan does not move between the two taps` check passes on all three sizes, and the wall is `[7000,3000,7000,4500]` on all three sizes.

Next owner: controller
