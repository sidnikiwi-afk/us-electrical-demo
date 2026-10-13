# Floor final, 13 October 2026

Build `surface-proto-v17-floor-final-20261013` adds interior walls, face views, containment runs, and the zoned print pack, on top of named zones.

- Build adds straight interior walls. Each wall has two faces. A face view shows that side, with dimensions. When a zone is selected, the face is clipped to the part that belongs to the zone. A face on a zone edge is titled like "North wall (W6)".
- Trunking and conduit can be drawn on a face. They are not priced and do not appear in the quote, the labour breakdown, or the CSV. The warning reads: Containment isn't priced or measured in this version.
- Print offers the whole floor or ticked zones, and all layers or the layers currently shown. The pack is a floor overview, one sheet per chosen wall face, and the labour breakdown. A job with no zones, interior walls, or containment still prints the original four-page pack. A wall sheet with no fittings says "No fittings on this wall." A shared boundary prints each zone name on its own side.
- Creating a zone selects that zone. Changing the zone menu keeps a fitting selected when that fitting is still in view.
- Version-two storage is unchanged. Older records stay untouched, and older apps cannot read version-two exports. Download backups before switching versions.
- Real iPad, Apple Pencil, Surface pen, and Safari remain untested. Prices are still examples. This prototype makes no electrical compliance claims.

---

# Zones release, 13 October 2026

Build `surface-proto-v13-floor-zones-20261012` adds named rectangular zones,
edge resize handles and zone-filtered exterior wall views. Desktop, tablet and
phone browser journeys cover create, edit, undo, save and reopen. Version-two
storage preserves older records and checks recovery writes before reporting
success. A mixed offline build opens read-only.

Interior walls, containment and new print layouts are unfinished and excluded.
Real iPad/Pencil, Safari and Surface pen testing remains outstanding. Prices
remain examples; this prototype makes no electrical compliance claims.

The existing PDF quick guide covers the original fitting tools. The README
explains zones and the storage/rollback limits. Download backups before changing
versions; the older app cannot read version-two exports.

---

# Release notes

## Electrical jobs update 1

This build keeps up to 20 jobs in the browser on this device, in place of the
single job the older version kept. Jobs aren't sent anywhere and don't sync
between browsers or devices.

- Tap the job name at the top to open Jobs. From there you can switch job,
  rename the open job, start a new one or download all jobs as one file. Menu
  still has Jobs too.
- The first time it runs, this build copies the older version's job into the
  list. It reads the older record and never changes it.
- If a page closes before a change is saved, the change is kept and offered
  under Recover. Opening it adds a job only when its content isn't already
  saved.
- When the device doesn't confirm a save, the status says the save isn't
  confirmed and offers a backup. It doesn't blame a full device or another
  tab.
- An import record that can't be read can be dismissed from Recover after you
  confirm. Download it first if you might need it.
- Offline files are fetched fresh when the app updates, so an old copy held by
  the browser can't mix with new files.

### Rolling back

Before rolling back, remember that the old version can open only one job; download all jobs first. Keep that
file. If you do work in the older version, download a backup of that job before
you update again. After the update, Jobs offers to add it as a new job.

### Known limits

- Prices are example labour rates. A fitting with no rate stays unpriced and
  the total says it is incomplete.
- With no ceiling height entered, wall heights stay at 0 mm until you enter the
  room height. The app doesn't guess one.
- Checks ran in desktop browsers with simulated pen and touch at tablet and
  phone sizes. Real iPad, iPhone and Surface testing hasn't happened yet.

If storage fills before older jobs can be copied, Jobs → Download older jobs
exports their original-format archive. Their saved records remain untouched.
