# shellcheck shell=bash disable=SC2034,SC2154
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
do_mcp=0
base_url="${SNIPSET_RELEASE_BASE_URL:-https://github.com/${repo}/releases/download}"
print_usage() {
  cat <<'EOF'
Usage: install.sh [--version VERSION] [--install-dir DIR] [--add-path]
                  [--share-dir DIR] [--db PATH] [--bashrc PATH]
                  [--no-init] [--no-shell] [--no-shims] [--with-mcp]
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
  --help, -h         Show this help and exit.
EOF
}
usage() {
  print_usage >&2
  exit 2
}
while (($#)); do
  case "$1" in
    --version) [[ $# -ge 2 ]] || usage; version="$2"; shift 2 ;;
    --install-dir) [[ $# -ge 2 ]] || usage; install_dir="$2"; shift 2 ;;
    --share-dir) [[ $# -ge 2 ]] || usage; share_dir="$2"; shift 2 ;;
    --db) [[ $# -ge 2 ]] || usage; db="$2"; shift 2 ;;
    --bashrc) [[ $# -ge 2 ]] || usage; bashrc="$2"; shift 2 ;;
    --add-path) add_path=1; shift ;;
    --no-init) do_init=0; shift ;;
    --no-shell) do_shell=0; shift ;;
    --no-shims) do_shims=0; shift ;;
    --with-mcp) do_mcp=1; shift ;;
    --help|-h) print_usage; exit 0 ;;
    *) usage ;;
  esac
done
for path_value in "$install_dir" "$share_dir" "$bashrc" "$db"; do
  # shellcheck disable=SC1003 # '\' is a literal backslash pattern, not a quote escape
  case "$path_value" in
    *$'\n'*|*$'\r'*|*'"'*|*'`'*|*'\'*|*'$'*)
      echo 'install.sh: path must not contain newline or shell-special characters (" ` \ $)' >&2; exit 2 ;;
  esac
done
