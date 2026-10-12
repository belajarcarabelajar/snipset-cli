# shellcheck shell=bash disable=SC2034,SC2154
pathenv_add() {
  local profile line
  if ((add_path)); then
    profile="${HOME}/.profile"
    line="export PATH=\"${install_dir}:\$PATH\""
    touch "$profile"
    grep -Fqx "$line" "$profile" || printf '\n%s\n' "$line" >> "$profile"
  fi
}
pathenv_check() {
  report SKIP path 'not checked yet'
}
pathenv_remove() {
  report SKIP path 'not checked yet'
}
