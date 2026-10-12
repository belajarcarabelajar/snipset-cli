import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_TOOLS,
  cleanupSandbox,
  diffSnapshots,
  downloaderShims,
  fakeLinuxRelease,
  makeSandbox,
  readDownloads,
  runInstaller,
  snapshotTree,
  stubCommand,
} from "./helpers/install-sandbox.mjs";

// getconf lets platform_require read the glibc version, so stderr carries only the line under test.
const TOOLS = [...DEFAULT_TOOLS, "getconf"];
const SHELL_ERROR = /Permission denied|Read-only|line \d+:|No such file|command not found|unbound variable/;

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function sandbox() {
  const sb = makeSandbox({ tools: TOOLS });
  cleanups.push(() => cleanupSandbox(sb));
  sb.at = (...parts) => join(sb.home, ...parts);
  return sb;
}

function release(sb, options = {}) {
  const rel = fakeLinuxRelease(options);
  cleanups.push(() => rm(rel.dir, { recursive: true, force: true }));
  downloaderShims(sb, rel, options.shims);
  return rel;
}

function seed(path, content) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function lines(text) {
  return text.split("\n").filter((line) => line.length > 0);
}

// The helper's fake generator lacks the "# snipset-shims:" line 2 that binary_remove
// requires, so the full cycle repacks the archive with that header added.
function withGeneratorHeader(rel) {
  const env = { PATH: "/usr/bin:/bin", LANG: "C" };
  const stage = join(rel.dir, ".repack");
  mkdirSync(stage);
  execFileSync("/usr/bin/tar", ["-xzf", rel.archive, "-C", stage], { env });
  const members = lines(String(execFileSync("/usr/bin/tar", ["-tzf", rel.archive], { env })));
  const gen = join(stage, "shell", "snipset-shims.sh");
  const text = readFileSync(gen, "utf8");
  const cut = text.indexOf("\n") + 1;
  writeFileSync(gen, `${text.slice(0, cut)}# snipset-shims: generate trigger shims (test fixture)\n${text.slice(cut)}`);
  execFileSync("/usr/bin/tar", ["-czf", rel.archive, "-C", stage, ...members], { env });
  rmSync(stage, { recursive: true, force: true });
  const digest = createHash("sha256").update(readFileSync(rel.archive)).digest("hex");
  writeFileSync(rel.sums, `${digest}  ${rel.assetName}\n`);
  return rel;
}

function archiveDownloads(sb) {
  return readDownloads(sb).filter((line) => line.includes(".tar.gz"));
}

function files(snapshot) {
  return new Map(snapshot.filter((e) => e.type === "file").map((e) => [e.path, e.sha256]));
}

function makeReadOnly(sb) {
  execFileSync("/usr/bin/chmod", ["-R", "a-w", sb.home]);
  cleanups.push(async () => execFileSync("/usr/bin/chmod", ["-R", "u+w", sb.home]));
}

async function run(sb, args, env) {
  return runInstaller(sb, args, { env });
}

test("a full install, check, uninstall cycle leaves only the database and the user's bytes", async () => {
  const sb = sandbox();
  withGeneratorHeader(release(sb));
  seed(sb.at(".bashrc"), "# user bashrc\nalias ll='ls -l'\n");
  seed(sb.at(".profile"), "# user profile\nexport EDITOR=vi\n");
  const db = sb.at("data", "snipset.db");
  const flags = ["--add-path", "--with-mcp=opencode,cursor", "--db", db];
  const before = files(snapshotTree(sb.home));

  const install = await run(sb, flags);
  assert.equal(install.code, 0, install.stdout + install.stderr);
  assert.ok(existsSync(db), "install did not create the database");
  assert.ok(existsSync(sb.at(".config", "opencode", "opencode.json")));
  assert.ok(existsSync(sb.at(".cursor", "mcp.json")));
  const installed = files(snapshotTree(sb.home));
  const created = [...installed.keys()].filter((path) => !before.has(path));
  assert.ok(created.length >= 10, `expected the installer to create files, got ${created.join(", ")}`);

  const check = await run(sb, flags);
  assert.equal(check.code, 0, `rerun install:\n${check.stdout}${check.stderr}`);
  const current = await run(sb, ["--check", ...flags]);
  assert.equal(current.code, 0, current.stdout + current.stderr);
  assert.equal(lines(current.stdout).at(-1), "check: CURRENT");
  const dryCheck = await run(sb, ["--check", "--dry-run", ...flags]);
  assert.equal(dryCheck.code, 0, dryCheck.stdout + dryCheck.stderr);
  assert.equal(lines(dryCheck.stdout).at(-1), "check: CURRENT");

  const uninstall = await run(sb, ["--uninstall", ...flags]);
  assert.equal(uninstall.code, 0, uninstall.stdout + uninstall.stderr);
  const summary = /^uninstall: removed (\d+), kept (\d+)$/m.exec(uninstall.stdout);
  assert.ok(summary, uninstall.stdout);
  assert.ok(Number(summary[1]) > 0, uninstall.stdout);
  assert.match(uninstall.stdout, /^\[KEEP\] database: /m);

  const after = files(snapshotTree(sb.home));
  const left = created.filter((path) => after.has(path));
  assert.deepEqual(left, ["data/snipset.db"], `installer files left behind:\n${uninstall.stdout}`);
  for (const [path, sha] of before) assert.equal(after.get(path), sha, `${path} is not byte-identical`);

  const drift = await run(sb, ["--check", ...flags]);
  assert.equal(drift.code, 1, drift.stdout + drift.stderr);
  assert.match(lines(drift.stdout).at(-1), /^check: DRIFT \(\d+ items\)$/);

  const again = await run(sb, ["--uninstall", ...flags]);
  assert.equal(again.code, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /^uninstall: removed 0, kept \d+$/m);
  assert.deepEqual(files(snapshotTree(sb.home)), after);
});

test("--dry-run --uninstall refuses before removing anything", async () => {
  const sb = sandbox();
  release(sb);
  const install = await run(sb, ["--add-path"]);
  assert.equal(install.code, 0, install.stderr);
  const before = snapshotTree(sb.home);
  const r = await run(sb, ["--uninstall", "--dry-run", "--add-path"]);
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.equal(
    r.stderr,
    "install.sh: --dry-run cannot preview --uninstall; run --check to see what is installed\n",
  );
  assert.doesNotMatch(r.stdout, /REMOVED/);
  assert.deepEqual(diffSnapshots(before, snapshotTree(sb.home)), []);
});

const DRY_FLAGS = ["--no-init", "--no-shell", "--no-shims", "--add-path", "--with-mcp=all", "--from", "--version"];

function dryArgs(mask, rel) {
  const args = ["--dry-run"];
  DRY_FLAGS.forEach((flag, bit) => {
    if (!(mask & (1 << bit))) return;
    if (flag === "--from") args.push("--from", rel.dir);
    else if (flag === "--version") args.push("--version", "0.1.0");
    else args.push(flag);
  });
  return args;
}

test("--dry-run over 25 flag combinations writes nothing and downloads no archive", async () => {
  const sb = sandbox();
  const rel = release(sb);
  seed(sb.at(".bashrc"), "# user bashrc\n");
  const home = snapshotTree(sb.home);
  const tmp = snapshotTree(sb.tmp);
  const relDir = snapshotTree(rel.dir);
  // 37 is odd, so i * 37 mod 128 visits distinct masks; 127 adds the all-flags run.
  const masks = [...Array.from({ length: 24 }, (_, i) => (i * 37) % 128), 127];
  assert.equal(new Set(masks).size, 25);
  for (const mask of masks) {
    const args = dryArgs(mask, rel);
    const r = await run(sb, args);
    assert.equal(r.code, 0, `${args.join(" ")}\n${r.stdout}${r.stderr}`);
    assert.equal(lines(r.stdout).at(-1), "dry run: nothing was written", args.join(" "));
    assert.doesNotMatch(r.stdout, /^Installed snipset/m);
    assert.deepEqual(diffSnapshots(home, snapshotTree(sb.home)), [], args.join(" "));
    assert.deepEqual(diffSnapshots(tmp, snapshotTree(sb.tmp)), [], `TMPDIR written: ${args.join(" ")}`);
    assert.deepEqual(archiveDownloads(sb), [], args.join(" "));
  }
  assert.deepEqual(diffSnapshots(relDir, snapshotTree(rel.dir)), []);
});

test("the dry-run tools line names every fallback and the release line names the source", async () => {
  const sb = sandbox();
  const rel = release(sb);
  const net = await run(sb, ["--dry-run", "--version", "0.1.0"]);
  assert.equal(net.code, 0, net.stderr);
  const tools = lines(net.stdout).find((line) => line.startsWith("[DRY] tools: "));
  for (const name of ["curl or wget", "sha256sum, shasum, or openssl", "tar"]) {
    assert.ok(tools?.includes(name), `tools line lacks ${name}: ${tools}`);
  }
  assert.match(net.stdout, /^\[DRY\] release: download SHA256SUMS and the \S+ archive from https:\/\//m);

  const local = await run(sb, ["--dry-run", "--from", rel.dir]);
  assert.equal(local.code, 0, local.stderr);
  assert.ok(
    lines(local.stdout).includes(`[DRY] release: copy SHA256SUMS and the archive from ${rel.dir}`),
    local.stdout,
  );
  assert.doesNotMatch(local.stdout, /download/);
  assert.deepEqual(readDownloads(sb), []);
});

test("the dry-run path line names every startup file --add-path would touch", async () => {
  const sb = sandbox();
  release(sb);
  stubCommand(sb, "fish", "exit 0\n");
  seed(sb.at(".bash_profile"), "# user bash_profile\n");
  const zdot = sb.at("zdot");
  const before = snapshotTree(sb.home);
  const r = await run(sb, ["--dry-run", "--version", "0.1.0", "--add-path"], {
    SHELL: "/usr/bin/zsh",
    ZDOTDIR: zdot,
  });
  assert.equal(r.code, 0, r.stderr);
  const path = lines(r.stdout)
    .filter((line) => line.startsWith("[DRY] path"))
    .join("\n");
  const share = sb.at(".local", "share", "snipset");
  for (const file of [
    `${share}/env`,
    `${share}/env.fish`,
    sb.at(".profile"),
    sb.at(".bashrc"),
    sb.at(".bash_profile"),
    join(zdot, ".zshenv"),
    sb.at(".config", "fish", "conf.d", "snipset.fish"),
  ]) {
    assert.ok(path.includes(file), `path lines do not name ${file}:\n${path}`);
  }
  assert.ok(!path.includes(sb.at(".bash_login")), `absent .bash_login named:\n${path}`);
  assert.deepEqual(diffSnapshots(before, snapshotTree(sb.home)), []);
});

test("--update with the installed version current downloads no archive", async () => {
  const sb = sandbox();
  release(sb);
  const install = await run(sb, ["--no-init", "--no-shims"]);
  assert.equal(install.code, 0, install.stderr);
  const downloads = archiveDownloads(sb).length;
  for (const args of [["--update"], ["--update", "--version", "0.1.0"], ["--update", "--version", "v0.1.0"]]) {
    const r = await run(sb, [...args, "--no-init", "--no-shims"]);
    assert.equal(r.code, 0, `${args.join(" ")}\n${r.stdout}${r.stderr}`);
    assert.ok(lines(r.stdout).includes("[OK] update: snipset 0.1.0 is current"), r.stdout);
    assert.doesNotMatch(r.stdout, /^Installed snipset/m);
  }
  assert.equal(archiveDownloads(sb).length, downloads);
});

test("--update over an older installed version installs the newer release", async () => {
  const sb = sandbox();
  release(sb, { version: "0.1.0" });
  const install = await run(sb, ["--no-init", "--no-shims"]);
  assert.equal(install.code, 0, install.stderr);
  release(sb, { version: "0.2.0" });
  const r = await run(sb, ["--update", "--no-init", "--no-shims"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Installed snipset v0\.2\.0 to /m);
  assert.ok(archiveDownloads(sb).some((line) => line.includes("v0.2.0")));
  const version = execFileSync(sb.at(".local", "bin", "snipset"), ["--version"], { env: sb.env() });
  assert.equal(String(version), "snipset 0.2.0\n");
});

test("a read-only HOME makes install exit 1 with one line and check print no shell error", async () => {
  const sb = sandbox();
  release(sb);
  seed(sb.at(".bashrc"), "# user bashrc\n");
  makeReadOnly(sb);
  const install = await run(sb, ["--add-path", "--with-mcp=opencode"]);
  assert.equal(install.code, 1, install.stdout + install.stderr);
  assert.equal(install.stderr, `install.sh: ${sb.home} is not writable\n`);
  assert.deepEqual(archiveDownloads(sb), []);
  for (const args of [["--check"], ["--check", "--add-path", "--with-mcp=opencode"]]) {
    const r = await run(sb, args);
    assert.ok(r.code === 0 || r.code === 1, `${args.join(" ")} exit ${r.code}`);
    assert.doesNotMatch(r.stderr, SHELL_ERROR, args.join(" "));
    assert.match(lines(r.stdout).at(-1), /^check: (CURRENT|DRIFT \(\d+ items\))$/);
  }
});

test("check works on a read-only HOME after a real install", async () => {
  const sb = sandbox();
  release(sb);
  const flags = ["--add-path", "--with-mcp=opencode,cursor", "--db", sb.at("data", "snipset.db")];
  const install = await run(sb, flags);
  assert.equal(install.code, 0, install.stderr);
  makeReadOnly(sb);
  const r = await run(sb, ["--check", ...flags]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, SHELL_ERROR);
  assert.equal(lines(r.stdout).at(-1), "check: CURRENT");
});

test("a failed MCP registration makes install and uninstall exit 1", async () => {
  const sb = sandbox();
  release(sb);
  const bin = sb.at(".local", "bin", "snipset");
  stubCommand(sb, "claude", `[ "$2" = add ] && { echo "add refused" >&2; exit 1; }\nexit 1\n`);
  const install = await run(sb, ["--no-init", "--no-shims", "--with-mcp=claude"]);
  assert.equal(install.code, 1, install.stdout + install.stderr);
  assert.match(install.stdout, /^\[FAIL\] claude: add refused$/m);
  assert.match(install.stdout, /^Installed snipset v0\.1\.0 to /m);

  stubCommand(
    sb,
    "claude",
    `[ "$2" = get ] && { printf '  Command: %s\\n' ${JSON.stringify(bin)}; exit 0; }\necho "remove refused" >&2\nexit 1\n`,
  );
  const uninstall = await run(sb, ["--uninstall", "--no-init", "--no-shims", "--with-mcp=claude"]);
  assert.equal(uninstall.code, 1, uninstall.stdout + uninstall.stderr);
  assert.match(uninstall.stdout, /^\[FAIL\] claude: remove refused$/m);
  assert.match(uninstall.stdout, /^uninstall: removed \d+, kept \d+$/m);
});
