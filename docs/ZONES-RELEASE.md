# Zones release decision

13 October 2026: Saeed instructed "make it live and send me link via telegram".
This authorises release of the currently integrated zones slice, plus delivery
to his existing Telegram home channel. It does not mark the remaining approved
walls, containment and new print work complete. Cursor config approval remains
pending; original workers/worktrees remain preserved.

Release requirements: targeted geometry/storage/browser checks, independent
Opus 5.5 medium design review, GLM 5.3 medium standards/spec review, exact-head
subscription Codex review, green PR CI, then merge and Pages deployment identity
and synthetic live smoke. Office agent hosts tests/reviews. No auth/global
sandbox or provider configuration change is authorised or needed.

Rollback: restore the prior app through a reviewed revert. Preserve browser
records and version-two backups; the old app ignores version-two storage and
cannot read its exports. Retain original version-one records. No destructive
migration is included.
