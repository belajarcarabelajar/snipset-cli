---
description: Query Snipset Desktop data via the snapshot wrapper (reads never touch the live DB).
agent: build
---

Use `scripts/snipset-live.sh` for every snippet, group, stats, clipboard, audio, or reference lookup. It snapshots the live Desktop database once per session into `$SNIPSET_LIVE_SNAPSHOT_DIR` (default `/tmp/snipset-live`), injects `--db` automatically, and forwards flags like `--json` untouched.

Rules:
- Reads (`snippet list/get/search`, `group list`, `stats`, `clipboard`, `audio`, `reference`) run against the snapshot. Pass `--refresh` for a fresh copy first.
- Writes (`snippet add/update/delete`, anything else) run against the live database ONLY after `snipset doctor` proves it reachable. If the wrapper refuses with exit 3, the Desktop app is running or the file is locked: report that, do not copy files by hand, do not write to the live path, and ask the user to close Snipset Desktop before retrying.
- Never set `SNIPSET_LIVE_DB` to a guess. If it is unset, stop and ask for the live database path instead of probing the filesystem.
- Clean up only snapshots you created in `/tmp`. Never touch the real `~/.profile`.
