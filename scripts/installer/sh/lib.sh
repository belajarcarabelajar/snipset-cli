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
dirs_record_present() {
  [[ -e "${install_dir}/.snipset-dirs" || -L "${install_dir}/.snipset-dirs" ]]
}
# Adds each PATH not yet listed to the record REC (LABEL names it in reports). The old lines
# are kept, and the new record replaces the file with mv -T, so a symlink there (even one to a
# directory) is not followed and a real directory makes mv fail.
record_add() {
  local label="$1" rec="$2" old="" text path new=""
  shift 2
  if [[ -f "$rec" && ! -L "$rec" ]]; then
    # Without the x, an unreadable record would read as empty and lose its lines.
    old="$(cat -- "$rec" 2>/dev/null && printf x)" || old=""
    if [[ "$old" != *x ]]; then
      report FAIL "$label" "${rec} could not be read"
      return 0
    fi
    old="${old%x}"
  fi
  text="$old"
  [[ -z "$text" || "$text" == *$'\n' ]] || text+=$'\n'
  for path in "$@"; do
    # The record is one path per line.
    [[ "$path" != *$'\n'* ]] || continue
    [[ $'\n'"$text" != *$'\n'"$path"$'\n'* ]] || continue
    text+="${path}"$'\n'
  done
  # An empty dirs record still marks an install made by this installer.
  [[ "$text" != "$old" || -L "$rec" || ! -e "$rec" ]] || return 0
  if new="$(mktemp "${rec}.XXXXXX" 2>/dev/null)" && printf '%s' "$text" > "$new" && mv -fT -- "$new" "$rec"; then
    return 0
  fi
  [[ -z "$new" ]] || rm -f -- "$new"
  report FAIL "$label" "${rec} could not be written"
}
dirs_record_add() {
  record_add 'dirs record' "${install_dir}/.snipset-dirs" "$@"
}
# Reads the record REC into record_text, then deletes it. Returns 1, deleting nothing, when
# there is no record, when it is a symlink (left in place), or when it could not be read.
record_take() {
  local label="$1" rec="$2"
  record_text=""
  if [[ -L "$rec" ]]; then
    report KEEP "$label" "${rec} symlink left in place"
    return 1
  fi
  [[ -f "$rec" ]] || return 1
  record_text="$(cat -- "$rec" 2>/dev/null && printf x)" || record_text=""
  if [[ "$record_text" != *x ]]; then
    report FAIL "$label" "${rec} could not be read"
    return 1
  fi
  record_text="${record_text%x}"
  rm -f -- "$rec"
}
# touch FILE, then records it in .snipset-files when this call created it, so --uninstall
# can remove it once the installer's lines are gone. A symlink there is the user's, even dangling.
touch_recorded() {
  if [[ -e "$1" || -L "$1" ]]; then
    touch -- "$1"
    return
  fi
  touch -- "$1" || return 1
  record_add 'files record' "${install_dir}/.snipset-files" "$1"
}
# mkdir -p DIR, then records each directory it created, so --uninstall can remove
# exactly those (when empty) and never one the user already had.
mkdir_recorded() {
  local probe="$1" up
  local -a made=()
  while [[ ! -e "$probe" && ! -L "$probe" ]]; do
    made+=("$probe")
    up="$(dirname -- "$probe")"
    [[ "$up" != "$probe" ]] || break
    probe="$up"
  done
  mkdir -p -- "$1" || return 1
  ((${#made[@]} == 0)) || dirs_record_add "${made[@]}"
}
share_removed=0
# Without a record (an older install, or a second uninstall) the share dir goes only
# when this uninstall deleted an installer file from it, so a user's own dir stays.
share_dir_fallback_rmdir() {
  dirs_record_present || ((share_removed == 0)) || rmdir "$share_dir" 2>/dev/null || true
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
