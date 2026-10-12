# shellcheck shell=bash disable=SC2034,SC2154
shell_marker='# snipset-terminal-integration (managed by snipset installer; safe to remove)'
shell_bundle_place() {
  local name
  if ((do_shell)) && ((has_shell)); then
    mkdir -p "$share_dir"
    for name in snipset.sh completion.bash tab.sh; do
      cp -f "${stage}/shell/${name}" "${share_dir}/${name}"
      chmod 755 "${share_dir}/${name}"
    done
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
  local name
  if ! ((do_shell)); then
    report SKIP shell 'not requested (--no-shell)'
    return 0
  fi
  for name in snipset.sh completion.bash tab.sh; do
    if [[ -f "${share_dir}/${name}" ]]; then
      report OK "shell ${name}" "${share_dir}/${name}"
    else
      report MISSING "shell ${name}" "${share_dir}/${name}"
    fi
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
shell_remove() {
  local name i start end out=""
  for name in snipset.sh completion.bash tab.sh; do
    if [[ -f "${share_dir}/${name}" || -L "${share_dir}/${name}" ]]; then
      rm -f "${share_dir}/${name}"
      report REMOVED "shell ${name}" "${share_dir}/${name}"
    else
      report SKIP "shell ${name}" "${share_dir}/${name} absent"
    fi
  done
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
    printf '%s' "$out" > "$bashrc"
    report REMOVED 'shell block' "$bashrc"
  fi
  rmdir "$share_dir" 2>/dev/null || true
}
