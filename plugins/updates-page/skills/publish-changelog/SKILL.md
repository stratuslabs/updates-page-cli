---
name: publish-changelog
description: Publish a changelog post to updates.page with the `updates` CLI. Use when the user has just shipped, released or tagged something and wants it announced, asks for release notes or a changelog entry, or mentions updates.page, the `updates` command, or their public changelog.
---

# Publishing to updates.page

A changelog post is **public, on the user's own domain, under their brand**.
Treat publishing the way you would treat a deploy, not the way you would
treat a commit.

## Draft first

Unless the user has clearly asked you to publish — "publish it", "announce
it", "ship the changelog" — write a **draft** and show it to them:

```bash
updates draft --title "…" --content "<p>…</p>" --json
```

Then tell them how to publish it: `updates publish <id>`. If you have been
asked to publish but are unsure whether the change is ready to be public,
`--private` publishes without putting it on the public changelog.

Never publish a post the user has not seen the text of.

## Signing in

```bash
updates whoami --json     # already signed in? this says who
updates login             # opens a browser; falls back to a code to type
```

`updates login` needs a human. It prints a URL and a short code — **show
them the URL** rather than describing it, and wait. On a machine with no
browser it detects that and switches to the code-entry flow by itself.

Unattended (CI, a container), the token comes from the environment instead;
never pass one as a command-line argument, where it lands in shell history
and the process list:

```bash
UPDATESPAGE_TOKEN=… updates list --json
```

## The loop

```bash
updates categories --json                     # ids to file the post under
updates draft --title "Dark mode" \
  --content "<p>Switch to dark mode from your profile menu.</p>" \
  --category-id 4 --json
```

Every command takes `--json`, which puts structured data on stdout and
nothing else — progress, warnings and prompts go to stderr. Parse the JSON;
do not scrape the human-readable output.

Other flags worth knowing: `--summary` (feeds and embeds), `--url` (link out
instead of a body), `--cover-image <path>`, `--at <ISO 8601>` to schedule.
`updates <command> --help` has the rest.

## Writing the post

You are writing for the user's customers, not for their git log.

- **Title is a headline.** "Dark mode" — not `feat(ui): add dark mode toggle (#1421)`.
- **Say what someone can now do**, not which files changed.
- **One post per shipped change**, not one per commit. Several commits that
  add one feature are one post.
- **Not everything ships to a changelog.** Internal refactors, dependency
  bumps, CI fixes and test changes do not belong on a customer-facing page.
  If a release contains only those, say so instead of inventing a post.
- **Don't invent detail.** If you cannot tell what a change does for a user
  from the diff, ask.

## When something fails

Exit codes are stable and mean one thing each. Branch on them, and on
`error.code` in the JSON — not on message text.

| Code | Meaning | What to do |
|---:|---|---|
| `0` | Success | — |
| `1` | No more specific code applied | Read the message; do not retry blindly |
| `2` | Usage — bad flag or argument | Fix the command; do not retry it unchanged |
| `3` | Configuration problem | Run `updates doctor` |
| `4` | Not signed in, or the token was refused | Run `updates login` — but see below |
| `5` | Network or server error | Retry with backoff |
| `6` | No such post/category | Re-read ids with `list` / `categories` |
| `7` | Exists, but is in the wrong state (409/422) | Fix the state or the fields; retrying unchanged will fail again |
| `130` | Cancelled | Stop |

**`7` is the one to read carefully.** It covers validation failures as well as
state conflicts — publishing a post that is already live, or sending a field
the API rejects. Both mean *change something*, not *try again*.

**`4` does not always mean "sign in again".** A token that is refused because
the account may not use the API surfaces here too. If `updates login` has
already succeeded, do not loop on it — say what happened and stop.

Under `--json` a failure is JSON on stdout too:

```json
{ "ok": false, "error": { "code": "auth.not_signed_in", "message": "…", "hint": "Run `updates login`." } }
```

**A `403` means this account may not use the API right now** — its plan or
trial does not cover it. Only the account owner can change that. Tell the
user and stop; retrying will not help.

## Calling the API directly

The CLI wraps an ordinary REST API. If you would rather call it yourself,
the specification is at `https://app.updates.page/api/openapi.json` and
authentication is `Authorization: Bearer <token>`.

Two things the specification cannot tell you, and both bite:

- **Post ids are hashids, not integers.** Round-trip them as strings.
- **Tokens are not scoped.** Every token carries its approver's full API
  access. A key marked `machine` is limited to posts, categories, uploads
  and imports — ask for one of those if a human is choosing on your behalf.

## Reading someone else's changelog

Every hosted changelog serves RSS at `/rss` and JSON at
`/api/portal/announcements` on its own domain, with no credential. That is
the cheapest way to find out what a product shipped.

More: <https://docs.updates.page/agents>
