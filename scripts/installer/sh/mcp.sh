# shellcheck shell=bash disable=SC2034,SC2154
mcp_cli() {
  case "$1" in
    claude|codex|gemini) printf '%s' "$1" ;;
    vscode) printf 'code' ;;
  esac
}
mcp_file() {
  case "$1" in
    opencode) printf '%s' "${HOME}/.config/opencode/opencode.json" ;;
    cursor) printf '%s' "${HOME}/.cursor/mcp.json" ;;
    vscode) printf '%s' "${XDG_CONFIG_HOME:-${HOME}/.config}/Code/User/mcp.json" ;;
  esac
}
# args.sh rejects quotes and backslashes in paths, so plain interpolation is valid JSON.
mcp_json_args() {
  if [[ -n "$db" ]]; then
    printf '"mcp","--db","%s"' "$db"
  else
    printf '"mcp"'
  fi
}
# shellcheck disable=SC2016 # "$schema" is a literal JSON key in opencode.json
mcp_file_content() {
  case "$1" in
    opencode) printf '{"$schema":"https://opencode.ai/config.json","mcp":{"snipset":{"type":"local","command":["%s",%s],"enabled":true}}}\n' "$snipset_bin" "$(mcp_json_args)" ;;
    cursor) printf '{"mcpServers":{"snipset":{"type":"stdio","command":"%s","args":[%s]}}}\n' "$snipset_bin" "$(mcp_json_args)" ;;
  esac
}
# Harness CLIs may read stdin, which under "curl | bash" is the rest of this script.
mcp_run() {
  local out rc=0
  out="$("$@" 2>&1 >/dev/null </dev/null)" || rc=$?
  mcp_err="${out%%$'\n'*}"
  [[ -n "$mcp_err" ]] || mcp_err="exit status ${rc}"
  return "$rc"
}
mcp_trim() {
  local s="${1%$'\r'}"
  s="${s#"${s%%[![:space:]]*}"}"
  printf '%s' "${s%"${s##*[![:space:]]}"}"
}
mcp_gemini_settings() { printf '%s' "${HOME}/.gemini/settings.json"; }
# Only a user-scope entry is the installer's: "remove --scope user" never touches
# another scope, and an entry in another scope can shadow the user one.
mcp_claude_probe() {
  local out line scope="" first="" cmd mine=0 bin_seen=0
  # "claude mcp get" starts the server to report its status and writes Claude's own
  # state (~/.claude, ~/.cache), so --check is not read-only for this harness.
  if ! out="$(claude mcp get snipset 2>/dev/null </dev/null)"; then
    printf 'absent'
    return 0
  fi
  while IFS= read -r line; do
    line="$(mcp_trim "$line")"
    case "$line" in
      [Ss]cope:*)
        scope="$(mcp_trim "${line#*:}")"
        case "$scope" in
          [Uu]ser*) scope=user ;;
          [Ll]ocal*) scope=local ;;
          [Pp]roject*) scope=project ;;
          *) scope="${scope%% *}" ;;
        esac
        [[ -n "$first" ]] || first="$scope" ;;
      [Cc]ommand:*)
        cmd="$(mcp_trim "${line#*:}")"
        if [[ "$cmd" == "$snipset_bin" ]]; then
          bin_seen=1
          [[ "$scope" != user ]] || mine=1
        fi
        scope="" ;;
    esac
  done <<< "$out"
  if ((mine)); then
    printf 'mine user'
  elif ((bin_seen)); then
    printf 'scoped %s' "${first:-unknown}"
  else
    printf 'foreign %s' "${first:-unknown}"
  fi
}
# The user settings file decides ownership; "gemini mcp list" merges every scope.
mcp_gemini_probe() {
  local settings out line text=""
  settings="$(mcp_gemini_settings)"
  [[ ! -f "$settings" ]] || text="$(cat -- "$settings")"
  if [[ "$text" == *'"snipset"'* ]]; then
    if [[ "$text" == *"\"${snipset_bin}\""* ]]; then printf 'mine'; else printf 'foreign'; fi
    return 0
  fi
  out="$(gemini mcp list 2>/dev/null </dev/null)" || out=""
  while IFS= read -r line; do
    case "$line" in
      snipset:*|*[[:space:]]snipset:*) printf 'scoped'; return 0 ;;
    esac
  done <<< "$out"
  printf 'absent'
}
# Detail for an entry the installer leaves alone because it sits in another scope.
mcp_scoped_detail() {
  case "$1" in
    claude) printf '%s entry left untouched' "$2" ;;
    gemini) printf 'snipset is registered outside %s; left untouched' "$(mcp_gemini_settings)" ;;
  esac
}
# Prints nocli, absent, other (file without snipset), mine, foreign, or scoped
# (the binary is registered in a scope the installer does not own), and for
# claude a second word naming the scope.
mcp_probe() {
  local id="$1" cli out line cmd="" text
  cli="$(mcp_cli "$id")"
  case "$id" in
    claude|codex|gemini)
      if ! command -v "$cli" >/dev/null 2>&1; then
        printf 'nocli'
        return 0
      fi ;;
  esac
  case "$id" in
    claude) mcp_claude_probe ;;
    gemini) mcp_gemini_probe ;;
    codex)
      if ! out="$(codex mcp get snipset 2>/dev/null </dev/null)"; then
        printf 'absent'
        return 0
      fi
      while IFS= read -r line; do
        line="$(mcp_trim "$line")"
        case "$line" in
          [Cc]ommand:*) cmd="$(mcp_trim "${line#*:}")"; break ;;
        esac
      done <<< "$out"
      if [[ "$cmd" == "$snipset_bin" ]]; then printf 'mine'; else printf 'foreign'; fi ;;
    *)
      if [[ ! -f "$(mcp_file "$id")" ]]; then
        printf 'absent'
        return 0
      fi
      text="$(cat -- "$(mcp_file "$id")")"
      if [[ "$text" == *"\"${snipset_bin}\""* ]]; then
        printf 'mine'
      elif [[ "$text" == *'"snipset"'* ]]; then
        printf 'foreign'
      else
        printf 'other'
      fi ;;
  esac
}
mcp_add() {
  local id="$1"
  local -a cmd=("$snipset_bin" mcp)
  [[ -z "$db" ]] || cmd+=(--db "$db")
  case "$id" in
    claude) mcp_run claude mcp add --scope user snipset -- "${cmd[@]}" ;;
    codex) mcp_run codex mcp add snipset -- "${cmd[@]}" ;;
    gemini) mcp_run gemini mcp add --scope user snipset "${cmd[@]}" ;;
    vscode) mcp_run code --add-mcp "{\"name\":\"snipset\",\"command\":\"${snipset_bin}\",\"args\":[$(mcp_json_args)]}" ;;
  esac
}
mcp_install() {
  local snipset_bin="${install_dir}/snipset"
  local id state scope file cli
  local -a ids
  read -r -a ids <<< "$mcp_list"
  for id in "${ids[@]}"; do
    cli="$(mcp_cli "$id")"
    if [[ -n "$cli" ]] && ! command -v "$cli" >/dev/null 2>&1; then
      report SKIP "$id" "${cli} not on PATH"
      continue
    fi
    read -r state scope <<< "$(mcp_probe "$id")"
    file="$(mcp_file "$id")"
    case "$id" in
      opencode|cursor)
        if [[ "$state" == absent ]]; then
          mkdir -p "$(dirname "$file")"
          mcp_file_content "$id" > "$file"
          report ADD "$id" "wrote ${file}"
          continue
        fi
        if [[ "$id" == opencode ]]; then
          note "MCP config exists; leaving $file untouched"
        else
          note "Cursor config exists; add this to mcpServers in ${file}: \"snipset\":{\"type\":\"stdio\",\"command\":\"${snipset_bin}\",\"args\":[$(mcp_json_args)]}"
        fi
        if [[ "$state" == other ]]; then
          report KEEP "$id" "${file} exists; left untouched"
        else
          report KEEP "$id" 'snipset is already registered'
        fi ;;
      *)
        if [[ "$state" != absent ]]; then
          report KEEP "$id" 'snipset is already registered'
        elif mcp_add "$id"; then
          report ADD "$id" 'snipset registered'
        else
          report FAIL "$id" "$mcp_err"
        fi ;;
    esac
  done
}
mcp_check() {
  local snipset_bin="${install_dir}/snipset"
  local id cli state scope
  local -a ids
  read -r -a ids <<< "$mcp_list"
  if ((${#ids[@]} == 0)); then
    report SKIP mcp 'no --with-mcp list'
    return 0
  fi
  for id in "${ids[@]}"; do
    cli="$(mcp_cli "$id")"
    if [[ -n "$cli" ]] && ! command -v "$cli" >/dev/null 2>&1; then
      report SKIP "$id" "${cli} not on PATH"
      continue
    fi
    read -r state scope <<< "$(mcp_probe "$id")"
    case "$state" in
      mine) report OK "$id" "snipset points at ${snipset_bin}" ;;
      foreign) report KEEP "$id" 'snipset points elsewhere' ;;
      scoped) report KEEP "$id" "$(mcp_scoped_detail "$id" "$scope")" ;;
      *) report MISSING "$id" 'snipset is not registered' ;;
    esac
  done
}
mcp_remove_entry() {
  local id="$1" detail="$2"
  shift 2
  if ((dry_run)); then
    printf '[DRY] mcp %s: remove %s\n' "$id" "$detail"
    return 0
  fi
  if mcp_run "$@"; then
    report REMOVED "$id" "$detail"
  else
    report FAIL "$id" "$mcp_err"
  fi
}
mcp_remove() {
  local snipset_bin="${install_dir}/snipset"
  local id state scope file text
  local -a ids
  read -r -a ids <<< "$mcp_list"
  if ((${#ids[@]} == 0)); then
    report SKIP mcp 'no --with-mcp list'
    return 0
  fi
  for id in "${ids[@]}"; do
    read -r state scope <<< "$(mcp_probe "$id")"
    file="$(mcp_file "$id")"
    case "${id}:${state}" in
      *:nocli) report SKIP "$id" "$(mcp_cli "$id") not on PATH" ;;
      claude:foreign|*:scoped) report KEEP "$id" "$(mcp_scoped_detail "$id" "$scope")" ;;
      *:foreign) report KEEP "$id" 'snipset points elsewhere' ;;
      *:absent|*:other) report SKIP "$id" 'snipset is not registered' ;;
      claude:mine) mcp_remove_entry "$id" snipset claude mcp remove --scope user snipset ;;
      codex:mine) mcp_remove_entry "$id" snipset codex mcp remove snipset ;;
      gemini:mine) mcp_remove_entry "$id" snipset gemini mcp remove --scope user snipset ;;
      vscode:mine) report KEEP "$id" "remove snipset from ${file} by hand" ;;
      *:mine)
        # The trailing x keeps the file's final newline through command substitution.
        text="$(cat -- "$file"; printf x)"
        if [[ "$text" == "$(mcp_file_content "$id"; printf x)" ]]; then
          mcp_remove_entry "$id" "$file" rm -f -- "$file"
        else
          report KEEP "$id" "${file} differs from what the installer writes; remove snipset by hand"
        fi ;;
    esac
  done
}
