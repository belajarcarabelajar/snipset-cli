# shellcheck shell=bash disable=SC2034,SC2154
binary_verify() {
  local dir="$1" expected actual entry
  expected="$(awk -v name="$archive" '{ fname=$2; sub(/^[*]/, "", fname); if (fname == name) { print $1 } }' "${dir}/SHA256SUMS")"
  [[ "$expected" =~ ^[[:xdigit:]]{64}$ ]] || die 'checksum entry missing'
  actual="$(sha256_of "${dir}/${archive}")"
  [[ "$actual" == "$expected" ]] || die 'checksum mismatch'
  while IFS= read -r entry; do
    [[ "$entry" != *$'\n'* ]] || die 'unsafe archive entry'
    [[ "$entry" != -* && "$entry" != .-* && "$entry" != /* && "$entry" != ../* && "$entry" != */../* ]] || die 'unsafe archive entry'
  done < <(tar --quoting-style=escape -tzf "${dir}/${archive}")
  if tar -tvzf "${dir}/${archive}" | awk '$1 ~ /^l/ { found=1 } END { exit found ? 0 : 1 }'; then
    die 'symlinks are not allowed in release archives'
  fi
}
binary_stage() {
  mkdir -p "$install_dir"
  stage="$(mktemp -d "${install_dir}/.snipset-stage.XXXXXX")"
  tar -xzf "${1}/${archive}" -C "$stage"
  [[ -f "${stage}/snipset" && -x "${stage}/snipset" ]] || { note 'archive has no executable snipset'; rm -rf "$stage"; exit 1; }
  chmod 755 "${stage}/snipset"
}
binary_smoke() {
  return 0
}
binary_place() {
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
}
binary_installed_version() {
  :
}
binary_check() {
  report SKIP binary 'not checked yet'
}
binary_remove() {
  report SKIP binary 'not checked yet'
}
