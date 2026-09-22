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

const STUB_SNIPSET = `#!/bin/sh
db="$HOME/.local/share/Snipset/snipset.db"
cmd=""
skip=0
for a in "$@"; do
  if [ "$skip" = 1 ]; then db="$a"; skip=0; continue; fi
  case "$a" in
    --db) skip=1 ;;
    --*) ;;
    *) if [ -z "$cmd" ]; then cmd="$a"; fi ;;
  esac
done
case "$cmd" in
  init)
    if [ -e "$db" ]; then echo "database already exists" >&2; exit 1; fi
    mkdir -p "\${db%/*}"; printf 'db' > "$db" ;;
  snippet) printf 'u1\\t,k1\\tA\\nu2\\t;k2\\tB\\n' ;;
  *) printf 'snipset 0.1.0\\n' ;;
esac
`;

const FAKE_GENERATOR = `#!/bin/sh
dir="$HOME/.local/bin"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir) dir="$2"; shift 2 ;;
    *) shift ;;
  esac
done
snipset snippet list --limit 500 2>/dev/null | while IFS='	' read -r _u kw _rest; do
  [ -n "$kw" ] || continue
  printf '#!/bin/sh\\nexec snipset snippet expand "%s" --by-keyword\\n' "$kw" > "$dir/$kw"
  chmod 755 "$dir/$kw"
done
`;

const SHELL_STUBS = {
  "shell/snipset.sh": "# snipset.sh fixture\n",
  "shell/completion.bash": "# completion.bash fixture\n",
  "shell/tab.sh": "# tab.sh fixture\n",
  "shell/snipset-shims.sh": FAKE_GENERATOR,
};

async function fakeRelease({ badHash = false, withShell = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "snipset-install-fixture-"));
  const binDir = join(dir, "bin");
  await mkdir(binDir);
  const archive = join(dir, "snipset-cli-v0.1.0-x86_64-unknown-linux-gnu.tar.gz");
  const staging = await mkdtemp(join(tmpdir(), "snipset-archive-"));
  await writeFile(join(staging, "snipset"), STUB_SNIPSET, {
    mode: 0o755,
  });
  const members = ["snipset"];
  if (withShell) {
    for (const [name, content] of Object.entries(SHELL_STUBS)) {
      const full = join(staging, name);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, content, { mode: 0o755 });
      members.push(name);
    }
  }
  await run("tar", ["-czf", archive, "-C", staging, ...members]);
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
    const version = await run(join(installDir, "snipset"), ["--version"], {
      env: { ...env, HOME: home },
    });
    assert.match(version.stdout, /0\.1\.0/);
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

async function freshEnv(fixture, home) {
  return {
    ...process.env,
    HOME: home,
    PATH: `${fixture.binDir}:${process.env.PATH}`,
    SNIPSET_RELEASE_BASE_URL: "https://fixture.invalid",
  };
}

test("full setup installs binary, database, shell, and shims", async () => {
  const fixture = await fakeRelease();
  const home = await mkdtemp(join(tmpdir(), "snipset-home-"));
  const installDir = join(home, "bin");
  try {
    const env = await freshEnv(fixture, home);
    await run("bash", [script, "--version", "0.1.0", "--install-dir", installDir], { env });
    assert.equal(
      await readFile(join(home, ".local", "share", "Snipset", "snipset.db"), "utf8"),
      "db"
    );
    const bashrc = await readFile(join(home, ".bashrc"), "utf8");
    assert.ok(bashrc.includes("snipset-terminal-integration"));
    assert.ok(bashrc.includes(join(home, ".local", "share", "snipset", "snipset.sh")));
    for (const name of ["snipset.sh", "completion.bash", "tab.sh"]) {
      assert.ok(
        (await readFile(join(home, ".local", "share", "snipset", name), "utf8")).length > 0
      );
    }
    const shim = await readFile(join(installDir, ",k1"), "utf8");
    assert.match(shim, /,k1/);
    assert.ok(!existsSync(join(home, ".config", "opencode", "opencode.json")));
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("opt-out flags skip their setup steps", async () => {
  const fixture = await fakeRelease();
  const home = await mkdtemp(join(tmpdir(), "snipset-home-"));
  const installDir = join(home, "bin");
  try {
    const env = await freshEnv(fixture, home);
    await run(
      "bash",
      [script, "--version", "0.1.0", "--install-dir", installDir, "--no-init", "--no-shell", "--no-shims"],
      { env }
    );
    assert.ok(existsSync(join(installDir, "snipset")));
    assert.ok(!existsSync(join(home, ".local", "share", "Snipset", "snipset.db")));
    assert.ok(!existsSync(join(home, ".bashrc")));
    assert.ok(!existsSync(join(installDir, ",k1")));
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("existing database keeps the install green", async () => {
  const fixture = await fakeRelease();
  const home = await mkdtemp(join(tmpdir(), "snipset-home-"));
  const installDir = join(home, "bin");
  try {
    const env = await freshEnv(fixture, home);
    const dbDir = join(home, ".local", "share", "Snipset");
    await mkdir(dbDir, { recursive: true });
    await writeFile(join(dbDir, "snipset.db"), "precious");
    await run("bash", [script, "--version", "0.1.0", "--install-dir", installDir], { env });
    assert.equal(await readFile(join(dbDir, "snipset.db"), "utf8"), "precious");
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("custom db path flows into init and mcp config", async () => {
  const fixture = await fakeRelease();
  const home = await mkdtemp(join(tmpdir(), "snipset-home-"));
  const installDir = join(home, "bin");
  const customDb = join(home, "custom.db");
  try {
    const env = await freshEnv(fixture, home);
    await run(
      "bash",
      [script, "--version", "0.1.0", "--install-dir", installDir, "--db", customDb, "--with-mcp"],
      { env }
    );
    assert.equal(await readFile(customDb, "utf8"), "db");
    const config = JSON.parse(
      await readFile(join(home, ".config", "opencode", "opencode.json"), "utf8")
    );
    assert.deepEqual(config.mcp.snipset.command, [join(installDir, "snipset"), "mcp", "--db", customDb]);
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("existing mcp config is never overwritten", async () => {
  const fixture = await fakeRelease();
  const home = await mkdtemp(join(tmpdir(), "snipset-home-"));
  const installDir = join(home, "bin");
  try {
    const env = await freshEnv(fixture, home);
    const configDir = join(home, ".config", "opencode");
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "opencode.json"), '{"keep":"mine"}');
    await run(
      "bash",
      [script, "--version", "0.1.0", "--install-dir", installDir, "--with-mcp"],
      { env }
    );
    assert.equal(await readFile(join(configDir, "opencode.json"), "utf8"), '{"keep":"mine"}');
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("release without shell bundle still installs the binary", async () => {
  const fixture = await fakeRelease({ withShell: false });
  const home = await mkdtemp(join(tmpdir(), "snipset-home-"));
  const installDir = join(home, "bin");
  try {
    const env = await freshEnv(fixture, home);
    await run("bash", [script, "--version", "0.1.0", "--install-dir", installDir], { env });
    assert.ok(existsSync(join(installDir, "snipset")));
    assert.ok(!existsSync(join(home, ".local", "share", "snipset")));
    assert.ok(!existsSync(join(home, ".bashrc")));
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});
