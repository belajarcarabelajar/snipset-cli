# shellcheck shell=bash disable=SC2034,SC2154
shell_marker='# snipset-terminal-integration (managed by snipset installer; safe to remove)'
shell_kept=()
shell_why=""
# Prints the sha256 the share-dir manifest lists for NAME, or nothing.
shell_listed_sum() {
  local manifest="${share_dir}/.snipset-bundle"
  [[ -f "$manifest" ]] || return 0
  awk -v n="$1" 'NF == 2 && $2 == n { print $1; exit }' "$manifest" 2>/dev/null || true
}
# Sets shell_why to "" when NAME in share_dir is the installer's own file, "changed"
# when the manifest lists it under another sha256, and "foreign" otherwise.
shell_ownership() {
  local path="${share_dir}/$1" manifest="${share_dir}/.snipset-bundle" want sum
  shell_why=foreign
  [[ -f "$path" && ! -L "$path" ]] || return 0
  if [[ ! -e "$manifest" && ! -L "$manifest" ]]; then
    # Installs older than the manifest wrote only the default share dir's files.
    if [[ "$share_dir" == "${HOME}/.local/share/snipset" ]]; then
      shell_why=""
    fi
    return 0
  fi
  want="$(shell_listed_sum "$1")"
  [[ -n "$want" ]] || return 0
  sum="$(sha256_of "$path" 2>/dev/null)" || sum=""
  if [[ "$sum" == "$want" ]]; then
    shell_why=""
  else
    shell_why=changed
  fi
}
# Replaces the manifest instead of writing through it, so a symlink there is not followed.
shell_manifest_write() {
  local manifest="${share_dir}/.snipset-bundle" new
  if new="$(mktemp "${manifest}.XXXXXX" 2>/dev/null)" && printf '%s' "$1" > "$new" && mv -f -- "$new" "$manifest"; then
    return 0
  fi
  [[ -z "${new:-}" ]] || rm -f -- "$new"
  report FAIL 'shell manifest' "${manifest} could not be written"
}
shell_bundle_place() {
  local name path want lines=""
  shell_kept=()
  if ((do_shell)) && ((has_shell)); then
    mkdir_recorded "$share_dir"
    for name in snipset.sh completion.bash tab.sh; do
      path="${share_dir}/${name}"
      if [[ -e "$path" || -L "$path" ]]; then
        shell_ownership "$name"
        if [[ -n "$shell_why" ]] && [[ ! -L "$path" && -f "$path" ]] && cmp -s -- "${stage}/shell/${name}" "$path"; then
          shell_why=""
        fi
        if [[ -n "$shell_why" ]]; then
          report KEEP "shell ${name}" "${path} was not written by the installer"
          shell_kept+=("$name")
          # A kept edit stays listed, so the manifest outlives it and the default
          # share dir never falls back to overwriting it.
          want="$(shell_listed_sum "$name")"
          if [[ -n "$want" ]]; then
            lines+="${want}  ${name}"$'\n'
          fi
          continue
        fi
      fi
      cp -f "${stage}/shell/${name}" "$path"
      chmod 755 "$path"
      lines+="$(sha256_of "$path")  ${name}"$'\n'
    done
    shell_manifest_write "$lines"
  elif ((do_shell)); then
    note 'release predates the shell bundle; skipping shell integration'
  fi
  rm -rf "$stage"
}
# The marker and the four lines below it, exactly as shell_block_add writes them.
shell_block_lines() {
  printf '%s\n' "$shell_marker"
  # shellcheck disable=SC2016 # $PATH is written literally into .bashrc
  printf 'if ! command -v snipset >/dev/null 2>&1; then export PATH="%s:$PATH"; fi\n' "$install_dir"
  printf '[ -f "%s/snipset.sh" ] && . "%s/snipset.sh"\n' "$share_dir" "$share_dir"
  printf '[ -f "%s/completion.bash" ] && . "%s/completion.bash"\n' "$share_dir" "$share_dir"
  printf '[ -f "%s/tab.sh" ] && . "%s/tab.sh"\n' "$share_dir" "$share_dir"
}
shell_block_add() {
  if ((do_shell)) && ((has_shell)); then
    # Same rule as pathenv.sh for env: never source at login a file the installer did not write.
    if ((${#shell_kept[@]})); then
      report SKIP 'shell block' "${bashrc} left unchanged; not written by the installer in ${share_dir}: ${shell_kept[*]}"
      return 0
    fi
    touch "$bashrc"
    if ! grep -Fq 'snipset-terminal-integration' "$bashrc"; then
      {
        printf '\n'
        shell_block_lines
      } >> "$bashrc"
    fi
  fi
}
# Reads $bashrc into shell_rc_lines and sets shell_rc_newline (1 when the file
# ends in a newline), shell_block_at (index of the first marker line, -1 when
# absent), and shell_block_exact (1 when the marker and its four lines match).
shell_block_scan() {
  local line i
  local -a want
  shell_rc_lines=()
  shell_rc_newline=1
  shell_block_at=-1
  shell_block_exact=0
  [[ -f "$bashrc" ]] || return 0
  line=""
  while IFS= read -r line; do
    shell_rc_lines+=("$line")
  done < "$bashrc"
  if [[ -n "$line" ]]; then
    shell_rc_lines+=("$line")
    shell_rc_newline=0
  fi
  for i in "${!shell_rc_lines[@]}"; do
    if [[ "${shell_rc_lines[i]}" == *snipset-terminal-integration* ]]; then
      shell_block_at=$i
      break
    fi
  done
  ((shell_block_at >= 0)) || return 0
  mapfile -t want < <(shell_block_lines)
  shell_block_exact=1
  for i in "${!want[@]}"; do
    if [[ "${shell_rc_lines[shell_block_at + i]-}" != "${want[i]}" ]]; then
      shell_block_exact=0
      return 0
    fi
  done
}
shell_check() {
  local name path
  if ! ((do_shell)); then
    report SKIP shell 'not requested (--no-shell)'
    return 0
  fi
  for name in snipset.sh completion.bash tab.sh; do
    path="${share_dir}/${name}"
    if [[ ! -e "$path" && ! -L "$path" ]]; then
      report MISSING "shell ${name}" "$path"
      continue
    fi
    shell_ownership "$name"
    case "$shell_why" in
      '') report OK "shell ${name}" "$path" ;;
      changed) report DRIFT "shell ${name}" "${path}: changed since the installer wrote it" ;;
      *) report DRIFT "shell ${name}" "${path}: not written by the installer" ;;
    esac
  done
  shell_block_scan
  if ((shell_block_at < 0)); then
    report MISSING 'shell block' "$bashrc"
  elif ((shell_block_exact)); then
    report OK 'shell block' "$bashrc"
  else
    report DRIFT 'shell block' "${bashrc} holds the marker with other lines"
  fi
}
shell_manifest_remove() {
  local manifest="${share_dir}/.snipset-bundle" name remaining=0
  [[ -f "$manifest" && ! -L "$manifest" ]] || return 0
  for name in snipset.sh completion.bash tab.sh; do
    if [[ -n "$(shell_listed_sum "$name")" ]] && [[ -e "${share_dir}/${name}" || -L "${share_dir}/${name}" ]]; then
      remaining=1
    fi
  done
  if ((remaining)); then
    report KEEP 'shell manifest' "${manifest}: listed files remain"
  else
    rm -f -- "$manifest"
    share_removed=1
    report REMOVED 'shell manifest' "$manifest"
  fi
}
shell_remove() {
  local name path i start end out=""
  # Without the shell bundle these names may hold the user's own files.
  if ! ((do_shell)); then
    report SKIP shell '--no-shell, nothing to remove'
    return 0
  fi
  for name in snipset.sh completion.bash tab.sh; do
    path="${share_dir}/${name}"
    if [[ -L "$path" ]]; then
      report KEEP "shell ${name}" "${path} symlink left in place"
      continue
    elif [[ ! -e "$path" ]]; then
      report SKIP "shell ${name}" "${path} absent"
      continue
    fi
    shell_ownership "$name"
    case "$shell_why" in
      '')
        rm -f -- "$path"
        share_removed=1
        report REMOVED "shell ${name}" "$path"
        ;;
      changed) report KEEP "shell ${name}" "${path} changed since the installer wrote it; remove it by hand" ;;
      *) report KEEP "shell ${name}" "${path} was not written by the installer" ;;
    esac
  done
  shell_manifest_remove
  shell_block_scan
  if ((shell_block_at < 0)); then
    report SKIP 'shell block' "none in ${bashrc}"
  elif ! ((shell_block_exact)); then
    report KEEP 'shell block' 'edited; remove it by hand'
  else
    start=$shell_block_at
    end=$((shell_block_at + 4))
    if ((start > 0)) && [[ -z "${shell_rc_lines[start - 1]}" ]]; then
      start=$((start - 1))
    fi
    for i in "${!shell_rc_lines[@]}"; do
      ((i >= start && i <= end)) && continue
      out+="${shell_rc_lines[i]}"$'\n'
    done
    if [[ -n "$out" ]] && ! ((shell_rc_newline)) && ((end < ${#shell_rc_lines[@]} - 1)); then
      out="${out%$'\n'}"
    fi
    # Write in place: a symlinked bashrc must stay a symlink into its dotfiles repo.
    if rewrite_from "$bashrc" printf '%s' "$out"; then
      report REMOVED 'shell block' "$bashrc"
    else
      rewrite_fail 'shell block' "$bashrc"
    fi
  fi
  share_dir_fallback_rmdir
}
