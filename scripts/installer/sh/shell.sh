# shellcheck shell=bash disable=SC2034,SC2154
snipset_bin="${install_dir}/snipset"
if ((do_shell)) && ((has_shell)); then
  mkdir -p "$share_dir"
  for name in snipset.sh completion.bash tab.sh; do
    cp -f "${stage}/shell/${name}" "${share_dir}/${name}"
    chmod 755 "${share_dir}/${name}"
  done
  touch "$bashrc"
  if ! grep -Fq 'snipset-terminal-integration' "$bashrc"; then
    {
      printf '\n# snipset-terminal-integration (managed by snipset installer; safe to remove)\n'
      # shellcheck disable=SC2016 # $PATH is written literally into .bashrc
      printf 'if ! command -v snipset >/dev/null 2>&1; then export PATH="%s:$PATH"; fi\n' "$install_dir"
      printf '[ -f "%s/snipset.sh" ] && . "%s/snipset.sh"\n' "$share_dir" "$share_dir"
      printf '[ -f "%s/completion.bash" ] && . "%s/completion.bash"\n' "$share_dir" "$share_dir"
      printf '[ -f "%s/tab.sh" ] && . "%s/tab.sh"\n' "$share_dir" "$share_dir"
    } >> "$bashrc"
  fi
elif ((do_shell)); then
  echo 'install.sh: release predates the shell bundle; skipping shell integration' >&2
fi
rm -rf "$stage"
