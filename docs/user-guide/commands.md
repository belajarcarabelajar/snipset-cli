# Command reference

Every top-level command in `snipset 0.2.0`, with its subcommands and whether it
needs the Snipset Desktop app running. Each command also accepts the global
options `--db <PATH>`, `--json`, `-h/--help`, and `-V/--version`.

"Needs app" means the command talks to the running Desktop application over its
local bridge and fails when the app is closed. Everything else reads or writes
the database file directly.

## Setup

| Command | Purpose | Needs app |
| --- | --- | --- |
| `doctor` | Verify database access, WAL mode, and schema fingerprint. | No |
| `init` | Create a fresh standalone database for headless terminal use (`--force` to replace, backing up first). | No |

## Snippets and groups

See the [Snippets](snippets.md) page for the full workflow.

| Command | Subcommands | Needs app |
| --- | --- | --- |
| `snippet` | `list`, `get`, `search`, `expand`, `add`, `update`, `delete` | No |
| `group` | `list`, `add` | No |
| `import` | (takes a `.json` or `.csv` file) | No |
| `export` | (writes JSON or CSV) | No |

## Clipboard

Read clipboard history. `clear` needs the app.

| Subcommand | Purpose | Needs app |
| --- | --- | --- |
| `list` | List clipboard history, optionally filtered. | No |
| `get` | Print one entry by id, including its tags. | No |
| `search` | Substring search over clipboard content. | No |
| `delete` | Delete one entry by id. | No |
| `favorite` | Mark or unmark an entry as a favorite. | No |
| `update` | Replace the content of one entry. | No |
| `tag` | Inspect and edit clipboard tags. | No |
| `clear` | Delete all clipboard history (requires the running app and `--yes`). | Yes |
| `export` | Export clipboard history as JSON. | No |

## Audio

Read speech-to-text and text-to-speech history and the speech dictionary.

| Subcommand | Purpose | Needs app |
| --- | --- | --- |
| `history` | Speech-to-text and text-to-speech history. | No |
| `dictionary` | Inspect and edit the speech dictionary. | No |
| `tts` | Text-to-speech history. | No |
| `stats` | Aggregate audio statistics. | No |

## Journal

| Subcommand | Purpose | Needs app |
| --- | --- | --- |
| `list` | List journals, newest date first. | No |
| `get` | Print one journal by id or date (exactly one required). | No |
| `generate` | Generate a journal through the running app. | Yes |
| `update` | Replace the rendered text of a journal. | No |
| `delete` | Delete a journal (requires `--yes`). | No |
| `export` | Export journals as JSON. | No |

## Tasks

| Subcommand | Purpose | Needs app |
| --- | --- | --- |
| `list` | List tasks, excluding completed ones unless `--include-completed`. | No |
| `create` | Create a task. | No |
| `update` | Update fields of a task. | No |
| `complete` | Mark a task completed. | No |
| `delete` | Soft-delete a task (requires `--yes`). | No |
| `reorder` | Assign ascending order to the given task ids. | No |
| `get` | Print one task by id. | No |
| `subtasks` | List the direct subtasks of a task. | No |
| `stats` | Aggregate task counts. | No |
| `parse` | Parse task text into structured fields through the running app. | Yes |
| `project` | Inspect task projects. | No |
| `folder` | Inspect task smart folders. | No |

## Notes

| Subcommand | Purpose | Needs app |
| --- | --- | --- |
| `list` | List notes, excluding archived ones unless requested. | No |
| `get` | Print one note by id. | No |
| `search` | Substring search over title and content. | No |
| `count` | Count notes by state. | No |
| `stats` | Aggregate note statistics. | No |
| `create` | Create a note. | No |
| `update` | Update fields of a note. | No |
| `pin` | Set or clear the pinned flag. | No |
| `archive` | Set or clear the archived flag. | No |
| `delete` | Soft-delete a note (requires `--yes`). | No |
| `title` | Generate and print a title through the running app. | Yes |
| `labels` | Generate and print labels through the running app. | Yes |

## Pomodoro

The whole group reads and controls the Pomodoro timer through the running app,
so every subcommand needs the Desktop app.

| Subcommand | Purpose | Needs app |
| --- | --- | --- |
| `status` | Show the current phase and remaining time. | Yes |
| `config` | Show timer configuration. | Yes |
| `start` | Start the timer. | Yes |
| `pause` | Pause the timer. | Yes |
| `resume` | Resume the timer. | Yes |
| `stop` | Stop the timer. | Yes |
| `skip` | Skip the current phase. | Yes |
| `sessions` | List completed sessions. | Yes |

## Statistics

Read-only statistics over the local database. None need the app.

| Subcommand | Purpose |
| --- | --- |
| `overview` | Cross-feature counters. |
| `snippets` | Snippet and usage metrics. |
| `clipboard` | Clipboard metrics. |
| `ai` | AI and embedding metrics. |
| `tracker` | Digital tracker metrics from the analytics ledger. |
| `tasks` | Task metrics. |
| `notes` | Note metrics. |
| `audio` | Audio metrics. |
| `all` | Every section except vault and pomodoro. |

```sh
snipset stats overview --db /tmp/demo.db
```

## Reference and support

| Command | Subcommands | Needs app |
| --- | --- | --- |
| `reference` | `list` (list reference topics) | No |
| `support` | `categories` (list categories); `submit` (submit a ticket; prints the payload and endpoint unless `--yes`) | `submit` reaches a network endpoint |

## Settings

Read and write app settings. Secret values are masked on read.

| Subcommand | Purpose | Needs app |
| --- | --- | --- |
| `list` | List settings with secret values masked. | No |
| `get` | Print one setting, masking secrets. | No |
| `set` | Write one setting. | No |
| `unset` | Remove one setting. | No |
| `export` | Print every setting as JSON with secrets masked. | No |

## MCP

| Command | Purpose | Needs app |
| --- | --- | --- |
| `mcp` | Run the Model Context Protocol server over stdio. See the [MCP guide](mcp.md). | No |
