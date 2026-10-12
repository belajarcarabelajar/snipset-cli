# shellcheck shell=bash disable=SC2034,SC2154
shims_generate() {
  local setup_path=(PATH="${install_dir}:${PATH}")
  local shim_out shim_rc
  if ((do_shims)) && ((has_shell)); then
    shim_out=""
    shim_rc=0
    if [[ -n "$db" ]]; then
      shim_out="$(env "${setup_path[@]}" SNIPSET_DB="$db" "${install_dir}/snipset-shims" --dir "$install_dir" 2>&1)" || shim_rc=$?
    else
      shim_out="$(env "${setup_path[@]}" "${install_dir}/snipset-shims" --dir "$install_dir" 2>&1)" || shim_rc=$?
    fi
    if ((shim_rc != 0)); then
      note "shim generation skipped; run 'snipset-shims' after fixing the database"
    elif [[ -z "$shim_out" ]]; then
      note "shim generator produced no output; run 'snipset-shims' to check triggers"
    fi
  elif ((do_shims)); then
    note "release predates the shell bundle; skipping shims"
  fi
}
shims_check() {
  report SKIP shims 'not checked yet'
}
shims_remove() {
  report SKIP shims 'not checked yet'
}
