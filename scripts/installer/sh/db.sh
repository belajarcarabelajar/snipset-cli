# shellcheck shell=bash disable=SC2034,SC2154
db_init() {
  local snipset_bin="${install_dir}/snipset"
  local setup_path=(PATH="${install_dir}:${PATH}")
  local db_args=() err rc=0
  [[ -z "$db" ]] || db_args=(--db "$db")
  if ((do_init)); then
    # Only stderr is captured; stdout still reaches the user.
    { err=$(env "${setup_path[@]}" "$snipset_bin" "${db_args[@]}" init 2>&1 >&3) || rc=$?; } 3>&1
    if ((rc == 0)); then
      [[ -z "$err" ]] || printf '%s\n' "$err" >&2
      return 0
    fi
    note "database init skipped (already exists or unreachable); run 'snipset doctor' to check"
    # An existing database is the normal reinstall case, and the CLI's
    # "already exists ... pass --force" text reads like damage; other failures stay visible.
    if [[ -n "$err" && "$err" != *"already exists"* ]]; then
      note "snipset init: ${err%%$'\n'*}"
    fi
  fi
}
db_check() {
  if [[ -z "$db" ]]; then
    report SKIP database 'default location (run snipset doctor)'
  elif [[ -e "$db" ]]; then
    report OK database "$db"
  else
    report MISSING database "$db"
  fi
}
# Never deletes anything: the database holds the user's data.
db_remove() {
  report KEEP database 'never removed by uninstall'
}
