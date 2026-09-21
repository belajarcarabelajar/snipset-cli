#!/usr/bin/env bash
set -euo pipefail
repo="belajarcarabelajar/snipset-cli"
version=""
install_dir="${HOME}/.local/bin"
add_path=0
base_url="${SNIPSET_RELEASE_BASE_URL:-https://github.com/${repo}/releases/download}"
usage() { printf 'Usage: install.sh [--version VERSION] [--install-dir DIR] [--add-path]\n' >&2; exit 2; }
while (($#)); do
  case "$1" in
    --version) [[ $# -ge 2 ]] || usage; version="$2"; shift 2 ;;
    --install-dir) [[ $# -ge 2 ]] || usage; install_dir="$2"; shift 2 ;;
    --add-path) add_path=1; shift ;;
    *) usage ;;
  esac
done
[[ -z "$version" || "$version" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || { echo 'install.sh: invalid version' >&2; exit 2; }
[[ "$version" == v* ]] || version="v${version}"
command -v curl >/dev/null || { echo 'install.sh: curl is required' >&2; exit 1; }
command -v tar >/dev/null || { echo 'install.sh: tar is required' >&2; exit 1; }
command -v sha256sum >/dev/null || { echo 'install.sh: sha256sum is required' >&2; exit 1; }
if [[ -z "$version" ]]; then
  version="$(curl -fsSL "https://api.github.com/repos/${repo}/releases/latest" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
fi
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || { echo 'install.sh: release version was not found' >&2; exit 1; }
target="x86_64-unknown-linux-gnu"
archive="snipset-cli-${version}-${target}.tar.gz"
release_url="${base_url}/${version}"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/snipset-install.XXXXXX")"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT
curl -fsSL "${release_url}/SHA256SUMS" -o "${tmp}/SHA256SUMS"
curl -fsSL "${release_url}/${archive}" -o "${tmp}/${archive}"
expected="$(awk -v name="$archive" '$2 == name { print $1 }' "${tmp}/SHA256SUMS")"
[[ "$expected" =~ ^[[:xdigit:]]{64}$ ]] || { echo 'install.sh: checksum entry missing' >&2; exit 1; }
actual="$(sha256sum "${tmp}/${archive}" | awk '{print $1}')"
[[ "$actual" == "$expected" ]] || { echo 'install.sh: checksum mismatch' >&2; exit 1; }
while IFS= read -r entry; do
  [[ "$entry" != /* && "$entry" != ../* && "$entry" != */../* ]] || { echo 'install.sh: unsafe archive entry' >&2; exit 1; }
done < <(tar -tzf "${tmp}/${archive}")
if tar -tvzf "${tmp}/${archive}" | awk '$1 ~ /^l/ { found=1 } END { exit found ? 0 : 1 }'; then
  echo 'install.sh: symlinks are not allowed in release archives' >&2; exit 1
fi
mkdir -p "$install_dir"
stage="$(mktemp -d "${install_dir}/.snipset-stage.XXXXXX")"
tar -xzf "${tmp}/${archive}" -C "$stage"
[[ -f "${stage}/snipset" && -x "${stage}/snipset" ]] || { echo 'install.sh: archive has no executable snipset' >&2; rm -rf "$stage"; exit 1; }
chmod 755 "${stage}/snipset"
mv -f "${stage}/snipset" "${install_dir}/snipset"
rm -rf "$stage"
if ((add_path)); then
  profile="${HOME}/.profile"
  line="export PATH=\"${install_dir}:\$PATH\""
  touch "$profile"
  grep -Fqx "$line" "$profile" || printf '\n%s\n' "$line" >> "$profile"
fi
printf 'Installed snipset %s to %s\n' "$version" "${install_dir}/snipset"
