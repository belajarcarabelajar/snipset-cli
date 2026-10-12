# shellcheck shell=bash disable=SC2034,SC2154
do_install() {
  local id
  local -a ids
  if ((dry_run)); then
    platform_require
    printf '[DRY] %s\n' \
      "platform: require ${target}" \
      "tools: require curl, tar, sha256sum" \
      "version: resolve ${version:-latest}" \
      "release: download SHA256SUMS and the ${target} archive from ${base_url}" \
      "verify: check the archive checksum and entries" \
      "stage: extract into ${install_dir}/.snipset-stage.*" \
      "smoke: run the staged binary" \
      "binary: place ${install_dir}/snipset"
    if ((add_path)); then
      printf '[DRY] path: add %s to %s\n' "$install_dir" "${HOME}/.profile"
    else
      printf '[DRY] path: leave %s unchanged (no --add-path)\n' "${HOME}/.profile"
    fi
    if ((do_shell)); then
      printf '[DRY] shell bundle: copy into %s\n' "$share_dir"
      printf '[DRY] shell block: add to %s\n' "$bashrc"
    else
      printf '[DRY] shell bundle: skip %s (--no-shell)\n' "$share_dir"
      printf '[DRY] shell block: skip %s (--no-shell)\n' "$bashrc"
    fi
    if ((do_init)); then
      printf '[DRY] database: init %s\n' "${db:-the CLI default}"
    else
      printf '[DRY] database: skip (--no-init)\n'
    fi
    if ((do_shims)); then
      printf '[DRY] shims: generate in %s\n' "$install_dir"
    else
      printf '[DRY] shims: skip (--no-shims)\n'
    fi
    read -r -a ids <<< "$mcp_list"
    if ((${#ids[@]} == 0)); then
      printf '[DRY] mcp: none requested\n'
    fi
    for id in "${ids[@]}"; do
      printf '[DRY] mcp %s: register snipset\n' "$id"
    done
    printf 'dry run: nothing was written\n'
    return 0
  fi
  platform_require
  fetch_tools_require
  fetch_resolve_version
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/snipset-install.XXXXXX")"
  trap 'rm -rf "$tmp" "${stage:-}"' EXIT
  fetch_release "$tmp"
  binary_verify "$tmp"
  binary_stage "$tmp"
  binary_smoke
  binary_place
  pathenv_add
  shell_bundle_place
  shell_block_add
  db_init
  shims_generate
  mcp_install
  printf 'Installed snipset %s to %s\n' "$version" "${install_dir}/snipset"
}
do_check() {
  binary_check
  pathenv_check
  shell_check
  db_check
  shims_check
  mcp_check
  if ((n_drift)); then
    printf 'check: DRIFT (%d items)\n' "$n_drift"
    return 1
  fi
  printf 'check: CURRENT\n'
}
do_update() {
  do_install
}
do_uninstall() {
  mcp_remove
  shims_remove
  shell_remove
  pathenv_remove
  binary_remove
  printf 'uninstall: removed %d, kept %d\n' "$n_removed" "$n_kept"
}
