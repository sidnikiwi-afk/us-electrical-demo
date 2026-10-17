# AGENTS.md

## Agent workflow

Use Matt Pocock's skills as the base. Start with `/grill-with-docs` or an
approved spec, implement with `/implement` or `/implement-spec`, diagnose bugs
with `/diagnosing-bugs` (the "diagnose" stage), review with `/code-review`,
and package with `/pr`. Run `/retro` after merge. Use pstack and Addy Osmani
skills only to fill gaps such as launch, performance, or security.

Every PR must include a `Skills used` line linking evidence for each applicable
stage. Explain any stage marked N/A; record `/retro` as pending until merge.
Reviewers and `babysit-pr` must flag missing stages or evidence and keep the PR
unclean until corrected. A pending post-merge retro is not a pre-merge failure.

Workflow changes originate in `/retro` and go through PRs for Saeed's explicit
yes before adoption. This does not grant merge, deploy, or live-action authority.
