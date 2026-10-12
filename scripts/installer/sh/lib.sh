# shellcheck shell=bash disable=SC2034,SC2154
# Install the snipset terminal companion on Linux x64 from public release
# assets, then set it up the way a working station looks: a standalone
# database, shell integration (helpers, completion, TAB expansion, Enter
# trigger), and generated trigger shims. Every setup step is idempotent and
# strictly opt-out; only the binary install itself is mandatory.
set -euo pipefail
if ((BASH_VERSINFO[0] < 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] < 4))); then
  # mapfile and empty arrays under set -u need 4.4; note and die are not defined yet.
  printf 'install.sh: bash 4.4 or newer is required; this is bash %s\n' "${BASH_VERSION}" >&2
  exit 1
fi
n_drift=0
n_kept=0
n_removed=0
n_fail=0
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
    FAIL) n_fail=$((n_fail + 1)) ;;
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
rewrite_backup=""
rewrite_restored=1
# Replaces FILE's content with NEWFILE's in place, so FILE and a symlink to it stay
# where they are. Returns 2 on any failure; rewrite_backup then names the kept copy
# of the old content and rewrite_restored says whether FILE still matches it.
rewrite_file() {
  local file="$1" new="$2" bak="${1}.snipset-bak.$$"
  rewrite_backup=""
  rewrite_restored=1
  if ! cp -- "$file" "$bak" 2>/dev/null || ! cmp -s -- "$file" "$bak"; then
    rm -f -- "$bak" "$new"
    return 2
  fi
  if cat -- "$new" 2>/dev/null > "$file" && cmp -s -- "$new" "$file"; then
    rm -f -- "$bak" "$new"
    return 0
  fi
  cat -- "$bak" 2>/dev/null > "$file" || true
  cmp -s -- "$bak" "$file" || rewrite_restored=0
  rewrite_backup="$bak"
  rm -f -- "$new"
  return 2
}
# Stages CMD's output beside FILE, never in TMPDIR, which may be missing or full,
# then hands it to rewrite_file. Returns 2 before FILE is touched when staging fails.
rewrite_from() {
  local file="$1" new
  shift
  rewrite_backup=""
  rewrite_restored=1
  new="$(mktemp "${file}.snipset-new.XXXXXX" 2>/dev/null)" || return 2
  if ! "$@" > "$new"; then
    rm -f -- "$new"
    return 2
  fi
  rewrite_file "$file" "$new"
}
rewrite_fail() {
  if [[ -z "$rewrite_backup" ]]; then
    report FAIL "$1" "$2 left unchanged"
  elif ((rewrite_restored)); then
    report FAIL "$1" "$2 left unchanged (backup: ${rewrite_backup})"
  else
    report FAIL "$1" "$2 could not be restored (backup: ${rewrite_backup})"
  fi
}
