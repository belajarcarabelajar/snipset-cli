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
  mkdir -p "${1%/*}"
  touch "$1"
  grep -Fqx -- "$line" "$1" || printf '\n%s\n' "$line" >> "$1"
}
# Drops each exact line and the blank line written just before it, rewriting in place to keep symlinks.
pathenv_strip() {
  local tmp_file
  if ! { [[ -f "$1" ]] && grep -Fqx -- "$2" "$1"; }; then
    return 1
  fi
  tmp_file="$(mktemp "${TMPDIR:-/tmp}/snipset-path.XXXXXX")"
  PATHENV_TARGET="$2" awk '
    $0 == ENVIRON["PATHENV_TARGET"] { if (held && prev != "") print prev; held = 0; next }
    { if (held) print prev; prev = $0; held = 1 }
    END { if (held) print prev }
  ' "$1" > "$tmp_file"
  cat "$tmp_file" > "$1"
  rm -f "$tmp_file"
}
pathenv_add() {
  local file conf
  ((add_path)) || return 0
  mkdir -p "$share_dir"
  pathenv_env_text > "${share_dir}/env"
  pathenv_fish_env_text > "${share_dir}/env.fish"
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
  if pathenv_uses fish; then
    conf="$(pathenv_fish_conf)"
    mkdir -p "${conf%/*}"
    pathenv_fish_conf_text > "$conf"
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
  if pathenv_same "$2" "$3"; then
    rm -f "$2"
    report REMOVED "$1" "$2"
  else
    report KEEP "$1" "$2 edited; remove it by hand"
  fi
}
pathenv_remove() {
  local file line legacy conf found=0
  line="$(pathenv_source_line)"
  legacy="export PATH=\"${install_dir}:\$PATH\""
  pathenv_collect_bash
  for file in "${HOME}/.profile" "${pathenv_bash[@]}" "$(pathenv_zshenv)" "${HOME}/.zshenv"; do
    if pathenv_strip "$file" "$line"; then
      report REMOVED 'path line' "$file"
      found=1
    fi
  done
  if pathenv_strip "${HOME}/.profile" "$legacy"; then
    report REMOVED 'path legacy line' "${HOME}/.profile"
    found=1
  fi
  conf="$(pathenv_fish_conf)"
  for file in "$conf" "${HOME}/.config/fish/conf.d/snipset.fish"; do
    if pathenv_remove_managed 'path fish' "$file" "$(pathenv_fish_conf_text; printf x)"; then
      found=1
    fi
    [[ "$conf" != "${HOME}/.config/fish/conf.d/snipset.fish" ]] || break
  done
  pathenv_remove_managed 'path env' "${share_dir}/env" "$(pathenv_env_text; printf x)" && found=1
  pathenv_remove_managed 'path env.fish' "${share_dir}/env.fish" "$(pathenv_fish_env_text; printf x)" && found=1
  ((found)) || report SKIP path 'nothing to remove'
  rmdir "$share_dir" 2>/dev/null || true
}
