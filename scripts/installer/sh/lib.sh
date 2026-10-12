# shellcheck shell=bash disable=SC2034,SC2154
# Install the snipset terminal companion on Linux x64 from public release
# assets, then set it up the way a working station looks: a standalone
# database, shell integration (helpers, completion, TAB expansion, Enter
# trigger), and generated trigger shims. Every setup step is idempotent and
# strictly opt-out; only the binary install itself is mandatory.
set -euo pipefail
n_drift=0
n_kept=0
n_removed=0
note() { printf 'install.sh: %s\n' "$1" >&2; }
die() {
  note "$1"
  exit "${2:-1}"
}
report() {
  printf '[%s] %s: %s\n' "$1" "$2" "$3"
  # Plain assignments: ((n++)) returns 1 when n was 0, which set -e treats as failure.
  case "$1" in
    DRIFT|MISSING) n_drift=$((n_drift + 1)) ;;
    KEEP) n_kept=$((n_kept + 1)) ;;
    REMOVED) n_removed=$((n_removed + 1)) ;;
  esac
}
act() {
  local desc="$1"
  shift
  if ((dry_run)); then
    printf '[DRY] %s\n' "$desc"
    return 0
  fi
  "$@"
}
