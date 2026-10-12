# shellcheck shell=bash disable=SC2034,SC2154
db_init() {
  local snipset_bin="${install_dir}/snipset"
  local setup_path=(PATH="${install_dir}:${PATH}")
  if ((do_init)); then
    if [[ -n "$db" ]]; then
      if ! env "${setup_path[@]}" "$snipset_bin" --db "$db" init; then
        note "database init skipped (already exists or unreachable); run 'snipset doctor' to check"
      fi
    else
      if ! env "${setup_path[@]}" "$snipset_bin" init; then
        note "database init skipped (already exists or unreachable); run 'snipset doctor' to check"
      fi
    fi
  fi
}
db_check() {
  report SKIP database 'not checked yet'
}
