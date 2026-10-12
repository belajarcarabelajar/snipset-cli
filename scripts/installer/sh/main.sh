# shellcheck shell=bash disable=SC2034,SC2154
parse_args "$@"
case "$mode" in
  install) do_install ;;
  check) do_check ;;
  update) do_update ;;
  uninstall) do_uninstall ;;
esac
