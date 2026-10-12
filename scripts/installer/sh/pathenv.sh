# shellcheck shell=bash disable=SC2034,SC2154
if ((add_path)); then
  profile="${HOME}/.profile"
  line="export PATH=\"${install_dir}:\$PATH\""
  touch "$profile"
  grep -Fqx "$line" "$profile" || printf '\n%s\n' "$line" >> "$profile"
fi
