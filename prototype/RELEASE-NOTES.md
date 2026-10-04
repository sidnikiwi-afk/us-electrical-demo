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
