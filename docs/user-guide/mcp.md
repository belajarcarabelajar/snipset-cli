# MCP server

Snipset ships a Model Context Protocol (MCP) server so an AI client can read and
edit your snippets, notes, tasks, and other data through the CLI.

## What MCP is

MCP (Model Context Protocol) is an open standard for connecting AI applications
to external systems such as local files, databases, and tools. An AI client
(the "host") speaks MCP to a "server" that exposes data and actions. Snipset is
one such server.

Source: "What is the Model Context Protocol (MCP)?",
https://modelcontextprotocol.io/introduction , retrieved 2026-10-07.

## Run the server

```sh
snipset mcp
```

This runs the MCP server over stdio: it reads requests on standard input and
writes responses on standard output. You do not run it interactively yourself;
an MCP client launches it as a subprocess and communicates over those streams.
Point it at a specific database with `--db <PATH>` if you do not want the
default.

## Connect an MCP client (opencode)

opencode (https://opencode.ai) is an MCP client. Snipset's installer can write
an opencode MCP configuration for you with the `--with-mcp` flag:

```sh
bash install-snipset.sh --version v0.2.0 --with-mcp
```

This writes `~/.config/opencode/opencode.json` only when the file does not
already exist; it never overwrites an existing configuration. The entry it
writes launches `snipset mcp` as a local (stdio) MCP server. If you already have
an opencode configuration, add a Snipset server entry to it by hand that runs
the `snipset mcp` command instead.

## Which operations work

The MCP server uses the same database access as the rest of the CLI, so
database-only operations work whether or not Snipset Desktop is running, while
bridge-dependent operations (see the [command reference](commands.md)) need the
Desktop app. Keep the app open if you want the client to use timer, generation,
or parsing features.
