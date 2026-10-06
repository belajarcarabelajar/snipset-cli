# Getting started

This page takes you from a freshly installed binary to your first working
snippet. It assumes `snipset` is already on your `PATH` (see the
[repository README](../../README.md) for installation).

## 1. Confirm the binary

```sh
snipset --version
```

You should see `snipset 0.2.0` or newer. The global options available on every
command are:

| Option | Effect |
| --- | --- |
| `--db <PATH>` | Use a specific SQLite database instead of the default application data directory. |
| `--json` | Emit machine-readable JSON instead of human-readable text. |
| `-h`, `--help` | Print help for the command or subcommand. |
| `-V`, `--version` | Print the version. |

## 2. Create a database

The CLI works against a standalone database you create, or an existing
compatible database created by Snipset Desktop. It never migrates a schema it
does not own. For headless terminal use, create your own:

```sh
snipset init
```

To create a throwaway database somewhere specific, pass `--db`:

```sh
snipset init --db /tmp/demo.db
```

`init` refuses to overwrite an existing file. Use `--force` to replace one; the
current file (plus its WAL sidecars) is renamed to a timestamped backup first
and never deleted.

## 3. Check it

```sh
snipset doctor --db /tmp/demo.db
```

```
database: /tmp/demo.db
exists: true
journal_mode: wal
schema_match: true
```

`doctor` verifies database access, WAL mode, and the schema fingerprint. A
`schema_match: true` line means the CLI recognizes the schema and is safe to
use against it.

## 4. Create your first snippet

Snippets live in groups. Create a group, then a snippet in it:

```sh
snipset group add --db /tmp/demo.db --name "Email" --description "Email templates"
snipset snippet add --db /tmp/demo.db \
  --name "Signature" --keyword ";sig" --content "Best regards,
Iwan" --group "Email"
```

Each command prints the new record's UUID. List what you have:

```sh
snipset snippet list --db /tmp/demo.db
```

```
c547984e-897e-4a50-9958-4656716386c7	;sig	Signature
```

Add `--json` for structured output you can pipe into other tools:

```sh
snipset snippet list --db /tmp/demo.db --json
```

## 5. Know what needs the Desktop app

Two kinds of commands exist:

- **Database-only commands** read and write the SQLite file directly. They work
  whether or not Snipset Desktop is running. All snippet, group, settings,
  import, export, and `stats` commands, plus most read commands, are in this
  group.
- **Bridge commands** talk to the running Desktop application. These include the
  whole `pomodoro` group, `journal generate`, `note title`/`labels`,
  `task parse`, `clipboard clear`, and the `support submit` ticket endpoint.
  They fail when the app is closed.

The [command reference](commands.md) marks every command's requirement.

## Next steps

- Build real snippet workflows in [Snippets](snippets.md).
- Browse every command in the [command reference](commands.md).
- Let an AI client drive the CLI through the [MCP server](mcp.md).
- Read your running Desktop database safely with the [live database](live-database.md) wrapper.
