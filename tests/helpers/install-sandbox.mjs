import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ~/.local/bin is never consulted: grep there is a tgrep shim.
const TOOL_DIRS = ["/usr/bin", "/bin"];
const HOST_PATH = TOOL_DIRS.join(":");

export const DEFAULT_TOOLS = Object.freeze([
  "bash", "sh", "env", "cat", "cp", "mv", "rm", "mkdir", "rmdir", "chmod", "ln", "ls",
  "mktemp", "tar", "gzip", "sha256sum", "awk", "sed", "grep", "head", "tail", "tr", "cut",
  "sort", "uniq", "dirname", "basename", "touch", "printf", "test", "wc", "cmp", "diff",
  "find", "xargs", "id", "uname", "date", "tee", "readlink", "realpath", "stat", "sleep",
]);

const LICENSE_TEXT = "MIT License (snipset-cli test fixture)\n";

function resolveTool(name) {
  for (const dir of TOOL_DIRS) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function requireTool(name) {
  const path = resolveTool(name);
  if (!path) throw new Error(`install-sandbox: ${name} not found in ${HOST_PATH}`);
  return path;
}

function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function checkName(name) {
  if (!name || name === "." || name === ".." || name.includes("/")) {
    throw new Error(`install-sandbox: invalid command name ${JSON.stringify(name)}`);
  }
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function makeSandbox({ tools = DEFAULT_TOOLS } = {}) {
  const root = mkdtempSync(join(tmpdir(), "snipset-sbx-"));
  const sb = {
    root,
    home: join(root, "home"),
    bin: join(root, "bin"),
    tmp: join(root, "tmp"),
    logFile: join(root, "downloads.log"),
  };
  try {
    for (const dir of [sb.home, sb.bin, sb.tmp]) mkdirSync(dir);
    for (const tool of new Set(tools)) {
      checkName(tool);
      symlinkSync(requireTool(tool), join(sb.bin, tool));
    }
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  // Both read sb.home at call time, so a test can swap it to prove the guard.
  sb.env = (extra = {}) => ({
    HOME: sb.home,
    PATH: sb.bin,
    TMPDIR: sb.tmp,
    LANG: "C",
    POWERSHELL_TELEMETRY_OPTOUT: "1",
    ...extra,
  });
  sb.assertSandbox = () => {
    const home = realpathSync(sb.home);
    const tmpReal = realpathSync(tmpdir());
    let realHome = homedir();
    try {
      realHome = realpathSync(realHome);
    } catch {}
    if (!home.startsWith(tmpReal + sep)) {
      throw new Error(`install-sandbox: HOME ${home} is not under ${tmpReal}`);
    }
    if (home === realHome) {
      throw new Error(`install-sandbox: HOME ${home} is the real HOME`);
    }
  };
  return sb;
}

export function cleanupSandbox(sb) {
  return rm(sb.root, { recursive: true, force: true });
}

function stubSnipset(version, failingVersion) {
  const loaderFailure = failingVersion
    ? "echo 'snipset: error while loading shared libraries: libcrypto.so.3: cannot open shared object file' >&2\nexit 127\n"
    : "";
  return `#!/bin/sh
${loaderFailure}db="$HOME/.local/share/Snipset/snipset.db"
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
  *) printf 'snipset ${version}\\n' ;;
esac
`;
}

const FAKE_GENERATOR = `#!/bin/sh
dir="$HOME/.local/bin"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir) dir="$2"; shift 2 ;;
    *) shift ;;
  esac
done
mkdir -p "$dir"
manifest="$dir/.snipset-shims"
: > "$manifest"
snipset snippet list --limit 500 2>/dev/null | while IFS='\t' read -r _u kw _rest; do
  [ -n "$kw" ] || continue
  printf '#!/bin/sh\\n# snipset-shim for '"'"'%s'"'"' (exec mode, managed by snipset-shims; do not edit).\\nexec snipset snippet expand "%s" --by-keyword\\n' "$kw" "$kw" > "$dir/$kw"
  chmod 755 "$dir/$kw"
  printf '%s\\n' "$kw" >> "$manifest"
done
`;

const SHELL_STUBS = {
  "shell/snipset.sh": "# snipset.sh fixture\n",
  "shell/completion.bash": "# completion.bash fixture\n",
  "shell/tab.sh": "# tab.sh fixture\n",
  "shell/snipset-shims.sh": FAKE_GENERATOR,
};

function normalizeVersion(version) {
  const v = String(version).replace(/^v/, "");
  if (!/^[0-9A-Za-z.+-]+$/.test(v)) throw new Error(`install-sandbox: bad version ${version}`);
  return v;
}

function writeStaged(stage, name, content, mode) {
  const full = join(stage, name);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  chmodSync(full, mode);
}

function writeSums(dir, archive, assetName, { badHash, starMarker }) {
  const sums = join(dir, "SHA256SUMS");
  const digest = badHash ? "0".repeat(64) : sha256File(archive);
  writeFileSync(sums, `${digest}${starMarker ? " *" : "  "}${assetName}\n`);
  return sums;
}

export function fakeLinuxRelease({
  version = "0.1.0",
  badHash = false,
  withShell = true,
  starMarker = false,
  failingVersion = false,
} = {}) {
  const v = normalizeVersion(version);
  const tag = `v${v}`;
  const assetName = `snipset-cli-${tag}-x86_64-unknown-linux-gnu.tar.gz`;
  const dir = mkdtempSync(join(tmpdir(), "snipset-rel-"));
  const stage = join(dir, ".stage");
  const members = ["snipset", "LICENSE"];
  writeStaged(stage, "snipset", stubSnipset(v, failingVersion), 0o755);
  writeStaged(stage, "LICENSE", LICENSE_TEXT, 0o644);
  if (withShell) {
    for (const [name, content] of Object.entries(SHELL_STUBS)) {
      writeStaged(stage, name, content, 0o755);
      members.push(name);
    }
  }
  const archive = join(dir, assetName);
  execFileSync(requireTool("tar"), ["-czf", archive, "-C", stage, ...members], {
    env: { PATH: HOST_PATH, LANG: "C" },
  });
  rmSync(stage, { recursive: true, force: true });
  const sums = writeSums(dir, archive, assetName, { badHash, starMarker });
  return { dir, archive, sums, version: v, tag, assetName };
}

export function fakeWindowsRelease({ version = "0.1.0", badHash = false } = {}) {
  const bsdtar = resolveTool("bsdtar");
  if (!bsdtar) return null;
  const v = normalizeVersion(version);
  const tag = `v${v}`;
  const assetName = `snipset-cli-${tag}-x86_64-pc-windows-msvc.zip`;
  const dir = mkdtempSync(join(tmpdir(), "snipset-rel-"));
  const stage = join(dir, ".stage");
  writeStaged(stage, "snipset.exe", `snipset.exe fixture ${v}\n`, 0o644);
  writeStaged(stage, "LICENSE", LICENSE_TEXT, 0o644);
  const archive = join(dir, assetName);
  execFileSync(bsdtar, ["-a", "-cf", archive, "-C", stage, "snipset.exe", "LICENSE"], {
    env: { PATH: HOST_PATH, LANG: "C" },
  });
  rmSync(stage, { recursive: true, force: true });
  const sums = writeSums(dir, archive, assetName, { badHash, starMarker: false });
  return { dir, archive, sums, version: v, tag, assetName };
}

function writeBinScript(sb, name, content) {
  checkName(name);
  const path = join(sb.bin, name);
  // Unlink first: writing through a tool symlink would overwrite the real /usr/bin binary.
  rmSync(path, { force: true });
  writeFileSync(path, content, { flag: "wx" });
  chmodSync(path, 0o755);
  return path;
}

export function stubCommand(sb, name, body) {
  return writeBinScript(sb, name, `#!/bin/sh\n${body}`);
}

function routeBlock(release, tag, failCode) {
  return `case "$url" in
  */releases/latest) data=${shQuote(`{"tag_name":"${tag}"}`)} ;;
  */SHA256SUMS) src=${shQuote(release.sums)} ;;
  */${shQuote(release.assetName)}) src=${shQuote(release.archive)} ;;
  *) exit ${failCode} ;;
esac`;
}

function emitBlock(toStdout) {
  const cat = shQuote(requireTool("cat"));
  const cp = shQuote(requireTool("cp"));
  return `if [ -n "$src" ]; then
  if ${toStdout}; then ${cat} "$src"; else ${cp} "$src" "$out"; fi
else
  if ${toStdout}; then printf '%s\\n' "$data"; else printf '%s\\n' "$data" > "$out"; fi
fi
`;
}

export function downloaderShims(sb, release, { curl = true, wget = false, latestTag } = {}) {
  const tag = latestTag ?? release.tag;
  const log = shQuote(sb.logFile);
  if (curl) {
    writeBinScript(
      sb,
      "curl",
      `#!/bin/sh
printf 'curl %s\\n' "$*" >> ${log}
url=""
out=""
src=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|--output) out="$2"; shift 2 ;;
    *://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
${routeBlock(release, tag, 22)}
${emitBlock('[ -z "$out" ] || [ "$out" = "-" ]')}`,
    );
  }
  if (wget) {
    writeBinScript(
      sb,
      "wget",
      `#!/bin/sh
printf 'wget %s\\n' "$*" >> ${log}
url=""
out=""
src=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -O|-qO) out="$2"; shift 2 ;;
    -O*) out="\${1#-O}"; shift ;;
    -qO*) out="\${1#-qO}"; shift ;;
    --output-document=*) out="\${1#--output-document=}"; shift ;;
    *://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
[ -n "$out" ] || out="\${url##*/}"
${routeBlock(release, tag, 8)}
${emitBlock('[ "$out" = "-" ]')}`,
    );
  }
}

export function readDownloads(sb) {
  if (!existsSync(sb.logFile)) return [];
  return readFileSync(sb.logFile, "utf8").split("\n").filter((line) => line.length > 0);
}

export function snapshotTree(dir) {
  try {
    lstatSync(dir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const entries = [];
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs)) {
      const full = join(abs, name);
      const path = rel ? `${rel}/${name}` : name;
      const st = lstatSync(full);
      const mode = st.mode & 0o7777;
      if (st.isSymbolicLink()) {
        entries.push({ path, type: "symlink", mode, target: readlinkSync(full) });
      } else if (st.isDirectory()) {
        entries.push({ path, type: "dir", mode });
        walk(full, path);
      } else if (st.isFile()) {
        entries.push({ path, type: "file", mode, sha256: sha256File(full) });
      } else {
        entries.push({ path, type: "other", mode });
      }
    }
  };
  walk(dir, "");
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function diffSnapshots(a, b) {
  const index = (list) => new Map(list.map((entry) => [entry.path, JSON.stringify(entry)]));
  const left = index(a);
  const right = index(b);
  const paths = new Set([...left.keys(), ...right.keys()]);
  return [...paths].filter((path) => left.get(path) !== right.get(path)).sort();
}

const builtInstallers = new Map();

export function installerPath(target = "sh") {
  if (target !== "sh" && target !== "ps1") {
    throw new Error(`install-sandbox: unknown installer target ${target}`);
  }
  const override = target === "sh" ? process.env.SNIPSET_INSTALL_SCRIPT : process.env.SNIPSET_INSTALL_PS1;
  if (override) return override;
  const build = join(REPO_ROOT, "scripts", "installer", "build.mjs");
  const order = join(REPO_ROOT, "scripts", "installer", target, "ORDER");
  if (!existsSync(build) || !existsSync(order)) return join(REPO_ROOT, `install.${target}`);
  if (!builtInstallers.has(target)) {
    const out = mkdtempSync(join(tmpdir(), "snipset-installer-"));
    process.once("exit", () => rmSync(out, { recursive: true, force: true }));
    execFileSync(process.execPath, [build, "--target", target, "--out", out], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const file = join(out, `install.${target}`);
    if (!existsSync(file)) throw new Error(`install-sandbox: build.mjs did not write ${file}`);
    builtInstallers.set(target, file);
  }
  return builtInstallers.get(target);
}

export async function runInstaller(sb, args, { script = installerPath("sh"), env = {} } = {}) {
  sb.assertSandbox();
  const sandboxBash = join(sb.bin, "bash");
  const bash = existsSync(sandboxBash) ? sandboxBash : requireTool("bash");
  return new Promise((resolve, reject) => {
    const child = spawn(bash, [script, ...args], {
      env: sb.env(env),
      cwd: sb.root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}
