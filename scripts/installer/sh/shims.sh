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
shims_read_manifest() {
  local kw
  shims_names=()
  while IFS= read -r kw || [[ -n "$kw" ]]; do
    if [[ -n "$kw" ]]; then
      shims_names+=("$kw")
    fi
  done < "$1"
}
# A name with a slash, or . and .., would point outside install_dir.
shims_valid_name() {
  [[ -n "$1" && "$1" != . && "$1" != .. && "$1" != */* ]]
}
# The generator writes this on line 2; a file without it belongs to the user.
shims_is_shim() {
  local second=""
  [[ -f "$1" && ! -L "$1" ]] || return 1
  { IFS= read -r _ && IFS= read -r second; } 2>/dev/null < "$1" || [[ -n "$second" ]] || return 1
  [[ "$second" == "# snipset-shim for '"* ]]
}
shims_check() {
  local manifest="${install_dir}/.snipset-shims" kw path
  if [[ ! -f "$manifest" ]]; then
    report SKIP shims 'none generated'
    return 0
  fi
  shims_read_manifest "$manifest"
  if ((${#shims_names[@]} == 0)); then
    report SKIP shims "none listed in ${manifest}"
    return 0
  fi
  for kw in "${shims_names[@]}"; do
    path="${install_dir}/${kw}"
    if ! shims_valid_name "$kw"; then
      report DRIFT shims "${path}: listed name leaves ${install_dir}"
    elif [[ ! -e "$path" && ! -L "$path" ]]; then
      report MISSING shims "$path"
    elif shims_is_shim "$path"; then
      report OK shims "$path"
    else
      report DRIFT shims "${path}: line 2 is not a snipset-shim header"
    fi
  done
}
shims_remove() {
  local manifest="${install_dir}/.snipset-shims" kw path remaining=0
  if [[ ! -f "$manifest" ]]; then
    report SKIP shims 'none generated'
    return 0
  fi
  shims_read_manifest "$manifest"
  if ((${#shims_names[@]})); then
    for kw in "${shims_names[@]}"; do
      path="${install_dir}/${kw}"
      if ! shims_valid_name "$kw"; then
        report KEEP shims "${path}: listed name leaves ${install_dir}"
      elif [[ ! -e "$path" && ! -L "$path" ]]; then
        report SKIP shims "${path}: already absent"
      elif shims_is_shim "$path"; then
        rm -f -- "$path"
        report REMOVED shims "$path"
      else
        report KEEP shims "${path}: not a snipset-shim; remove it by hand"
      fi
    done
    for kw in "${shims_names[@]}"; do
      path="${install_dir}/${kw}"
      if [[ -e "$path" || -L "$path" ]]; then
        remaining=1
      fi
    done
  fi
  if ((remaining)); then
    report KEEP shims "${manifest}: listed names remain"
  else
    rm -f -- "$manifest"
    report REMOVED shims "$manifest"
  fi
}
