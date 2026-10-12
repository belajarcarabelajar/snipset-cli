import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkSchema } from "./helpers/schema-lite.mjs";

const repo = join(import.meta.dir, "..");
const RENDER = join(repo, "scripts", "packaging", "render.mjs");
const SCHEMAS = join(repo, "tests", "fixtures", "schemas", "winget-1.12.0");
const TEMPLATES = join(repo, "packaging", "templates", "winget");

const IDENTIFIER = "BCBAcademy.SnipsetCLI";
const MANIFEST_VERSION = "1.12.0";
const LOCALE = "en-US";
const REPO_URL = "https://github.com/belajarcarabelajar/snipset-cli";
const VERSION = readFileSync(join(repo, "packaging", "VERSION"), "utf8").trim();
const WINDOWS_ASSET = `snipset-cli-v${VERSION}-x86_64-pc-windows-msvc.zip`;
const WINDOWS_URL = `${REPO_URL}/releases/download/v${VERSION}/${WINDOWS_ASSET}`;

const [publisher, packageName] = IDENTIFIER.split(".");
const MANIFEST_DIR = join(
  "packaging", "winget", "manifests", publisher[0].toLowerCase(), publisher, packageName, VERSION,
);

const MANIFESTS = [
  { type: "version", file: `${IDENTIFIER}.yaml`, schema: "manifest.version.1.12.0.json" },
  { type: "installer", file: `${IDENTIFIER}.installer.yaml`, schema: "manifest.installer.1.12.0.json" },
  { type: "defaultLocale", file: `${IDENTIFIER}.locale.${LOCALE}.yaml`, schema: "manifest.defaultLocale.1.12.0.json" },
];

const text = (m) => readFileSync(join(repo, MANIFEST_DIR, m.file), "utf8");
const parsed = (m) => Bun.YAML.parse(text(m));
const schemaOf = (m) => JSON.parse(readFileSync(join(SCHEMAS, m.schema), "utf8"));
const byType = (type) => MANIFESTS.find((m) => m.type === type);

function windowsSha() {
  const lines = readFileSync(join(repo, "packaging", "SHA256SUMS"), "utf8").split("\n");
  const line = lines.find((l) => l.endsWith(` ${WINDOWS_ASSET}`) || l.endsWith(`*${WINDOWS_ASSET}`));
  expect(line).toBeDefined();
  return line.slice(0, 64);
}

describe("winget manifests", () => {
  for (const m of MANIFESTS) {
    test(`${m.file} passes the vendored ${m.type} schema`, () => {
      const doc = parsed(m);
      expect(checkSchema(doc, schemaOf(m))).toEqual([]);
    });

    test(`${m.file} without PackageIdentifier fails the ${m.type} schema`, () => {
      const doc = parsed(m);
      delete doc.PackageIdentifier;
      const errors = checkSchema(doc, schemaOf(m));
      expect(errors.some((e) => e.includes("PackageIdentifier"))).toBe(true);
    });

    test(`${m.file} header names the ${m.type} schema`, () => {
      const [first] = text(m).split("\n");
      const url = `https://aka.ms/winget-manifest.${m.type}.${MANIFEST_VERSION}.schema.json`;
      expect(first).toBe(`# yaml-language-server: $schema=${url}`);
      // The vendored defaultLocale $id is all lower case while the contract header is camel case.
      expect(url.toLowerCase()).toBe(schemaOf(m).$id.toLowerCase());
      const doc = parsed(m);
      expect(doc.ManifestType).toBe(m.type);
      expect(doc.ManifestVersion).toBe(MANIFEST_VERSION);
    });
  }

  test("paths match the identifier and version", () => {
    const abs = join(repo, MANIFEST_DIR);
    expect(MANIFEST_DIR).toBe(join("packaging", "winget", "manifests", "b", "BCBAcademy", "SnipsetCLI", VERSION));
    expect(statSync(abs).isDirectory()).toBe(true);
    expect(readdirSync(abs).sort()).toEqual(MANIFESTS.map((m) => m.file).sort());
    for (const m of MANIFESTS) {
      const doc = parsed(m);
      expect(doc.PackageIdentifier).toBe(IDENTIFIER);
      expect(doc.PackageVersion).toBe(VERSION);
    }
    expect(parsed(byType("version")).DefaultLocale).toBe(LOCALE);
    expect(parsed(byType("defaultLocale")).PackageLocale).toBe(LOCALE);
  });

  test("the channel owns packaging/winget and names every manifest", () => {
    const target = JSON.parse(readFileSync(join(TEMPLATES, "target.json"), "utf8"));
    expect(target.owns).toBe("packaging/winget");
    const outs = target.outputs.map((o) => o.out.replaceAll("{{version}}", VERSION)).sort();
    expect(outs).toEqual(MANIFESTS.map((m) => `${MANIFEST_DIR}/${m.file}`).sort());
    for (const o of target.outputs) expect(existsSync(join(TEMPLATES, o.template))).toBe(true);
  });

  test("NestedInstallerType is present because the type is zip", () => {
    const doc = parsed(byType("installer"));
    expect(doc.InstallerType).toBe("zip");
    expect(doc.NestedInstallerType).toBe("portable");
    expect(doc.NestedInstallerFiles).toEqual([{ RelativeFilePath: "snipset.exe", PortableCommandAlias: "snipset" }]);
  });

  test("the installer points at the Windows asset with the SHA256SUMS digest", () => {
    const doc = parsed(byType("installer"));
    expect(doc.Installers).toHaveLength(1);
    const [installer] = doc.Installers;
    expect(installer.Architecture).toBe("x64");
    expect(installer.InstallerUrl).toBe(WINDOWS_URL);
    expect(typeof installer.InstallerSha256).toBe("string");
    expect(installer.InstallerSha256.toLowerCase()).toBe(windowsSha().toLowerCase());
    expect(installer.InstallerSha256).toBe(installer.InstallerSha256.toUpperCase());
  });

  test("the locale manifest carries the publisher, license, and repo links", () => {
    const doc = parsed(byType("defaultLocale"));
    expect(doc.Publisher).toBe("PT BCB Academy Indonesia");
    expect(doc.PackageName).toBe("Snipset CLI");
    expect(doc.License).toBe("Proprietary");
    expect(doc.LicenseUrl).toBe(`${REPO_URL}/blob/main/LICENSE`);
    expect(doc.Moniker).toBe("snipset");
    expect(doc.PublisherUrl).toBe(REPO_URL);
    expect(doc.PackageUrl).toBe(REPO_URL);
    expect(doc.ShortDescription.length).toBeGreaterThanOrEqual(3);
    expect(doc.ShortDescription.length).toBeLessThanOrEqual(256);
  });

  test("manifests use LF line endings and no em dash", () => {
    for (const m of MANIFESTS) {
      expect(text(m).includes("\r")).toBe(false);
      expect(text(m).includes("\u2014")).toBe(false);
    }
  });

  test("render.mjs --check --channel winget exits 0", () => {
    const result = spawnSync(process.execPath, [RENDER, "--check", "--channel", "winget"], { cwd: repo, encoding: "utf8" });
    expect(result.stdout + result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
