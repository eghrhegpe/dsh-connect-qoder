# Patch history

Archived patches from the 0.1.x development line. Each patch is already
applied to the source tree; these files are retained so a future reader can
trace why a piece of the codebase looks the way it does, without having to
reverse-engineer the diff.

## 0.1.7-settings-rewrite-fix.patch

Applied in **0.2.0**.

The 0.1.7 host settings rewrite removed the `settingsScope` client service
and replaced it with `configForms`. The patch:

- switched the client `inject` list from `["slots", "locale", "settingsScope"]`
  to `["slots", "locale"]`, soft-probing `configForms` inside `apply`
- forked the host-side activation into `configure({auto:true})` (0.1.7) vs
  `installSection` (0.1.6 and earlier)
- registered the three client slot keys

The source at `lib/client.js` and `lib/index.js` already contains this
change; the patch file is kept only as a reference for the 0.1.6 → 0.1.7
migration. Do not re-apply it.

## 0.5.0-abi-cutover.md

Decision record (not a patch) for the 0.5.0 cut of the 0.1.x host ABI:
evidence from the 0.2.0-rc.2 host (which no longer carries
`installSection` / `settingsScope`), what was removed and what stayed, and
the `>=0.2.0-rc.0` floor rationale. Read it before touching the settings
activation path again.
