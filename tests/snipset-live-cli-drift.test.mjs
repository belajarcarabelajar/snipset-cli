import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { snipsetSkip } from "./snipset-bin.mjs";

const run = promisify(execFile);

// Mirrors the read allowlist in scripts/snipset-live.sh, taken from snipset 0.2.0 --help.
const groups = {
  snippet: { reads: ["list", "get", "search", "expand"], writes: ["add", "update", "delete"], subgroups: [] },
  group: { reads: ["list"], writes: ["add"], subgroups: [] },
  stats: {
    reads: ["overview", "snippets", "clipboard", "ai", "tracker", "tasks", "notes", "audio", "all"],
    writes: [],
    subgroups: [],
  },
  reference: { reads: ["list"], writes: [], subgroups: [] },
  clipboard: {
    reads: ["list", "get", "search", "export"],
    writes: ["delete", "favorite", "update", "clear"],
    subgroups: ["tag"],
  },
  "clipboard tag": { reads: ["list"], writes: ["add", "remove", "set-color"], subgroups: [] },
  audio: { reads: ["stats"], writes: [], subgroups: ["history", "dictionary", "tts"] },
  "audio history": { reads: ["list", "get"], writes: ["delete", "clear", "save"], subgroups: [] },
  "audio dictionary": { reads: ["list"], writes: ["add", "remove", "approve"], subgroups: [] },
  "audio tts": { reads: ["list"], writes: [], subgroups: [] },
};

function listedSubcommands(helpText) {
  const lines = helpText.split("\n");
  const start = lines.findIndex((line) => line.trim() === "Commands:");
  if (start === -1) return null;
  const names = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^\s+(\S+)/.exec(line);
    if (!match) break;
    if (match[1] !== "help") names.push(match[1]);
  }
  return names;
}

for (const [group, table] of Object.entries(groups)) {
  test(`snipset ${group} lists no subcommand the wrapper does not classify`, { skip: snipsetSkip }, async () => {
    const { stdout } = await run("snipset", [...group.split(" "), "--help"], { timeout: 10_000 });
    const listed = listedSubcommands(stdout);
    assert.ok(listed && listed.length > 0, `no Commands: section parsed from \`snipset ${group} --help\``);
    const known = new Set([...table.reads, ...table.writes, ...table.subgroups]);
    const unknown = listed.filter((name) => !known.has(name));
    assert.deepEqual(
      unknown,
      [],
      `\`snipset ${group}\` lists unclassified subcommand(s): ${unknown.join(", ")}. ` +
        `Classify each as read or write in scripts/snipset-live.sh and in the table in tests/snipset-live-cli-drift.test.mjs.`
    );
  });
}
