# shellcheck shell=bash disable=SC2034,SC2154
mcp_install() {
  local snipset_bin="${install_dir}/snipset"
  local mcp_config id
  local -a ids
  read -r -a ids <<< "$mcp_list"
  for id in "${ids[@]}"; do
    if [[ "$id" != opencode ]]; then
      report SKIP "$id" 'not supported yet'
      continue
    fi
    mcp_config="${HOME}/.config/opencode/opencode.json"
    if [[ -f "$mcp_config" ]]; then
      note "MCP config exists; leaving $mcp_config untouched"
    else
      mkdir -p "$(dirname "$mcp_config")"
      if [[ -n "$db" ]]; then
        # shellcheck disable=SC2016 # "$schema" is a literal JSON key in opencode.json
        printf '{"$schema":"https://opencode.ai/config.json","mcp":{"snipset":{"type":"local","command":["%s","mcp","--db","%s"],"enabled":true}}}\n' "$snipset_bin" "$db" > "$mcp_config"
      else
        # shellcheck disable=SC2016 # "$schema" is a literal JSON key in opencode.json
        printf '{"$schema":"https://opencode.ai/config.json","mcp":{"snipset":{"type":"local","command":["%s","mcp"],"enabled":true}}}\n' "$snipset_bin" > "$mcp_config"
      fi
    fi
  done
}
mcp_check() {
  local id
  local -a ids
  read -r -a ids <<< "$mcp_list"
  for id in "${ids[@]}"; do
    report SKIP "$id" 'not checked yet'
  done
}
mcp_remove() {
  local id
  local -a ids
  read -r -a ids <<< "$mcp_list"
  for id in "${ids[@]}"; do
    report SKIP "$id" 'not checked yet'
  done
}
