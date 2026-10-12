# shellcheck shell=bash disable=SC2034,SC2154
binary_verify() {
  local dir="$1" expected actual entry names verbose
  expected="$(awk -v name="$archive" '{ fname=$2; sub(/^[*]/, "", fname); if (fname == name) { print $1 } }' "${dir}/SHA256SUMS")"
  [[ "$expected" =~ ^[[:xdigit:]]{64}$ ]] || die 'checksum entry missing'
  actual="$(sha256_of "${dir}/${archive}")"
  [[ "$actual" == "$expected" ]] || die 'checksum mismatch'
  # Captured, not streamed: a tar that fails to list must stop the install, not read as an empty archive.
  names="$(tar --quoting-style=escape -tzf "${dir}/${archive}")" || die 'cannot list the archive'
  verbose="$(tar --quoting-style=escape -tvzf "${dir}/${archive}")" || die 'cannot list the archive'
  while IFS= read -r entry; do
    [[ "$entry" != *$'\n'* ]] || die 'unsafe archive entry'
    [[ "$entry" != -* && "$entry" != .-* && "$entry" != ./-* && "$entry" != /* ]] || die 'unsafe archive entry'
    [[ "$entry" != .. && "$entry" != ../* && "$entry" != */.. && "$entry" != */../* ]] || die 'unsafe archive entry'
  done <<< "$names"
  [[ $'\n'"$verbose" != *$'\n'l* ]] || die 'symlinks are not allowed in release archives'
  [[ $'\n'"$verbose" != *$'\n'h* ]] || die 'hard links are not allowed in release archives'
}
binary_stage() {
  mkdir -p "$install_dir"
  stage="$(mktemp -d "${install_dir}/.snipset-stage.XXXXXX")"
  # As root, tar would otherwise keep the packer's uid and mode bits.
  tar --no-same-owner --no-same-permissions -xzf "${1}/${archive}" -C "$stage"
  [[ -f "${stage}/snipset" && -x "${stage}/snipset" ]] || { note 'archive has no executable snipset'; rm -rf "$stage"; exit 1; }
  chmod 755 "${stage}/snipset"
}
binary_run_version() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 30 "$1" --version
  else
    "$1" --version
  fi
}
binary_smoke() {
  local out line rc=0
  out="$(binary_run_version "${stage}/snipset" 2>&1)" || rc=$?
  if ((rc == 0)) && [[ "$out" == "snipset "* ]]; then
    return 0
  fi
  note "the downloaded snipset failed to run (exit ${rc}):"
  while IFS= read -r line; do
    note "  ${line}"
  done <<< "$out"
  if command -v ldd >/dev/null 2>&1; then
    while IFS= read -r line; do
      [[ "$line" != *'not found'* ]] || note "  ldd: ${line#"${line%%[![:space:]]*}"}"
    done < <(ldd "${stage}/snipset" 2>&1 || true)
  fi
  die "install aborted before replacing ${install_dir}/snipset"
}
# mv -f would overwrite a file the user owns (or a link's target slot), and
# uninstall would later delete it as ours.
binary_refuse_foreign() {
  local target="$1" check="$2"
  [[ -e "$target" || -L "$target" ]] || return 0
  [[ ! -L "$target" && -f "$target" ]] && "$check" "$target" && return 0
  die "${target} exists and is not a snipset install; move it aside or pass --install-dir"
}
binary_place() {
  # The shell bundle (shell/snipset.sh, shell/completion.bash, shell/tab.sh,
  # shell/snipset-shims.sh) ships with newer releases. Older archives carry the
  # binary only; setup steps below degrade to a binary-only install.
  has_shell=0
  if [[ -f "${stage}/shell/snipset.sh" && -f "${stage}/shell/completion.bash" && -f "${stage}/shell/tab.sh" && -f "${stage}/shell/snipset-shims.sh" ]]; then
    has_shell=1
  fi
  # Both targets are checked before either move, so a refusal leaves no half-placed install.
  binary_refuse_foreign "${install_dir}/snipset" binary_is_snipset
  ((has_shell == 0)) || binary_refuse_foreign "${install_dir}/snipset-shims" binary_is_generator
  mv -f "${stage}/snipset" "${install_dir}/snipset"
  if ((has_shell)); then
    chmod 755 "${stage}/shell/snipset-shims.sh"
    mv -f "${stage}/shell/snipset-shims.sh" "${install_dir}/snipset-shims"
  fi
}
binary_installed_version() {
  local out v
  [[ -x "${install_dir}/snipset" ]] || return 0
  out="$(binary_run_version "${install_dir}/snipset" 2>/dev/null)" || return 0
  [[ "$out" == "snipset "* ]] || return 0
  read -r _ v _ <<< "$out"
  printf '%s\n' "${v#v}"
}
binary_is_snipset() {
  local out
  out="$(binary_run_version "$1" 2>/dev/null)" || return 1
  [[ "$out" == "snipset "* ]]
}
binary_is_generator() {
  local line2=""
  { IFS= read -r _ && IFS= read -r line2; } 2>/dev/null < "$1" || true
  [[ "$line2" == '# snipset-shims:'* ]]
}
binary_check() {
  local bin="${install_dir}/snipset" gen="${install_dir}/snipset-shims" have
  if [[ ! -e "$bin" ]]; then
    report MISSING binary "$bin"
  elif [[ ! -f "$bin" || ! -x "$bin" ]]; then
    report DRIFT binary "${bin} is not executable"
  else
    have="$(binary_installed_version)"
    if [[ -z "$have" ]]; then
      report DRIFT binary "${bin} --version failed"
    elif [[ -n "$version" && "$have" != "${version#v}" ]]; then
      report DRIFT binary "${bin} is ${have}, pinned ${version#v}"
    else
      report OK binary "${bin} ${have}"
    fi
  fi
  if [[ -f "$gen" ]] && binary_is_generator "$gen"; then
    report OK snipset-shims "$gen"
  elif [[ ! -e "$gen" && ( -e "${install_dir}/.snipset-shims" || -d "$share_dir" ) ]]; then
    report MISSING snipset-shims "$gen"
  elif [[ -e "$gen" ]]; then
    report SKIP snipset-shims "${gen} is not the snipset generator"
  else
    report SKIP snipset-shims 'not installed'
  fi
}
binary_remove() {
  local bin="${install_dir}/snipset" gen="${install_dir}/snipset-shims"
  # A link may point into a package manager or a checkout that owns the real file.
  if [[ -L "$bin" ]]; then
    report KEEP binary "${bin} symlink left in place"
  elif [[ ! -e "$bin" ]]; then
    report SKIP binary "${bin} not present"
  elif [[ -f "$bin" && -x "$bin" ]] && binary_is_snipset "$bin"; then
    rm -f "$bin"
    report REMOVED binary "$bin"
  else
    report KEEP binary "${bin} does not report a snipset version"
  fi
  if [[ -L "$gen" ]]; then
    report KEEP snipset-shims "${gen} symlink left in place"
  elif [[ ! -e "$gen" ]]; then
    report SKIP snipset-shims "${gen} not present"
  elif [[ -f "$gen" ]] && binary_is_generator "$gen"; then
    rm -f "$gen"
    report REMOVED snipset-shims "$gen"
  else
    report KEEP snipset-shims "${gen} has no snipset-shims header"
  fi
}
