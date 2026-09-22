#!/usr/bin/env bash
# Install the snipset terminal companion on Linux x64 from public release
# assets, then set it up the way a working station looks: a standalone
# database, shell integration (helpers, completion, TAB expansion, Enter
# trigger), and generated trigger shims. Every setup step is idempotent and
# strictly opt-out; only the binary install itself is mandatory.
set -euo pipefail
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
usage() {
  cat <<'EOF' >&2
Usage: install.sh [--version VERSION] [--install-dir DIR] [--add-path]
                  [--share-dir DIR] [--db PATH] [--bashrc PATH]
                  [--no-init] [--no-shell] [--no-shims] [--with-mcp]

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
EOF
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
    *) usage ;;
  esac
done
[[ -z "$version" || "$version" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || { echo 'install.sh: invalid version' >&2; exit 2; }
[[ "$version" == v* ]] || version="v${version}"
command -v curl >/dev/null || { echo 'install.sh: curl is required' >&2; exit 1; }
command -v tar >/dev/null || { echo 'install.sh: tar is required' >&2; exit 1; }
command -v sha256sum >/dev/null || { echo 'install.sh: sha256sum is required' >&2; exit 1; }
if [[ -z "$version" ]]; then
  version="$(curl -fsSL "https://api.github.com/repos/${repo}/releases/latest" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
fi
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || { echo 'install.sh: release version was not found' >&2; exit 1; }
target="x86_64-unknown-linux-gnu"
archive="snipset-cli-${version}-${target}.tar.gz"
release_url="${base_url}/${version}"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/snipset-install.XXXXXX")"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT
curl -fsSL "${release_url}/SHA256SUMS" -o "${tmp}/SHA256SUMS"
curl -fsSL "${release_url}/${archive}" -o "${tmp}/${archive}"
expected="$(awk -v name="$archive" '$2 == name { print $1 }' "${tmp}/SHA256SUMS")"
[[ "$expected" =~ ^[[:xdigit:]]{64}$ ]] || { echo 'install.sh: checksum entry missing' >&2; exit 1; }
actual="$(sha256sum "${tmp}/${archive}" | awk '{print $1}')"
[[ "$actual" == "$expected" ]] || { echo 'install.sh: checksum mismatch' >&2; exit 1; }
while IFS= read -r entry; do
  [[ "$entry" != /* && "$entry" != ../* && "$entry" != */../* ]] || { echo 'install.sh: unsafe archive entry' >&2; exit 1; }
done < <(tar -tzf "${tmp}/${archive}")
if tar -tvzf "${tmp}/${archive}" | awk '$1 ~ /^l/ { found=1 } END { exit found ? 0 : 1 }'; then
  echo 'install.sh: symlinks are not allowed in release archives' >&2; exit 1
fi
mkdir -p "$install_dir"
stage="$(mktemp -d "${install_dir}/.snipset-stage.XXXXXX")"
tar -xzf "${tmp}/${archive}" -C "$stage"
[[ -f "${stage}/snipset" && -x "${stage}/snipset" ]] || { echo 'install.sh: archive has no executable snipset' >&2; rm -rf "$stage"; exit 1; }
chmod 755 "${stage}/snipset"
mv -f "${stage}/snipset" "${install_dir}/snipset"
# The shell bundle (shell/snipset.sh, shell/completion.bash, shell/tab.sh,
# shell/snipset-shims.sh) ships with newer releases. Older archives carry the
# binary only; setup steps below degrade to a binary-only install.
has_shell=0
if [[ -f "${stage}/shell/snipset.sh" && -f "${stage}/shell/completion.bash" && -f "${stage}/shell/tab.sh" && -f "${stage}/shell/snipset-shims.sh" ]]; then
  has_shell=1
  chmod 755 "${stage}/shell/snipset-shims.sh"
  mv -f "${stage}/shell/snipset-shims.sh" "${install_dir}/snipset-shims"
fi
if ((add_path)); then
  profile="${HOME}/.profile"
  line="export PATH=\"${install_dir}:\$PATH\""
  touch "$profile"
  grep -Fqx "$line" "$profile" || printf '\n%s\n' "$line" >> "$profile"
fi
snipset_bin="${install_dir}/snipset"
if ((do_shell)) && ((has_shell)); then
  mkdir -p "$share_dir"
  for name in snipset.sh completion.bash tab.sh; do
    cp -f "${stage}/shell/${name}" "${share_dir}/${name}"
    chmod 755 "${share_dir}/${name}"
  done
  touch "$bashrc"
  if ! grep -Fq 'snipset-terminal-integration' "$bashrc"; then
    {
      printf '\n# snipset-terminal-integration (managed by snipset installer; safe to remove)\n'
      printf 'if ! command -v snipset >/dev/null 2>&1; then export PATH="%s:$PATH"; fi\n' "$install_dir"
      printf '[ -f "%s/snipset.sh" ] && . "%s/snipset.sh"\n' "$share_dir" "$share_dir"
      printf '[ -f "%s/completion.bash" ] && . "%s/completion.bash"\n' "$share_dir" "$share_dir"
      printf '[ -f "%s/tab.sh" ] && . "%s/tab.sh"\n' "$share_dir" "$share_dir"
    } >> "$bashrc"
  fi
elif ((do_shell)); then
  echo 'install.sh: release predates the shell bundle; skipping shell integration' >&2
fi
rm -rf "$stage"
setup_path=(PATH="${install_dir}:${PATH}")
note() { printf 'install.sh: %s\n' "$1" >&2; }
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
if ((do_shims)) && ((has_shell)); then
  if [[ -n "$db" ]]; then
    if ! env "${setup_path[@]}" SNIPSET_DB="$db" "${install_dir}/snipset-shims" --dir "$install_dir"; then
      note "shim generation skipped; run 'snipset-shims' after fixing the database"
    fi
  else
    if ! env "${setup_path[@]}" "${install_dir}/snipset-shims" --dir "$install_dir"; then
      note "shim generation skipped; run 'snipset-shims' after fixing the database"
    fi
  fi
elif ((do_shims)); then
  note "release predates the shell bundle; skipping shims"
fi
if ((do_mcp)); then
  mcp_config="${HOME}/.config/opencode/opencode.json"
  if [[ -f "$mcp_config" ]]; then
    note "MCP config exists; leaving $mcp_config untouched"
  else
    mkdir -p "$(dirname "$mcp_config")"
    if [[ -n "$db" ]]; then
      printf '{"$schema":"https://opencode.ai/config.json","mcp":{"snipset":{"type":"local","command":["%s","mcp","--db","%s"],"enabled":true}}}\n' "$snipset_bin" "$db" > "$mcp_config"
    else
      printf '{"$schema":"https://opencode.ai/config.json","mcp":{"snipset":{"type":"local","command":["%s","mcp"],"enabled":true}}}\n' "$snipset_bin" > "$mcp_config"
    fi
  fi
fi
printf 'Installed snipset %s to %s\n' "$version" "${install_dir}/snipset"
