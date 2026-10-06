# Snipset CLI User Guide

A task-oriented guide to the `snipset` terminal companion. For installing,
updating, and uninstalling the binary, see the [repository README](../../README.md);
this guide covers what to do once `snipset` is on your `PATH`.

Written against `snipset 0.2.0`. Confirm your version with `snipset --version`;
if yours differs, trust `snipset <command> --help` over this page.

## Pages

| Page | What it covers |
| --- | --- |
| [Getting started](getting-started.md) | Create a standalone database, run your first commands, understand what needs the Desktop app. |
| [Snippets](snippets.md) | The core workflow: groups, add, list, search, expand, update, delete, import, and export. |
| [Command reference](commands.md) | Every top-level command and subcommand, with the bridge requirement for each. |
| [MCP server](mcp.md) | Run the Model Context Protocol server so an AI client can read and edit your snippets. |
| [Live database](live-database.md) | Query the running Snipset Desktop database safely with the live wrapper. |

## Conventions used in this guide

- Every command accepts two global options: `--db <PATH>` to point at a specific
  SQLite database, and `--json` to emit machine-readable output instead of text.
- Examples that write data use a throwaway database under `/tmp` so you can copy
  them without touching real data. Drop the `--db` flag to use your default
  database.
- "Needs the Desktop app" marks a command that talks to the running Snipset
  Desktop application over its local bridge. These fail when the app is closed.
  Everything else works directly against the database file.
