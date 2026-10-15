# shellcheck shell=bash disable=SC2034,SC2154
pathenv_mark='# snipset-path (managed by snipset installer; safe to remove)'
pathenv_env_text() {
  # shellcheck disable=SC2016 # ${PATH} and $PATH are written literally into the env file
  printf '%s\n' "$pathenv_mark" \
    'case ":${PATH}:" in' \
    "  *\":${install_dir}:\"*) ;;" \
    "  *) export PATH=\"${install_dir}:\$PATH\" ;;" \
    'esac'
}
pathenv_fish_env_text() {
  printf '%s\n' "$pathenv_mark" \
    "if not contains -- \"${install_dir}\" \$PATH" \
    "    set -gx PATH \"${install_dir}\" \$PATH" \
    'end'
}
pathenv_fish_conf_text() {
  printf '%s\n' "$pathenv_mark" "source \"${share_dir}/env.fish\""
}
pathenv_source_line() {
  printf '. "%s/env" %s' "$share_dir" "$pathenv_mark"
}
pathenv_uses() {
  local login_shell="${SHELL:-}"
  [[ "${login_shell##*/}" == "$1" ]] || command -v "$1" >/dev/null 2>&1
}
pathenv_zshenv() {
  printf '%s/.zshenv' "${ZDOTDIR:-$HOME}"
}
pathenv_fish_conf() {
  printf '%s/fish/conf.d/snipset.fish' "${XDG_CONFIG_HOME:-$HOME/.config}"
}
pathenv_collect_bash() {
  pathenv_bash=("${HOME}/.bashrc" "${HOME}/.bash_profile" "${HOME}/.bash_login")
  case "$bashrc" in
    "${HOME}/.bashrc"|"${HOME}/.bash_profile"|"${HOME}/.bash_login"|"${HOME}/.profile") ;;
    *) pathenv_bash+=("$bashrc") ;;
  esac
}
# Exact comparison: $(...) strips trailing newlines, so both sides carry an x sentinel.
pathenv_same() {
  local content
  [[ -f "$1" ]] || return 1
  content="$(cat "$1"; printf x)"
  [[ "$content" == "$2" ]]
}
pathenv_line_add() {
  local line
  line="$(pathenv_source_line)"
  mkdir_recorded "${1%/*}"
  touch_recorded "$1"
  grep -Fqx -- "$line" "$1" || printf '\n%s\n' "$line" >> "$1"
}
# Drops each exact line and the blank line written just before it, rewriting in place to keep symlinks.
# pathenv_line_add always writes a newline before the line, so a non-blank line right before a
# final managed line means FILE had no final newline, and the strip leaves it without one.
# Returns 1 when FILE holds no such line and 2 when FILE could not be rewritten.
pathenv_strip() {
  if ! { [[ -f "$1" ]] && grep -Fqx -- "$2" "$1"; }; then
    return 1
  fi
  rewrite_from "$1" env PATHENV_TARGET="$2" awk '
    $0 == ENVIRON["PATHENV_TARGET"] { if (held && prev != "") { tail = prev; tailed = 1 } held = 0; next }
    { if (tailed) print tail; tailed = 0; if (held) print prev; prev = $0; held = 1 }
    END { if (tailed) printf "%s", tail; else if (held) print prev }
  ' "$1"
}
pathenv_marked() {
  local first=""
  [[ -f "$1" ]] || return 1
  IFS= read -r first 2>/dev/null < "$1" || true
  [[ "$first" == "$pathenv_mark" ]]
}
# Writes FILE from TEXT_FN only when FILE is absent or carries the marker on line 1.
# Returns 0 when FILE holds the managed text, 1 when FILE is the user's, 2 on failure.
pathenv_put() {
  local label="$1" file="$2" fn="$3" hint="$4"
  if [[ ! -e "$file" && ! -L "$file" ]]; then
    if mkdir_recorded "${file%/*}" 2>/dev/null && "$fn" 2>/dev/null > "$file"; then
      return 0
    fi
    report FAIL "$label" "$file could not be written"
    return 2
  fi
  if ! pathenv_marked "$file"; then
    report KEEP "$label" "${file}: not written by the installer; add the line by hand: ${hint}"
    return 1
  fi
  if pathenv_same "$file" "$("$fn"; printf x)" || rewrite_from "$file" "$fn"; then
    return 0
  fi
  rewrite_fail "$label" "$file"
  return 2
}
pathenv_add() {
  local file env_rc=0 fish_rc=0
  ((add_path)) || return 0
  pathenv_put 'path env' "${share_dir}/env" pathenv_env_text "export PATH=\"${install_dir}:\$PATH\"" || env_rc=$?
  pathenv_put 'path env.fish' "${share_dir}/env.fish" pathenv_fish_env_text \
    "set -gx PATH \"${install_dir}\" \$PATH" || fish_rc=$?
  # A source line or fish conf would run a file the installer did not write at every login.
  if ((env_rc == 0)); then
    pathenv_line_add "${HOME}/.profile"
    pathenv_collect_bash
    for file in "${pathenv_bash[@]}"; do
      # shell_block_add creates the --bashrc file right after this, so a rerun would otherwise find it new.
      if [[ -e "$file" ]] || { [[ "$file" == "$bashrc" ]] && ((do_shell && ${has_shell:-0})); }; then
        pathenv_line_add "$file"
      fi
    done
    if pathenv_uses zsh; then
      pathenv_line_add "$(pathenv_zshenv)"
    fi
  fi
  if ((fish_rc == 0)) && pathenv_uses fish; then
    pathenv_put 'path fish' "$(pathenv_fish_conf)" pathenv_fish_conf_text "source \"${share_dir}/env.fish\"" || true
  fi
}
pathenv_check_managed() {
  if [[ ! -e "$2" ]]; then
    report MISSING "$1" "$2"
  elif pathenv_same "$2" "$3"; then
    report OK "$1" "$2"
  else
    report DRIFT "$1" "$2 differs from what the installer writes"
  fi
}
pathenv_check_line() {
  if [[ -f "$1" ]] && grep -Fqx -- "$(pathenv_source_line)" "$1"; then
    report OK 'path line' "$1"
  elif [[ -f "$1" ]] && grep -Fq 'snipset-path' "$1"; then
    report DRIFT 'path line' "$1 has an edited snipset-path line"
  else
    report MISSING 'path line' "$1"
  fi
}
pathenv_check() {
  local file
  if ! ((add_path)); then
    report SKIP path 'not requested (no --add-path)'
    return 0
  fi
  pathenv_check_managed 'path env' "${share_dir}/env" "$(pathenv_env_text; printf x)"
  pathenv_check_managed 'path env.fish' "${share_dir}/env.fish" "$(pathenv_fish_env_text; printf x)"
  pathenv_check_line "${HOME}/.profile"
  pathenv_collect_bash
  for file in "${pathenv_bash[@]}"; do
    if [[ -e "$file" ]]; then
      pathenv_check_line "$file"
    fi
  done
  if pathenv_uses zsh; then
    pathenv_check_line "$(pathenv_zshenv)"
  fi
  if pathenv_uses fish; then
    pathenv_check_managed 'path fish' "$(pathenv_fish_conf)" "$(pathenv_fish_conf_text; printf x)"
  fi
}
pathenv_remove_managed() {
  [[ -e "$2" || -L "$2" ]] || return 1
  if ! pathenv_same "$2" "$3" && ! pathenv_marked "$2"; then
    report KEEP "$1" "$2 not written by the installer; left in place"
  elif ! pathenv_same "$2" "$3"; then
    report KEEP "$1" "$2 edited; remove it by hand"
  elif rm -f -- "$2" 2>/dev/null && [[ ! -e "$2" ]]; then
    [[ "${2%/*}" != "$share_dir" ]] || share_removed=1
    report REMOVED "$1" "$2"
  else
    report FAIL "$1" "$2 could not be removed"
    pathenv_failed=1
  fi
}
pathenv_remove() {
  local file line legacy conf rc found=0 seen=$'\n'
  pathenv_failed=0
  line="$(pathenv_source_line)"
  legacy="export PATH=\"${install_dir}:\$PATH\""
  pathenv_collect_bash
  for file in "${HOME}/.profile" "${pathenv_bash[@]}" "$(pathenv_zshenv)" "${HOME}/.zshenv"; do
    # Without ZDOTDIR ~/.zshenv is listed twice, and a failed rewrite must report once.
    [[ "$seen" != *$'\n'"$file"$'\n'* ]] || continue
    seen+="${file}"$'\n'
    rc=0
    pathenv_strip "$file" "$line" || rc=$?
    case "$rc" in
      0) report REMOVED 'path line' "$file" ;;
      2) rewrite_fail 'path line' "$file"; pathenv_failed=1 ;;
    esac
    ((rc == 1)) || found=1
  done
  # Unmarked, so it may be the user's own line rather than the old installer's.
  if [[ -f "${HOME}/.profile" ]] && grep -Fqx -- "$legacy" "${HOME}/.profile"; then
    report KEEP 'path legacy line' "${HOME}/.profile: remove it by hand if the old installer added it"
    found=1
  fi
  conf="$(pathenv_fish_conf)"
  for file in "$conf" "${HOME}/.config/fish/conf.d/snipset.fish"; do
    if pathenv_remove_managed 'path fish' "$file" "$(pathenv_fish_conf_text; printf x)"; then
      found=1
    fi
    [[ "$conf" != "${HOME}/.config/fish/conf.d/snipset.fish" ]] || break
  done
  # A line or fish file that stayed still sources these, and a missing file aborts a dash login.
  if ((pathenv_failed)); then
    for file in "${share_dir}/env" "${share_dir}/env.fish"; do
      [[ ! -e "$file" ]] || report KEEP "path ${file##*/}" "${file} is still sourced; rerun --uninstall once the failed files are writable"
    done
  else
    pathenv_remove_managed 'path env' "${share_dir}/env" "$(pathenv_env_text; printf x)" && found=1
    pathenv_remove_managed 'path env.fish' "${share_dir}/env.fish" "$(pathenv_fish_env_text; printf x)" && found=1
  fi
  ((found)) || report SKIP path 'nothing to remove'
  share_dir_fallback_rmdir
}
