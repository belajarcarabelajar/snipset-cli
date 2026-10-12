#!/usr/bin/env bash
# snipset-live: run snipset CLI against a snapshot of the live Desktop database.
# Reads hit the snapshot (no lock contention, no repeated 200MB copies).
# Writes go to the live database, but only after `snipset doctor` proves it
# is reachable; otherwise the write is refused so a locked live file is
# never touched from behind the running app.
set -euo pipefail
# The snapshot is a full copy of the live database and may hold secrets, so
# keep everything this wrapper creates owner-only.
umask 077
refresh=0
live="${SNIPSET_LIVE_DB:-}"
snap_dir="${SNIPSET_LIVE_SNAPSHOT_DIR:-${TMPDIR:-/tmp}/snipset-live-${UID}}"
usage() { printf 'Usage: snipset-live.sh [--refresh] [--live-db PATH] [--snapshot-dir DIR] [--] <snipset args>\n' >&2; exit 2; }
help() { printf 'Usage: snipset-live.sh [--refresh] [--live-db PATH] [--snapshot-dir DIR] [--] <snipset args>\n'; exit 0; }
while (($#)); do
  case "$1" in
    --help|-h) help ;;
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
# Normalize a trailing slash so "$snap_dir/snipset.db" never gains "//".
if [[ "$snap_dir" != "/" ]]; then
  snap_dir="${snap_dir%/}"
fi
[[ -n "$snap_dir" ]] || snap_dir="/"
mkdir -p "$snap_dir"
# Tighten a pre-existing directory too; chmod fails (and aborts) if another
# user owns the path, which is the safe outcome for a shared location.
[[ "$snap_dir" == "/" ]] || chmod 700 "$snap_dir"
snap="$snap_dir/snipset.db"
# Refresh when forced, missing, or older than the live database or its -wal;
# WAL-mode commits land in -wal and leave the main file mtime unchanged.
if ((refresh)) || [[ ! -f "$snap" ]] || [[ "$live" -nt "$snap" ]] || [[ "$live-wal" -nt "$snap" ]]; then
  cp -f "$live" "$snap"
  for ext in -wal -shm; do
    if [[ -f "$live$ext" ]]; then cp -f "$live$ext" "$snap$ext"; else rm -f "$snap$ext"; fi
  done
fi
cmd=""
sub=""
action=""
skip_next=0
for a in "$@"; do
  if ((skip_next)); then skip_next=0; continue; fi
  case "$a" in
    --db) skip_next=1 ;;
    --db=*) ;;
    -*) ;;
    *)
      if [[ -z "$cmd" ]]; then cmd="$a"; elif [[ -z "$sub" ]]; then sub="$a"; elif [[ -z "$action" ]]; then action="$a"; fi
      ;;
  esac
done
# Allowlist only: anything unrecognized falls through to the doctor-gated
# write path, because misrouting a write to the snapshot silently loses it.
is_read=0
case "$cmd $sub" in
  "snippet list"|"snippet get"|"snippet search"|"snippet expand") is_read=1 ;;
  "group list") is_read=1 ;;
  "stats "*) is_read=1 ;;
  "reference list") is_read=1 ;;
  "clipboard list"|"clipboard get"|"clipboard search"|"clipboard export") is_read=1 ;;
  "clipboard tag") if [[ "$action" == "list" ]]; then is_read=1; fi ;;
  "audio history") if [[ "$action" == "list" || "$action" == "get" ]]; then is_read=1; fi ;;
  "audio dictionary"|"audio tts") if [[ "$action" == "list" ]]; then is_read=1; fi ;;
  "audio stats") is_read=1 ;;
esac
# Never forward a user-supplied --db: the wrapper owns the --db target
# (snapshot for reads, live for gated writes) and a duplicate would let
# the trailing flag silently win.
fwd=()
skip_next=0
for a in "$@"; do
  if ((skip_next)); then skip_next=0; continue; fi
  case "$a" in
    --db) skip_next=1; continue ;;
    --db=*) continue ;;
  esac
  fwd+=("$a")
done
if ((is_read)); then
  exec snipset --db "$snap" "${fwd[@]}"
fi
if ! snipset --db "$live" doctor >/dev/null 2>&1; then
  echo 'snipset-live: refusing write: live database is locked or unreachable.' >&2
  echo 'snipset-live: close Snipset Desktop, then retry. Reads remain available from the snapshot.' >&2
  exit 3
fi
exec snipset --db "$live" "${fwd[@]}"
