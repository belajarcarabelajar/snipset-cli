# shellcheck shell=bash disable=SC2034,SC2154
fetch_tools_require() {
  command -v curl >/dev/null || die 'curl is required'
  command -v tar >/dev/null || die 'tar is required'
  command -v sha256sum >/dev/null || die 'sha256sum is required'
}
fetch_get() {
  local curl_opts=(--retry 3 --connect-timeout 15 --speed-limit 1024 --speed-time 60)
  curl -fsSL "${curl_opts[@]}" "$1" -o "$2"
}
fetch_text() {
  local curl_opts=(--retry 3 --connect-timeout 15 --speed-limit 1024 --speed-time 60)
  curl -fsSL "${curl_opts[@]}" "$1"
}
sha256_of() {
  sha256sum "$1" | awk '{print $1}'
}
fetch_resolve_version() {
  if [[ -z "$version" ]]; then
    version="$(fetch_text "https://api.github.com/repos/${repo}/releases/latest" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
    [[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || die 'release version was not found'
  else
    [[ "$version" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || die 'invalid version' 2
    [[ "$version" == v* ]] || version="v${version}"
  fi
  archive="snipset-cli-${version}-${target}.tar.gz"
  release_url="${base_url}/${version}"
}
fetch_release() {
  fetch_get "${release_url}/SHA256SUMS" "${1}/SHA256SUMS"
  fetch_get "${release_url}/${archive}" "${1}/${archive}"
}
