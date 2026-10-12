# shellcheck shell=bash disable=SC2034,SC2154
platform_require() {
  local os cpu glibc major minor
  os="$(uname -s 2>/dev/null || true)"
  case "$os" in
    Linux) ;;
    Darwin) die 'no macOS build is published yet; see "Known limits" in README.md' ;;
    *) die "unsupported OS ${os:-unknown}" ;;
  esac
  cpu="$(uname -m 2>/dev/null || true)"
  case "$cpu" in
    x86_64|amd64) ;;
    aarch64|arm64) die 'no ARM build is published yet; see "Known limits" in README.md' ;;
    *) die "unsupported CPU ${cpu:-unknown}" ;;
  esac
  # musl ldd prints its banner to stderr and exits 1.
  if command -v ldd >/dev/null 2>&1 && [[ "$(ldd --version 2>&1 || true)" == *musl* ]]; then
    die 'musl libc (for example Alpine) is not supported; the build needs glibc 2.34 or newer'
  fi
  glibc="$(platform_glibc_version)"
  if [[ -z "$glibc" ]]; then
    note 'could not determine the glibc version; the build needs glibc 2.34 or newer, continuing'
  else
    major="${glibc%%.*}"
    minor="${glibc#*.}"
    if ((10#$major < 2 || (10#$major == 2 && 10#$minor < 34))); then
      die "glibc ${glibc} is too old; the build needs glibc 2.34 or newer"
    fi
  fi
  target="x86_64-unknown-linux-gnu"
}
# Prints MAJOR.MINOR, or nothing when neither getconf nor ldd reports a version.
platform_glibc_version() {
  local raw=""
  if command -v getconf >/dev/null 2>&1; then
    raw="$(getconf GNU_LIBC_VERSION 2>/dev/null || true)"
    raw="${raw##* }"
  fi
  if [[ ! "$raw" =~ ^[0-9]+\.[0-9]+ ]] && command -v ldd >/dev/null 2>&1; then
    raw="$(ldd --version 2>/dev/null | head -n 1 || true)"
    raw="${raw##* }"
  fi
  if [[ "$raw" =~ ^([0-9]+)\.([0-9]+) ]]; then
    printf '%s.%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
  fi
}
