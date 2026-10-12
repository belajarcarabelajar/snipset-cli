# shellcheck shell=bash disable=SC2034,SC2154
fetch_tools_require() {
  command -v tar >/dev/null || die 'tar is required'
  if [[ -z "$from_dir" ]] && ! command -v curl >/dev/null && ! command -v wget >/dev/null; then
    die 'curl or wget is required'
  fi
  command -v sha256sum >/dev/null || command -v shasum >/dev/null || command -v openssl >/dev/null ||
    die 'sha256sum, shasum, or openssl is required'
}
fetch_get() {
  local curl_opts=(--retry 3 --connect-timeout 15 --speed-limit 1024 --speed-time 60)
  if command -v curl >/dev/null; then
    curl -fsSL "${curl_opts[@]}" "$1" -o "$2"
  else
    wget --tries=3 --timeout=15 -q -O "$2" "$1"
  fi
}
fetch_text() {
  local curl_opts=(--retry 3 --connect-timeout 15 --speed-limit 1024 --speed-time 60)
  if command -v curl >/dev/null; then
    curl -fsSL "${curl_opts[@]}" "$1"
  else
    wget --tries=3 --timeout=15 -qO- "$1"
  fi
}
sha256_of() {
  if command -v sha256sum >/dev/null; then
    sha256sum "$1"
  elif command -v shasum >/dev/null; then
    shasum -a 256 "$1"
  else
    openssl dgst -sha256 -r "$1"
  fi | awk '{print $1}'
}
fetch_from_version() {
  local sums="${from_dir}/SHA256SUMS" name
  local -a names=()
  [[ -f "$sums" ]] || die "${sums} is missing"
  while IFS= read -r name; do
    if [[ "$name" == snipset-cli-v*-"${target}.tar.gz" ]]; then
      names+=("$name")
    fi
  done < <(awk '{ fname=$2; sub(/^[*]/, "", fname); print fname }' "$sums" | sort -u)
  ((${#names[@]} == 1)) ||
    die "expected one snipset-cli-v<VERSION>-${target}.tar.gz in ${sums}, found ${#names[@]}; pass --version"
  version="${names[0]#snipset-cli-}"
  version="${version%-"${target}".tar.gz}"
  [[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || die "invalid version in ${sums}"
}
fetch_resolve_version() {
  if [[ -z "$version" && -n "$from_dir" ]]; then
    fetch_from_version
  elif [[ -z "$version" ]]; then
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
  local name
  if [[ -n "$from_dir" ]]; then
    for name in SHA256SUMS "$archive"; do
      [[ -f "${from_dir}/${name}" ]] || die "${from_dir}/${name} is missing"
      cp "${from_dir}/${name}" "${1}/${name}"
    done
    return 0
  fi
  fetch_get "${release_url}/SHA256SUMS" "${1}/SHA256SUMS"
  fetch_get "${release_url}/${archive}" "${1}/${archive}"
}
