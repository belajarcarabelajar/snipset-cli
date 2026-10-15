# shellcheck shell=bash disable=SC2034,SC2154
# Runs before the first write, so a read-only HOME gives one clear line instead of a mkdir error.
install_require_writable() {
  local dir="$install_dir"
  while [[ ! -e "$dir" ]]; do
    dir="$(dirname -- "$dir")"
  done
  [[ -d "$dir" && -w "$dir" ]] || die "${dir} is not writable"
}
# Mirrors the files pathenv_add touches; has_shell is unknown before the download, so a
# requested shell block counts as present, which is what every current release ships.
install_dry_path() {
  local file list
  local -a touched=("${HOME}/.profile")
  if ! ((add_path)); then
    printf '[DRY] path: leave %s unchanged (no --add-path)\n' "${HOME}/.profile"
    return 0
  fi
  pathenv_collect_bash
  for file in "${pathenv_bash[@]}"; do
    if [[ -e "$file" ]] || { [[ "$file" == "$bashrc" ]] && ((do_shell)); }; then
      touched+=("$file")
    fi
  done
  if pathenv_uses zsh; then
    touched+=("$(pathenv_zshenv)")
  fi
  list="${touched[0]}"
  for file in "${touched[@]:1}"; do
    list+=", ${file}"
  done
  printf '[DRY] path: write %s/env and %s/env.fish to put %s on PATH\n' "$share_dir" "$share_dir" "$install_dir"
  printf '[DRY] path: source %s/env from %s\n' "$share_dir" "$list"
  if pathenv_uses fish; then
    printf '[DRY] path: write %s\n' "$(pathenv_fish_conf)"
  fi
}
install_dry_run() {
  local id pinned="$version"
  local -a ids
  platform_require
  fetch_tools_require
  fetch_resolve_version
  printf '[DRY] platform: require %s\n' "$target"
  if [[ -n "$from_dir" ]]; then
    printf '[DRY] tools: require tar; sha256sum, shasum, or openssl\n'
  else
    printf '[DRY] tools: require curl or wget; tar; sha256sum, shasum, or openssl\n'
  fi
  if [[ -n "$pinned" ]]; then
    printf '[DRY] version: use %s\n' "$version"
  elif [[ -n "$from_dir" ]]; then
    printf '[DRY] version: read from %s/SHA256SUMS\n' "$from_dir"
  else
    printf '[DRY] version: latest is %s\n' "$version"
  fi
  if [[ -n "$from_dir" ]]; then
    printf '[DRY] release: copy SHA256SUMS and the archive from %s\n' "$from_dir"
  else
    printf '[DRY] release: download SHA256SUMS and the %s archive from %s\n' "$target" "$base_url"
  fi
  printf '[DRY] %s\n' \
    "verify: check the archive checksum and entries" \
    "stage: extract into ${install_dir}/.snipset-stage.*" \
    "smoke: run the staged binary" \
    "binary: place ${install_dir}/snipset"
  install_dry_path
  if ((do_shell)); then
    printf '[DRY] shell bundle: copy into %s\n' "$share_dir"
    printf '[DRY] shell block: add to %s\n' "$bashrc"
  else
    printf '[DRY] shell bundle: skip %s (--no-shell)\n' "$share_dir"
    printf '[DRY] shell block: skip %s (--no-shell)\n' "$bashrc"
  fi
  if ((do_init)); then
    printf '[DRY] database: init %s\n' "${db:-the CLI default}"
  else
    printf '[DRY] database: skip (--no-init)\n'
  fi
  if ((do_shims)); then
    printf '[DRY] shims: generate in %s\n' "$install_dir"
  else
    printf '[DRY] shims: skip (--no-shims)\n'
  fi
  read -r -a ids <<< "$mcp_list"
  if ((${#ids[@]} == 0)); then
    printf '[DRY] mcp: none requested\n'
  fi
  for id in "${ids[@]}"; do
    printf '[DRY] mcp %s: register snipset\n' "$id"
  done
  printf 'dry run: nothing was written\n'
}
do_install() {
  if ((dry_run)); then
    install_dry_run
    return 0
  fi
  platform_require
  fetch_tools_require
  install_require_writable
  fetch_resolve_version
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/snipset-install.XXXXXX")"
  trap 'rm -rf "$tmp" "${stage:-}"' EXIT
  fetch_release "$tmp"
  binary_verify "$tmp"
  binary_stage "$tmp"
  binary_smoke
  binary_place
  pathenv_add
  shell_bundle_place
  shell_block_add
  db_init
  shims_generate
  mcp_install
  printf 'Installed snipset %s to %s\n' "$version" "${install_dir}/snipset"
  ((n_fail == 0)) || exit 1
}
do_check() {
  binary_check
  shell_check
  db_check
  shims_check
  pathenv_check
  mcp_check
  if ((n_drift)); then
    printf 'check: DRIFT (%d items)\n' "$n_drift"
    return 1
  fi
  printf 'check: CURRENT\n'
}
do_update() {
  local have
  if ((dry_run)); then
    do_install
    return 0
  fi
  platform_require
  fetch_tools_require
  fetch_resolve_version
  have="$(binary_installed_version)"
  if [[ -n "$have" && "$have" == "${version#v}" ]]; then
    report OK update "snipset ${have} is current"
    return 0
  fi
  do_install
}
# Prints, one per line, every directory an install with the current flags may create
# (the parent of each file it writes, and their ancestors up to, not including, HOME
# or /), using the same expressions as the mkdir_recorded call sites.
dirs_candidates() {
  local home="${HOME%"${HOME##*[!/]}"}" target path up id file
  local -a ids targets=("$install_dir" "$share_dir" "${bashrc%/*}")
  file="$(pathenv_fish_conf)"
  targets+=("${file%/*}" "${HOME}/.config/fish/conf.d")
  file="$(pathenv_zshenv)"
  targets+=("${file%/*}")
  read -r -a ids <<< "$mcp_list"
  for id in "${ids[@]}"; do
    case "$id" in
      opencode|cursor) targets+=("$(dirname "$(mcp_file "$id")")") ;;
    esac
    # v0.2.0 created this dir even with XDG_CONFIG_HOME set, and mcp_file stops naming
    # it once mcp_remove deletes the file there.
    [[ "$id" != opencode ]] || targets+=("${HOME}/.config/opencode")
  done
  for target in "${targets[@]}"; do
    path="$target"
    while [[ -n "$path" && "$path" != . && "${path%"${path##*[!/]}"}" != "$home" && -n "${path%"${path##*[!/]}"}" ]]; do
      printf '%s\n' "$path"
      up="$(dirname -- "$path")"
      [[ "$up" != "$path" ]] || break
      path="$up"
    done
  done
}
# Runs last: removes, deepest first, each recorded directory that the current flags
# could have created, that is a real directory, and that rmdir finds empty.
dirs_remove() {
  local cands path
  record_take 'dirs record' "${install_dir}/.snipset-dirs" || return 0
  cands=$'\n'"$(dirs_candidates)"$'\n'
  while IFS= read -r path; do
    [[ -n "$path" && "$cands" == *$'\n'"$path"$'\n'* ]] || continue
    # A .. component could name HOME or / under another spelling.
    [[ "/${path}/" != */../* ]] || continue
    [[ -d "$path" && ! -L "$path" ]] || continue
    if rmdir -- "$path" 2>/dev/null; then
      report REMOVED dir "$path"
    fi
  done < <(printf '%s' "$record_text" | awk '{ print length($0) "\t" $0 }' | sort -k1,1nr | cut -f2-)
}
# Prints, one per line, every startup file an install with the current flags may create,
# using the same expressions as the touch_recorded call sites.
files_candidates() {
  pathenv_collect_bash
  printf '%s\n' "$bashrc" "${HOME}/.profile" "${pathenv_bash[@]}" "$(pathenv_zshenv)"
}
# Runs after the shell block and path lines are gone, and before dirs_remove: removes each
# recorded startup file that the current flags could have created, that is a regular file,
# and that now holds only whitespace. Any other byte is the user's, so that file stays.
files_remove() {
  local cands path rc
  record_take 'files record' "${install_dir}/.snipset-files" || return 0
  cands=$'\n'"$(files_candidates)"$'\n'
  while IFS= read -r path; do
    [[ -n "$path" && "$cands" == *$'\n'"$path"$'\n'* ]] || continue
    [[ -f "$path" && ! -L "$path" ]] || continue
    # In the C locale every byte but ASCII whitespace matches, NUL and invalid UTF-8 included.
    rc=0
    LC_ALL=C grep -q -e '[^[:space:]]' -- "$path" 2>/dev/null || rc=$?
    ((rc == 1)) || continue
    if rm -f -- "$path" 2>/dev/null && [[ ! -e "$path" ]]; then
      report REMOVED 'startup file' "$path"
    else
      report FAIL 'startup file' "${path} could not be removed"
    fi
  done <<< "$record_text"
}
do_uninstall() {
  # The remove functions delete for real, so there is nothing safe to preview.
  if ((dry_run)); then
    die "--dry-run cannot preview --uninstall; run --check to see what is installed" 2
  fi
  mcp_remove
  shims_remove
  db_remove
  shell_remove
  pathenv_remove
  binary_remove
  files_remove
  dirs_remove
  printf 'uninstall: removed %d, kept %d\n' "$n_removed" "$n_kept"
  ((n_fail == 0)) || exit 1
}
