import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const root = existsSync(join(testDir, "..", "install.sh")) ? join(testDir, "..") : process.cwd();
const script = join(root, "install.sh");

async function fakeRelease({ badHash = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "snipset-install-fixture-"));
  const binDir = join(dir, "bin");
  await mkdir(binDir);
  const archive = join(dir, "snipset-cli-v0.1.0-x86_64-unknown-linux-gnu.tar.gz");
  const staging = await mkdtemp(join(tmpdir(), "snipset-archive-"));
  await writeFile(join(staging, "snipset"), '#!/bin/sh\nprintf "snipset 0.1.0\\n"\n', {
    mode: 0o755,
  });
  await run("tar", ["-czf", archive, "-C", staging, "snipset"]);
  const hash = (await run("sha256sum", [archive])).stdout.split(/\s+/)[0];
  const sums = join(dir, "SHA256SUMS");
  await writeFile(sums, `${badHash ? "0".repeat(64) : hash}  ${archive.split("/").pop()}\n`);
  const curl = join(binDir, "curl");
  await writeFile(
    curl,
    `#!/bin/sh
set -eu
url=""
out=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  */releases/latest) data='{"tag_name":"v0.1.0"}' ;;
  *SHA256SUMS) data=$(cat "${sums}") ;;
  *.tar.gz) cp "${archive}" "$out"; exit 0 ;;
  *) exit 22 ;;
esac
if [ -n "$out" ]; then printf '%s' "$data" > "$out"; else printf '%s\\n' "$data"; fi
`
  );
  await chmod(curl, 0o755);
  return { dir, binDir, archive, sums };
}

test("installs a pinned release and preserves an existing binary on rerun", async () => {
  const fixture = await fakeRelease();
  const home = await mkdtemp(join(tmpdir(), "snipset-home-"));
  const installDir = join(home, "bin");
  try {
    const env = {
      ...process.env,
      HOME: home,
      PATH: `${fixture.binDir}:${process.env.PATH}`,
      SNIPSET_RELEASE_BASE_URL: "https://fixture.invalid",
    };
    await run("bash", [script, "--version", "0.1.0", "--install-dir", installDir], { env });
    assert.equal(
      await readFile(join(installDir, "snipset"), "utf8"),
      '#!/bin/sh\nprintf "snipset 0.1.0\\n"\n'
    );
    await run("bash", [script, "--version", "0.1.0", "--install-dir", installDir], { env });
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("rejects a checksum mismatch before replacing the installed binary", async () => {
  const fixture = await fakeRelease({ badHash: true });
  const home = await mkdtemp(join(tmpdir(), "snipset-home-"));
  const installDir = join(home, "bin");
  await mkdir(installDir);
  const existing = join(installDir, "snipset");
  await writeFile(existing, "existing");
  try {
    const env = {
      ...process.env,
      HOME: home,
      PATH: `${fixture.binDir}:${process.env.PATH}`,
      SNIPSET_RELEASE_BASE_URL: "https://fixture.invalid",
    };
    await assert.rejects(
      run("bash", [script, "--version", "0.1.0", "--install-dir", installDir], { env })
    );
    assert.equal(await readFile(existing, "utf8"), "existing");
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});
