# shellcheck shell=bash disable=SC2034,SC2154
print_usage() {
  cat <<'EOF'
Usage: install.sh [--version VERSION] [--install-dir DIR] [--add-path]
                  [--share-dir DIR] [--db PATH] [--bashrc PATH]
                  [--no-init] [--no-shell] [--no-shims] [--with-mcp]
                  [--with-mcp=LIST] [--from DIR] [--dry-run]
                  [--check | --update | --uninstall]
                  [--help]

  --version VERSION  Release to install (default: latest).
  --install-dir DIR  Binary destination (default: ~/.local/bin).
  --add-path         Append the install dir to PATH in ~/.profile.
  --share-dir DIR    Shell bundle destination (default: ~/.local/share/snipset).
  --db PATH          Database for init/shims (default: the CLI default).
  --bashrc PATH      Shell startup file for integration (default: ~/.bashrc).
  --no-init          Skip creating the standalone database.
  --no-shell         Skip shell integration.
  --no-shims         Skip generating trigger shims.
  --with-mcp         Write ~/.config/opencode/opencode.json if absent.
  --with-mcp=LIST    Register MCP for LIST: claude,codex,gemini,opencode,cursor,vscode or all.
  --from DIR         Install from SHA256SUMS and the archive in DIR (no download).
  --dry-run          Print every step and write nothing.
  --check            Report drift of an install made with the same flags (exit 1 on drift).
  --update           Install the latest (or --version) release over the current one.
  --uninstall        Remove what an install with the same flags wrote.
  --help, -h         Show this help and exit.
EOF
}
usage() {
  print_usage >&2
  exit 2
}
parse_args() {
  local raw id wanted known=" claude codex gemini opencode cursor vscode " path_value
  local -a ids
  repo="belajarcarabelajar/snipset-cli"
  version=""
  install_dir="${HOME}/.local/bin"
  share_dir="${HOME}/.local/share/snipset"
  bashrc="${HOME}/.bashrc"
  db=""
  add_path=0
  do_init=1
  do_shell=1
  do_shims=1
  mcp_list=""
  from_dir=""
  mode="install"
  dry_run=0
  base_url="${SNIPSET_RELEASE_BASE_URL:-https://github.com/${repo}/releases/download}"
  wanted=" "
  while (($#)); do
    case "$1" in
      --version) [[ $# -ge 2 ]] || usage; version="$2"; shift 2 ;;
      --install-dir) [[ $# -ge 2 ]] || usage; install_dir="$2"; shift 2 ;;
      --share-dir) [[ $# -ge 2 ]] || usage; share_dir="$2"; shift 2 ;;
      --db) [[ $# -ge 2 ]] || usage; db="$2"; shift 2 ;;
      --bashrc) [[ $# -ge 2 ]] || usage; bashrc="$2"; shift 2 ;;
      --from) [[ $# -ge 2 ]] || usage; from_dir="$2"; shift 2 ;;
      --add-path) add_path=1; shift ;;
      --no-init) do_init=0; shift ;;
      --no-shell) do_shell=0; shift ;;
      --no-shims) do_shims=0; shift ;;
      --with-mcp|--with-mcp=) wanted+="opencode "; shift ;;
      --with-mcp=*)
        raw="${1#--with-mcp=}"
        # read -a drops a trailing empty field, so check for empty ids first.
        [[ ",${raw}," != *,,* ]] || usage
        IFS=',' read -r -a ids <<< "$raw"
        for id in "${ids[@]}"; do
          if [[ "$id" == all ]]; then
            wanted+="${known# }"
          elif [[ "$known" == *" ${id} "* ]]; then
            wanted+="${id} "
          else
            usage
          fi
        done
        shift ;;
      --dry-run) dry_run=1; shift ;;
      --check|--update|--uninstall)
        [[ "$mode" == install ]] || usage
        mode="${1#--}"
        shift ;;
      --help|-h) print_usage; exit 0 ;;
      *) usage ;;
    esac
  done
  # Canonical order without duplicates, whatever order or repeats the flags used.
  for id in $known; do
    [[ "$wanted" != *" ${id} "* ]] || mcp_list+="${mcp_list:+ }${id}"
  done
  for path_value in "$install_dir" "$share_dir" "$bashrc" "$db" "$from_dir"; do
    # shellcheck disable=SC1003 # '\' is a literal backslash pattern, not a quote escape
    case "$path_value" in
      *$'\n'*|*$'\r'*|*'"'*|*'`'*|*'\'*|*'$'*)
        die 'path must not contain newline or shell-special characters (" ` \ $)' 2 ;;
    esac
  done
}
