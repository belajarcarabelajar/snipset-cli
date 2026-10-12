---
description: Query Snipset Desktop data via the snapshot wrapper (reads never touch the live DB).
agent: build
---

Use `scripts/snipset-live.sh` for every snippet, group, stats, clipboard, audio, or reference lookup. It keeps a snapshot of the live Desktop database in `$SNIPSET_LIVE_SNAPSHOT_DIR` (default `${TMPDIR:-/tmp}/snipset-live-<uid>`), injects `--db` automatically, and forwards flags like `--json` untouched. Before each command it refreshes the snapshot when `--refresh` is passed, when the snapshot is missing, or when the live database or its `-wal` file is newer than the snapshot. Every refresh copies the whole live database, plus its `-wal` and `-shm` files when they exist, into the snapshot directory.

Rules:
- Reads run against the snapshot. Only these commands are reads: `snippet list/get/search/expand`, `group list`, every `stats` command, `reference list`, `clipboard list/get/search/export`, `clipboard tag list`, `audio history list/get`, `audio dictionary list`, `audio tts list`, and `audio stats`. Every other command, including the clipboard and audio commands that change data, is a write and goes through the doctor check below. Pass `--refresh` for a fresh copy first.
- Writes (`snippet add/update/delete`, anything else) run against the live database ONLY after `snipset doctor` proves it reachable. If the wrapper refuses with exit 3, the Desktop app is running or the file is locked: report that, do not copy files by hand, do not write to the live path, and ask the user to close Snipset Desktop before retrying.
- Never set `SNIPSET_LIVE_DB` to a guess. If it is unset, stop and ask for the live database path instead of probing the filesystem.
- Clean up only snapshots you created in the snapshot directory (`$SNIPSET_LIVE_SNAPSHOT_DIR`, default `${TMPDIR:-/tmp}/snipset-live-<uid>`). Never touch the real `~/.profile`.
