#!/usr/bin/env bash
# snipset-live: run snipset CLI against a snapshot of the live Desktop database.
# Reads hit the snapshot (no lock contention, no repeated 200MB copies).
# Writes go to the live database, but only after `snipset doctor` proves it
# is reachable; otherwise the write is refused so a locked live file is
# never touched from behind the running app.
set -euo pipefail
refresh=0
live="${SNIPSET_LIVE_DB:-}"
snap_dir="${SNIPSET_LIVE_SNAPSHOT_DIR:-${TMPDIR:-/tmp}/snipset-live}"
usage() { printf 'Usage: snipset-live.sh [--refresh] [--live-db PATH] [--snapshot-dir DIR] [--] <snipset args>\n' >&2; exit 2; }
while (($#)); do
  case "$1" in
    --refresh) refresh=1; shift ;;
    --live-db) [[ $# -ge 2 ]] || usage; live="$2"; shift 2 ;;
    --snapshot-dir) [[ $# -ge 2 ]] || usage; snap_dir="$2"; shift 2 ;;
    --live-db=*|--snapshot-dir=*) echo 'snipset-live: use a space, not =, for wrapper flags' >&2; exit 2 ;;
    --) shift; break ;;
    -*) break ;;
    *) break ;;
  esac
done
(($#)) || usage
[[ -n "$live" ]] || { echo 'snipset-live: set SNIPSET_LIVE_DB to the live database path' >&2; exit 2; }
[[ -f "$live" ]] || { echo "snipset-live: live database not found: $live" >&2; exit 2; }
mkdir -p "$snap_dir"
snap="$snap_dir/snipset.db"
if ((refresh)) || [[ ! -f "$snap" ]]; then
  cp -f "$live" "$snap"
  for ext in -wal -shm; do
    if [[ -f "$live$ext" ]]; then cp -f "$live$ext" "$snap$ext"; else rm -f "$snap$ext"; fi
  done
fi
cmd=""
sub=""
skip_next=0
for a in "$@"; do
  if ((skip_next)); then skip_next=0; continue; fi
  case "$a" in
    --db) skip_next=1 ;;
    -*) ;;
    *)
      if [[ -z "$cmd" ]]; then cmd="$a"; elif [[ -z "$sub" ]]; then sub="$a"; fi
      ;;
  esac
done
is_read=0
case "$cmd" in
  snippet)
    if [[ "$sub" == "list" || "$sub" == "get" || "$sub" == "search" ]]; then is_read=1; fi
    ;;
  group)
    if [[ "$sub" == "list" ]]; then is_read=1; fi
    ;;
  stats|clipboard|audio|reference)
    is_read=1
    ;;
esac
if ((is_read)); then
  exec snipset --db "$snap" "$@"
fi
if ! snipset --db "$live" doctor >/dev/null 2>&1; then
  echo 'snipset-live: refusing write: live database is locked or unreachable.' >&2
  echo 'snipset-live: close Snipset Desktop, then retry. Reads remain available from the snapshot.' >&2
  exit 3
fi
exec snipset --db "$live" "$@"
