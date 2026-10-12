# shellcheck shell=bash disable=SC2034,SC2154
while IFS= read -r entry; do
  [[ "$entry" != *$'\n'* ]] || { echo 'install.sh: unsafe archive entry' >&2; exit 1; }
  [[ "$entry" != -* && "$entry" != .-* && "$entry" != /* && "$entry" != ../* && "$entry" != */../* ]] || { echo 'install.sh: unsafe archive entry' >&2; exit 1; }
done < <(tar --quoting-style=escape -tzf "${tmp}/${archive}")
if tar -tvzf "${tmp}/${archive}" | awk '$1 ~ /^l/ { found=1 } END { exit found ? 0 : 1 }'; then
  echo 'install.sh: symlinks are not allowed in release archives' >&2; exit 1
fi
mkdir -p "$install_dir"
stage="$(mktemp -d "${install_dir}/.snipset-stage.XXXXXX")"
tar -xzf "${tmp}/${archive}" -C "$stage"
[[ -f "${stage}/snipset" && -x "${stage}/snipset" ]] || { echo 'install.sh: archive has no executable snipset' >&2; rm -rf "$stage"; exit 1; }
chmod 755 "${stage}/snipset"
mv -f "${stage}/snipset" "${install_dir}/snipset"
# The shell bundle (shell/snipset.sh, shell/completion.bash, shell/tab.sh,
# shell/snipset-shims.sh) ships with newer releases. Older archives carry the
# binary only; setup steps below degrade to a binary-only install.
has_shell=0
if [[ -f "${stage}/shell/snipset.sh" && -f "${stage}/shell/completion.bash" && -f "${stage}/shell/tab.sh" && -f "${stage}/shell/snipset-shims.sh" ]]; then
  has_shell=1
  chmod 755 "${stage}/shell/snipset-shims.sh"
  mv -f "${stage}/shell/snipset-shims.sh" "${install_dir}/snipset-shims"
fi
