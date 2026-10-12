# shellcheck shell=bash disable=SC2034,SC2154
# Install the snipset terminal companion on Linux x64 from public release
# assets, then set it up the way a working station looks: a standalone
# database, shell integration (helpers, completion, TAB expansion, Enter
# trigger), and generated trigger shims. Every setup step is idempotent and
# strictly opt-out; only the binary install itself is mandatory.
set -euo pipefail
note() { printf 'install.sh: %s\n' "$1" >&2; }
