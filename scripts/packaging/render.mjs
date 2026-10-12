#!/usr/bin/env bun
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "belajarcarabelajar/snipset-cli";
const USAGE = [
  "usage: bun scripts/packaging/render.mjs [--check] [--channel ID] [--root DIR] [--templates DIR]",
  "after changing packaging/VERSION, delete the previous version's folder under packaging/winget/manifests before --check",
].join("\n");
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

class UsageError extends Error {}

export function assetNames(version) {
  return {
    linux: `snipset-cli-v${version}-x86_64-unknown-linux-gnu.tar.gz`,
    windows: `snipset-cli-v${version}-x86_64-pc-windows-msvc.zip`,
  };
}

export function sriFromHex(hex) {
  return `sha256-${Buffer.from(hex, "hex").toString("base64")}`;
}

export function parseVersion(text) {
  const version = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (!SEMVER.test(version)) {
    throw new Error(`packaging/VERSION must be one semver line without a leading v, got ${JSON.stringify(text)}`);
  }
  // makepkg rejects a hyphen in pkgver (exit 12), and every channel shares this one version.
  if (/[-+]/.test(version)) {
    throw new Error(`packaging/VERSION ${version} has a pre-release part; AUR pkgver cannot hold a hyphen`);
  }
  return version;
}

export function parseSums(text, version) {
  if (text.includes("\r")) throw new Error("SHA256SUMS contains a CR character; use LF line endings");
  const digests = new Map();
  text.split("\n").forEach((line, index) => {
    if (line === "") return;
    const match = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line);
    if (!match) throw new Error(`SHA256SUMS line ${index + 1} is not "<64 hex>  <name>": ${JSON.stringify(line)}`);
    const [, hex, name] = match;
    const digest = hex.toLowerCase();
    if (digests.has(name) && digests.get(name) !== digest) {
      throw new Error(`SHA256SUMS lists ${name} twice with different digests`);
    }
    digests.set(name, digest);
  });
  const names = assetNames(version);
  const sums = {};
  for (const [platform, name] of Object.entries(names)) {
    if (!digests.has(name)) throw new Error(`SHA256SUMS has no line for ${name}`);
    sums[platform] = digests.get(name);
  }
  return sums;
}

export function placeholders(version, sums) {
  const tag = `v${version}`;
  const assets = assetNames(version);
  const url = (asset) => `https://github.com/${REPO}/releases/download/${tag}/${asset}`;
  return {
    version,
    tag,
    "asset.linux": assets.linux,
    "asset.windows": assets.windows,
    "url.linux": url(assets.linux),
    "url.windows": url(assets.windows),
    "sha256.linux": sums.linux,
    "sha256.windows": sums.windows,
    "sha256.linux.upper": sums.linux.toUpperCase(),
    "sha256.windows.upper": sums.windows.toUpperCase(),
    "sri.linux": sriFromHex(sums.linux),
    "sri.windows": sriFromHex(sums.windows),
  };
}

export function renderTemplate(text, values, source) {
  return text.replace(/\{\{([^{}]*)\}\}/g, (_, name) => {
    if (!Object.hasOwn(values, name)) throw new Error(`unknown placeholder {{${name}}} in ${source}`);
    return values[name];
  });
}

function toPosix(path) {
  return path.split(sep).join("/");
}

function insideRoot(root, rel, source) {
  if (typeof rel !== "string" || rel === "" || isAbsolute(rel)) {
    throw new Error(`${source}: path ${JSON.stringify(rel)} must be relative to the root`);
  }
  const abs = resolve(root, rel);
  const back = relative(root, abs);
  if (back === "" || back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back)) {
    throw new Error(`${source}: path ${JSON.stringify(rel)} leaves the root`);
  }
  return { abs, rel: toPosix(back) };
}

function listChannels(templatesDir) {
  if (!existsSync(templatesDir) || !statSync(templatesDir).isDirectory()) {
    throw new Error(`templates dir ${templatesDir} does not exist`);
  }
  return readdirSync(templatesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(templatesDir, entry.name, "target.json")))
    .map((entry) => entry.name)
    .sort();
}

function loadChannel(root, templatesDir, id, values) {
  const dir = join(templatesDir, id);
  const targetPath = join(dir, "target.json");
  let target;
  try {
    target = JSON.parse(readFileSync(targetPath, "utf8"));
  } catch (error) {
    throw new Error(`${targetPath}: ${error.message}`);
  }
  if (!target || !Array.isArray(target.outputs) || target.outputs.length === 0) {
    throw new Error(`${targetPath}: "outputs" must be a non-empty array`);
  }
  const outputs = target.outputs.map((output, index) => {
    const where = `${targetPath} outputs[${index}]`;
    if (!output || typeof output.template !== "string" || typeof output.out !== "string") {
      throw new Error(`${where}: needs string "template" and "out"`);
    }
    const templateFile = join(dir, output.template);
    if (!existsSync(templateFile)) throw new Error(`${where}: template ${templateFile} does not exist`);
    const content = renderTemplate(readFileSync(templateFile, "utf8"), values, templateFile);
    const out = insideRoot(root, renderTemplate(output.out, values, where), where);
    return { ...out, content };
  });
  let owns = null;
  if (target.owns !== undefined) owns = insideRoot(root, target.owns, `${targetPath} owns`);
  return { id, outputs, owns };
}

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path));
    else files.push(path);
  }
  return files;
}

function checkChannels(root, channels) {
  const problems = [];
  for (const channel of channels) {
    for (const output of channel.outputs) {
      if (!existsSync(output.abs)) problems.push(`missing ${output.rel}`);
      else if (readFileSync(output.abs, "utf8") !== output.content) problems.push(`drift ${output.rel}`);
    }
    if (channel.owns && existsSync(channel.owns.abs)) {
      const named = new Set(channel.outputs.map((output) => output.rel));
      for (const file of walkFiles(channel.owns.abs).sort()) {
        const rel = toPosix(relative(root, file));
        if (!named.has(rel)) problems.push(`orphan ${rel}`);
      }
    }
  }
  return problems;
}

function parseArgs(argv) {
  const options = { check: false, channel: null, root: null, templates: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") options.check = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--channel" || arg === "--root" || arg === "--templates") {
      const value = argv[++i];
      if (value === undefined || value === "") throw new UsageError(`${arg} needs a value`);
      options[arg.slice(2)] = value;
    } else throw new UsageError(`unknown argument ${arg}`);
  }
  return options;
}

export function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`render: ${error.message}\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const root = resolve(options.root ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
  const templatesDir = resolve(options.templates ?? join(root, "packaging", "templates"));
  try {
    let ids = listChannels(templatesDir);
    if (options.channel !== null) {
      if (!ids.includes(options.channel)) {
        console.error(`render: unknown channel ${options.channel} (known: ${ids.join(", ") || "none"})\n${USAGE}`);
        return 2;
      }
      ids = [options.channel];
    }
    const version = parseVersion(readFileSync(join(root, "packaging", "VERSION"), "utf8"));
    const sums = parseSums(readFileSync(join(root, "packaging", "SHA256SUMS"), "utf8"), version);
    const values = placeholders(version, sums);
    // Every template renders before anything is written, so a bad template leaves no partial output.
    const channels = ids.map((id) => loadChannel(root, templatesDir, id, values));
    const seen = new Map();
    for (const channel of channels) {
      for (const output of channel.outputs) {
        if (seen.has(output.rel)) throw new Error(`${output.rel} is an output of both ${seen.get(output.rel)} and ${channel.id}`);
        seen.set(output.rel, channel.id);
      }
    }
    if (options.check) {
      const problems = checkChannels(root, channels);
      for (const problem of problems) console.log(problem);
      return problems.length > 0 ? 1 : 0;
    }
    for (const channel of channels) {
      for (const output of channel.outputs) {
        mkdirSync(dirname(output.abs), { recursive: true });
        writeFileSync(output.abs, output.content);
        console.log(`rendered ${output.rel}`);
      }
    }
    return 0;
  } catch (error) {
    console.error(`render: ${error.message}`);
    return 1;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
