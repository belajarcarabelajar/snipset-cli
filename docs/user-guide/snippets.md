# Snippets

Snippets are the core of Snipset: short keywords that expand into longer text.
This page covers the full snippet lifecycle, grounded in `snipset 0.2.0`.
Every example uses a throwaway `/tmp/demo.db`; drop `--db` to use your default
database.

## Groups

Every snippet belongs to a group. List and create groups with `snipset group`:

```sh
snipset group list --db /tmp/demo.db
snipset group add --db /tmp/demo.db --name "Email" --description "Email templates"
```

`group add` prints the new group's UUID. You can refer to a group later by
either its UUID or its name.

## Create a snippet

```sh
snipset snippet add --db /tmp/demo.db \
  --name "Signature" --keyword ";sig" --content "Best regards," --group "Email"
```

`--name`, `--keyword`, and `--content` are required. The optional fields:

| Option | Effect | Default |
| --- | --- | --- |
| `--description <TEXT>` | Optional description. | `""` |
| `--group <GROUP>` | Group UUID or group name. | (none) |
| `--matching-mode <MODE>` | `strict` or `loose`. | `strict` |
| `--case-sensitivity <MODE>` | `case-sensitive` or `case-insensitive`. | `case-sensitive` |
| `--disabled` | Create the snippet disabled. | enabled |

## List and filter

```sh
snipset snippet list --db /tmp/demo.db
```

Narrow the list with filters:

| Option | Effect |
| --- | --- |
| `--group <GROUP>` | Filter by group UUID or name. |
| `--enabled` | Only enabled snippets. |
| `--favorite` | Only favorite snippets. |
| `--limit <N>` | Maximum rows to return (default 100). |
| `--offset <N>` | Rows to skip (default 0). |

The default text output is tab-separated `uuid	keyword	name`. Add `--json`
for the full record, including matching mode, case sensitivity, group id,
timestamps, and attachment count.

## Read one snippet

```sh
snipset snippet get --db /tmp/demo.db <uuid>
```

## Search

Full-text search over your snippets:

```sh
snipset snippet search --db /tmp/demo.db "regards"
```

## Expand template variables

A snippet's content can contain template variables such as `#{date}` and
`#{clipboard}`. `snippet expand` renders them. This is a read-only operation and
never modifies anything.

```sh
snipset snippet expand --db /tmp/demo.db <uuid>
snipset snippet expand --db /tmp/demo.db --by-keyword ";sig"
```

| Option | Effect |
| --- | --- |
| `--by-keyword` | Look the snippet up by keyword instead of UUID. |
| `--clipboard <VALUE>` | Value used for `#{clipboard}` and `#{selection}` (default `""`). |

## Update and delete

```sh
snipset snippet update --db /tmp/demo.db <uuid> --content "Kind regards,"
snipset snippet update --db /tmp/demo.db <uuid> --enabled
snipset snippet delete --db /tmp/demo.db <uuid>
```

`update` takes the same field options as `add`, each as a "new" value, plus
`--enabled` and `--disabled` to toggle state. Only the fields you pass change.

## Bulk import and export

Import snippets from a `.json` or `.csv` file:

```sh
snipset import --db /tmp/demo.db snippets.json
snipset import --db /tmp/demo.db --dry-run snippets.csv
```

| Option | Effect |
| --- | --- |
| `--dry-run` | Parse, validate, and report without writing. |
| `--group <GROUP>` | Group assigned to rows that do not name their own group. |
| `--on-duplicate <MODE>` | `skip` (default), `update`, or `fail` when a keyword already exists in the same group. |

Export the other direction:

```sh
snipset export --db /tmp/demo.db
snipset export --db /tmp/demo.db --format csv --out snippets.csv
snipset export --db /tmp/demo.db --group "Email" --format json
```

| Option | Effect | Default |
| --- | --- | --- |
| `--group <GROUP>` | Filter by group UUID or name. | all groups |
| `--format <FORMAT>` | `json` or `csv`. | `json` |
| `--out <FILE>` | Write to a file instead of standard output. | stdout |

## Where to go next

- See every other feature in the [command reference](commands.md).
- Read snippets from a running Desktop app with the [live database](live-database.md) wrapper.
