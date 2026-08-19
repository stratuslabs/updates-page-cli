# updates.page CLI

Publish changelog posts to [updates.page](https://updates.page) from your terminal.

```bash
npm install -g @updatespage/cli
updates login
updates publish --title "Dark mode" --content "<p>It's here.</p>"
```

## Signing in

```bash
updates login
```

Opens your browser, you approve, done. On a machine without one — an SSH
session, a container, CI — it detects that and shows a short code to enter
from any other device instead.

For unattended use, read a token from stdin so it never appears in your shell
history or in the process list:

```bash
updates login --token - < token.txt
# or
UPDATESPAGE_TOKEN=... updates list
```

Tokens are stored in `~/.updatespage/credentials.json` with `0600`
permissions, and are only ever sent to the endpoint that issued them. Sign out
with `updates logout`, which revokes the token server-side rather than only
deleting the local copy.

Keep separate accounts side by side with `--profile`:

```bash
updates login --profile work
updates list --profile work
```

API access requires the Pro plan or above.

## Commands

| Command | What it does |
|---|---|
| `updates publish [id]` | Create and publish a post, or publish an existing draft |
| `updates draft` | Create a post without publishing it |
| `updates update <id>` | Change fields on an existing post |
| `updates unpublish <id>` | Revert a published or scheduled post to a draft |
| `updates delete <id>` | Delete a post permanently |
| `updates list` | List your posts |
| `updates get <id>` | Show one post in full |
| `updates categories` | List categories (`create`, `update`, `delete` too) |
| `updates upload <file>` | Upload an image and print its URL |
| `updates login` / `logout` / `whoami` | Sign in, out, and check who you are |
| `updates doctor` | Show the resolved setup and where each value came from |

Run `updates <command> --help` for the details of any one.

### Post fields

`publish`, `draft`, and `update` share these:

| Flag | Effect |
|---|---|
| `--title <title>` | Post title |
| `--content <html>` | Post body (HTML or plain text) |
| `--category-id <id>` | File under a category (ids from `updates categories`) |
| `--summary <text>` | Short summary shown in feeds and embeds |
| `--url <url>` | Link the post to an external page instead |
| `--private` / `--public` | Hide from / show on the public changelog |
| `--cover-image <path>` | Set the cover from a local png/jpg/gif/webp |

### Scheduling

```bash
updates publish --title "Big launch" --content "<p>Soon</p>" --at 2026-09-01T09:00:00Z
updates publish 123 --at 2026-09-01T09:00:00Z
```

`--at` takes ISO 8601. A value without a timezone is read as local time.
Parsing is deliberately strict: `2026-02-30` is rejected rather than quietly
becoming March 2, and a time that falls in a daylight-saving gap is an error
rather than a silent hour's shift.

## Scripting

Every command takes `--json`, which puts structured data on stdout and nothing
else — progress, warnings and prompts all go to stderr:

```bash
updates list --status draft --json | jq -r '.posts[].id'
updates upload shot.png --json | jq -r .url
```

Failures exit with a code that says what went wrong, so a script can tell
"sign in again" from "the network is down":

| Code | Meaning |
|---:|---|
| `0` | Success |
| `2` | Usage — unknown flag, missing argument, bad value |
| `3` | Configuration problem |
| `4` | Not signed in, or the token was rejected |
| `5` | Network failure or server error |
| `6` | The thing you named does not exist |
| `130` | Cancelled (Ctrl-C) |

Under `--json`, a failure is JSON on stdout too:

```json
{ "ok": false, "error": { "code": "auth.not_signed_in", "message": "…", "hint": "Run `updates login`." } }
```

Other global flags: `--quiet`, `--verbose`, `--no-color`, `--yes`, `--profile`.
Colour is disabled automatically when the output is not a terminal, and
`NO_COLOR` is honoured.

## Upgrading from 1.x

**Every command, flag and argument still works.** The things to know:

- **`updates config --api-key` is deprecated** but still works. It warns and
  points at `updates login`. A key typed on the command line is saved in your
  shell history and is visible to other processes, which is the whole reason
  the browser flow exists.
- **Your existing key keeps working.** `~/.updatespage/config.json` is still
  read, so upgrading does not sign you out. Signing in again writes the newer
  `credentials.json` and the old file stops being consulted. `updates doctor`
  will tell you which one is in use.
- **`list` and `get` render differently.** `list` is now a table; `get` is a
  field list followed by the content. If you were scraping either, use
  `--json` instead — that is what it is for.
- **Node `>=22.13 <23 || >=23.4` is required** (1.x needed 18+). The gap is
  real, not a typo: 23.0–23.3 are newer than the 22.13 floor and still lack
  what it provides.

## Troubleshooting

```bash
updates doctor
```

Prints the endpoint, config file, credential store and its permissions, and
crucially *where each value came from* — a flag, an environment variable, or a
default. Most "it works on my machine but not in CI" reports are answered by
that one line. It exits non-zero if anything is wrong, so it also works as a
health check.

## Development

```bash
npm install
npm run build      # tsc
npm run typecheck  # includes the tests
npm test           # node --test, in-process, no network
npm run updates -- list   # run from source
```

Tests drive the real entry point with fake streams and a temp home directory —
nothing is spawned and nothing touches the network. `--base-url` (or
`UPDATESPAGE_BASE_URL`) points the CLI at a local Rails app.

Built with [cli-kit](https://github.com/stratuslabs/cli-kit). `src/kit/` is
that framework, unmodified, so improvements can be pulled from upstream;
`src/commands/` is this CLI.

## Licence

MIT.
