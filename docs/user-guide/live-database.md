# Live database

Snipset Desktop keeps your real data in a running SQLite database. Reading that
file directly while the app has it open can fight the app for the file, so the
repository ships a wrapper, `scripts/snipset-live.sh`, that reads from a
snapshot instead and only touches the live file for gated writes.

Written against `snipset 0.2.0`. The [repository README](../../README.md) owns
the canonical wrapper reference; this page explains the workflow.

## The model: read from a snapshot, write to the live file

- **Reads** (`snippet list/get/search/expand`, `group list`, `stats`,
  `clipboard`, `audio`, `reference`) run against a snapshot copy of the live
  database, so they never fight the running app for the file.
- **Writes** (`snippet add/update/delete`, and anything that is not a read)
  target the live database directly, but only after `snipset doctor` proves it
  is reachable. If the wrapper refuses a write, close Snipset Desktop and retry.

The snapshot lives in `$SNIPSET_LIVE_SNAPSHOT_DIR` (default
`/tmp/snipset-live`).

## Point the wrapper at your database

Tell the wrapper where the live database is, then run any `snipset` command
through it:

```sh
export SNIPSET_LIVE_DB="$LOCALAPPDATA/Snipset/snipset.db"
bash scripts/snipset-live.sh --json snippet search "query"
bash scripts/snipset-live.sh --refresh snippet get <uuid>
```

`snippet expand` is a read and never touches the live file.

## Wrapper options

```
Usage: snipset-live.sh [--refresh] [--live-db PATH] [--snapshot-dir DIR] [--] <snipset args>
```

| Option | Effect |
| --- | --- |
| `--refresh` | Force a fresh snapshot copy before running. |
| `--live-db PATH` | Live database path, instead of `SNIPSET_LIVE_DB`. |
| `--snapshot-dir DIR` | Snapshot directory, instead of `SNIPSET_LIVE_SNAPSHOT_DIR`. |
| `--` | End wrapper flags, so later args that look like flags pass through to `snipset`. |

The snapshot is refreshed when it is missing, when `--refresh` is passed, or
when the live database is newer than the snapshot (a stale copy).

## Two rules about `--db`

The wrapper owns the `--db` flag: it points `snipset` at the snapshot for reads
and at the live file for gated writes. So:

- The wrapper drops any user-supplied `--db` or `--db=...` value; you cannot
  override its database choice.
- Wrapper flags require a space. The `--flag=value` form is rejected; write
  `--live-db PATH`, not `--live-db=PATH`.

## Bridge-dependent commands still need the app

The snapshot workflow only solves file contention for database reads. Commands
that talk to the running Desktop application over its bridge (see the
[command reference](commands.md)) still need the app open regardless of the
wrapper.

## Where to go next

- Browse every command in the [command reference](commands.md).
- Learn the snippet workflow in [Snippets](snippets.md).
