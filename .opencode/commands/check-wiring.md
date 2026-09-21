---
description: Smoke-test installer plus PATH wiring using fixture releases in temp dirs.
agent: build
---

Prove install plus PATH wiring works on this machine using fixture releases only (no network, no real profile changes):

1. Build a fixture release (temp dir with a `snipset` stub, tar.gz archive, `SHA256SUMS`) and a fake `curl` on PATH, mirroring `tests/install.test.mjs`.
2. Run `bash install.sh --version 0.1.0 --install-dir <temp-dir> --add-path` with `HOME` pointed at a temp dir so the PATH line lands in a temp `.profile`, never the real one.
3. Check: the installed `snipset` binary has the expected content, the temp `.profile` contains exactly one `export PATH="<install-dir>:$PATH"` line, and a second installer run preserves the binary and does not duplicate the PATH line.
4. Run a checksum-mismatch case and confirm the pre-existing binary is left untouched.

Clean up all temp dirs afterward. Report each check PASS/FAIL with the exact commands and exit codes used.
