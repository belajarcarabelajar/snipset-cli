# shellcheck shell=bash disable=SC2034,SC2154
command -v curl >/dev/null || { echo 'install.sh: curl is required' >&2; exit 1; }
command -v tar >/dev/null || { echo 'install.sh: tar is required' >&2; exit 1; }
command -v sha256sum >/dev/null || { echo 'install.sh: sha256sum is required' >&2; exit 1; }
curl_opts=(--retry 3 --connect-timeout 15 --speed-limit 1024 --speed-time 60)
if [[ -z "$version" ]]; then
  version="$(curl -fsSL "${curl_opts[@]}" "https://api.github.com/repos/${repo}/releases/latest" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  [[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || { echo 'install.sh: release version was not found' >&2; exit 1; }
else
  [[ "$version" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || { echo 'install.sh: invalid version' >&2; exit 2; }
  [[ "$version" == v* ]] || version="v${version}"
fi
archive="snipset-cli-${version}-${target}.tar.gz"
release_url="${base_url}/${version}"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/snipset-install.XXXXXX")"
cleanup() { rm -rf "$tmp" "${stage:-}"; }
trap cleanup EXIT
curl -fsSL "${curl_opts[@]}" "${release_url}/SHA256SUMS" -o "${tmp}/SHA256SUMS"
curl -fsSL "${curl_opts[@]}" "${release_url}/${archive}" -o "${tmp}/${archive}"
expected="$(awk -v name="$archive" '{ fname=$2; sub(/^[*]/, "", fname); if (fname == name) { print $1 } }' "${tmp}/SHA256SUMS")"
[[ "$expected" =~ ^[[:xdigit:]]{64}$ ]] || { echo 'install.sh: checksum entry missing' >&2; exit 1; }
actual="$(sha256sum "${tmp}/${archive}" | awk '{print $1}')"
[[ "$actual" == "$expected" ]] || { echo 'install.sh: checksum mismatch' >&2; exit 1; }
