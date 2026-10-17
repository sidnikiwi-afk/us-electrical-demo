# Floor and zones implementation plan

Status: APPROVED by Saeed on 12 October 2026, reply "I approve." Approval authorises the bounded local build, testing and PR preparation described below, including the recorded model plan. Publication remains a separate release decision.

## Intended result

A user creates a floor in a named job, draws additional walls, creates and names zones, switches between the whole floor and relevant wall views, places fittings and simple trunking/conduit routes, saves/reopens the job and prints an overview plus selected wall sheets. The approved visual preview is the reference, not reusable proof that these behaviours work with real jobs.

## Proposed first-release boundaries

- One rectangular floor per job. Existing room dimensions define the floor for an older job.
- Straight horizontal/vertical interior walls with stable identifiers; add, select, adjust and remove with undo/redo. Preserve existing exterior-wall openings. Further opening behaviour must be specified before the corresponding ticket starts.
- User-created rectangular, named zones with editable bounds inside the floor. Positive-size, non-overlapping zones; uncovered floor is allowed. Zones do not create walls. Show a clear message when a zone edge has no wall.
- Derive zone wall views from actual walls, including the relevant face and extent. Fitting positions use stable wall references, never a zone index. Specify how wall changes affect fittings/routes; do not silently delete or move attached items.
- Simple wall-associated trunking/conduit runs: create, select, adjust, change type and remove. Display distinguishing symbols and legend in floor/wall/print views. No containment pricing, accessory quantities, circuit calculation or compliance claims.
- Preserve current fitting, layer, quote, job-management and backup features. Existing labour totals remain based on supported fitting quantities; containment cannot quietly contribute a made-up price.
- Save/reopen, single-job backup and all-jobs archive include new data. Print a numbered overview and selected wall sheets with readable titles and key plans.
- Angled/curved or arbitrary-polygon floors/zones, multiple storeys, ceiling containment, CAD import, cloud sync and collaborative editing are excluded.

These are proposed product choices, especially rectangular zones and simple containment editing. Saeed may change them before approval. The sample's three-wall limit, 250 mm grid and 2700 mm height are not automatically requirements.

## Architecture and data protection

Keep the existing plain HTML/CSS/JavaScript frontend, browser-local storage, existing GitHub repository and prototype deployment layout. No backend, database, paid service or new runtime dependency is planned. Use existing browser verification tooling; if dependency or provider changes prove necessary, bring the material expansion back before proceeding.

First freeze the current release and take synthetic legacy fixtures. Define versioned floor/wall/zone/route records, stable identifiers, validation and bounds before UI wiring. Retain existing saved records and test upgrade on copies. Do not overwrite old data with a format the old app misreads; specify backward behaviour and recovery before migration work. Preserve existing Web Locks, corruption recovery and transactional save safeguards. Downloaded legacy backups must remain importable. Storage failure must offer a usable backup rather than claim a successful save.

Existing jobs are read as a floor with their four exterior walls and retained fittings, dimensions, prices and notes. Exact conversion and rollback strategy is a blocking technical ticket with executable evidence. Any destructive migration or live customer-data operation requires separate approval.

## Workers and sequence

Use IMPLEMENTATION-MODEL-PLAN.md. Controller, implementer, UI guidance and reviewer routing follow `docs/IMPLEMENTATION-MODEL-PLAN.md` (Model routing section), which replaces the role table that was here. PR review: Sol, or Grok 4.7 medium when Sol is unavailable (record which ran). The release gate is stricter: `docs/ZONES-RELEASE.md` still requires exact-head subscription Codex review before release.

Before every worker launch: resolve exact model/harness/auth, verify Office unprivileged agent admission, resource and allowance gates, and attach a visibly named Herdr worker in the electrician workspace. No silent model/host substitution or paid API fallback. Workers receive sanitised source pointers and explicit isolated write scopes; controller owns integration and tracking.

Create a spec and dependency-linked local tickets, preserving the preview as design evidence. Work in this order:
1. Baseline, executable checks and data/geometry contract.
2. Opus guidance for creating/editing zones, walls and routes, plus destructive-edit messages.
3. Versioned model, validation, legacy compatibility and round-trip saves/archives.
4. Floor/wall/zone editing and fitting integration.
5. Containment editing and print sheets.
6. Regression, upgrade/offline, visual and independent review; fix findings.
7. PR packaging and exact-head subscription Codex (Sol) review, as `docs/ZONES-RELEASE.md` requires for release (the Grok 4.7 medium fallback covers ordinary PR review only).

Serialize shared app edits; parallelise only admitted, genuinely independent evidence/review tasks. Use fresh compact packets and harvest durable results before closing temporary workers. Start with a small end-to-end saved floor/zone slice before widening the build.

## Verification and acceptance

Controller runs focused tests for each slice, then relevant existing regression groups plus new geometry/storage/export/print/offline coverage on Office. Verify wall orientation, stable references, attached-item edits, layer visibility, undo/redo, legacy-job conversion, corrupted/full/unavailable storage, backup import/export and rollback limitations. Browser journeys cover desktop/tablet/phone; inspect screenshots and print PDF. Reproduce the previously fixed caption reflow scenario. Record physical touch/pen/Safari gaps honestly and prepare synthetic HTTPS device checks before release acceptance.

Make repo checks runnable with documented paths and add a scoped CI workflow if existing GitHub settings permit it without secret/provider changes. CI must execute useful checks; deploying a static site is not a substitute for testing. Controller verifies live repository merge/deploy settings before any push that could publish. No CI/provider setting change bypasses existing review or protection gates.

## PR and release

Use a feature/integration branch and draft PR. Stage only named app, test, workflow and documentation files; exclude .private, raw messages, credentials and unrelated archives. Regenerate public guides/download bundles from the reviewed source when affected. PR includes before/after evidence, limitations and rollback impact using the pr skill template.

Require green applicable CI, independent findings resolved, Opus design-match evidence and durable exact-head subscription Codex (Sol) review, as `docs/ZONES-RELEASE.md` requires for release (the Grok 4.7 medium fallback covers ordinary PR review only). Recheck the head before acceptance. Publication of this feature is not authorised by this proposed build plan. Agents open and update PRs. No agent merges, deploys, enables auto-merge, uses admin bypass or pushes to the default branch. Only Saeed merges, or he says "merge N" directly to the agent for one PR. "merge N" covers that one merge; a deploy, including a merge that publishes to Pages, needs Saeed to name it. No first-time auto-deploy enablement is included.

After authorised release, verify deployment identity matches the merge SHA, public asset/build identity, real app journeys, offline cache update and save/reopen/export using synthetic jobs. Preserve browser records during rollback. A green PR or worker result is not production verification.

## Approval record

Approved 12 October 2026 in this controller session, reply "I approve." First-release boundaries, model plan, bounded implementation/testing and PR preparation are authorised together. No production publication, paid API, provider/billing changes, raw private-data egress or destructive action is included.
