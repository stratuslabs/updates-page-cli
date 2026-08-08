# updates.page CLI

Official command-line tool for [updates.page](https://updates.page) - Publish changelog posts from your terminal.

## Installation

```bash
npm install -g @updatespage/cli
```

Or use directly with `npx`:

```bash
npx @updatespage/cli <command>
```

## Setup

Before using the CLI, configure your API key:

```bash
updates config --api-key <your-api-key>
```

Your configuration is saved to `~/.updatespage/config.json`.

### Getting an API Key

1. Log in to your updates.page account
2. Navigate to API settings
3. Create a new API key
4. Copy the key (it will only be shown once)

## Usage

### Post options

`publish`, `draft`, and `update` all accept the same field flags:

| Flag | Effect |
|---|---|
| `--title <title>` | Post title |
| `--content <content>` | Post body (HTML or plain text) |
| `--category-id <id>` | Category (find IDs with `updates categories`) |
| `--summary <text>` | Short summary shown in feeds and embeds |
| `--url <url>` | Override URL — link the post to an external page |
| `--private` / `--public` | Hide from / show on the public changelog |
| `--cover-image <path>` | Set a cover image from a local file (png/jpg/gif/webp) |

### Schedule a post

```bash
updates publish --title "Big launch" --content "<p>Coming soon</p>" --at "2026-09-01T09:00:00Z"
```

Publish an existing draft (optionally scheduling it):

```bash
updates publish <post-id> --at "2026-09-01T09:00:00Z"
```

### Update, unpublish, delete

```bash
updates update <post-id> --summary "Better summary" --private
updates unpublish <post-id>   # revert to draft
updates delete <post-id>
```

### Publish a post

Create and immediately publish a post:

```bash
updates publish --title "v2.1.0 Released" --content "We've added dark mode and improved performance."
```

With a specific category:

```bash
updates publish \
  --title "v2.1.0 Released" \
  --content "New features and improvements" \
  --category-id 123
```

### Create a draft

Create a post without publishing:

```bash
updates draft --title "Upcoming Feature" --content "Coming soon..."
```

### List posts

List all posts:

```bash
updates list
```

Filter by status:

```bash
updates list --status published
updates list --status draft
```

### Get a single post

Retrieve details for a specific post:

```bash
updates get <post-id>
```

### Manage categories

```bash
updates categories                                   # list
updates categories create --name "Security" --color "#8B5CF6"
updates categories update <id> --name "New name"
updates categories delete <id>
```

### Upload images

Upload an image and get a public URL to use in post content:

```bash
updates upload screenshot.png
# ✓ Image uploaded
#   URL: https://...

updates publish --title "New dashboard" \
  --content '<p>Fresh look:</p><img src="https://..." alt="Dashboard">'
```

Or set a post's cover image directly:

```bash
updates publish --title "v2.0" --content "<p>Big release</p>" --cover-image hero.png
```

## Examples

### Quick publish

```bash
updates publish \
  --title "Security Update" \
  --content "Fixed a critical vulnerability in authentication."
```

### Create a detailed draft

```bash
updates draft \
  --title "Q1 2024 Roadmap" \
  --content "Here's what we're planning for the first quarter..."
```

### Check recent posts

```bash
updates list --status published
```

## Configuration

The CLI stores your configuration in `~/.updatespage/config.json`:

```json
{
  "apiKey": "your-api-key-here"
}
```

To update your configuration, simply run the `config` command again.

## Error Handling

The CLI provides clear error messages:

- **Not configured**: Run `updates config` first
- **Invalid API key**: Check your API key in the updates.page dashboard
- **HTTP errors**: The API error message will be displayed

## Requirements

- Node.js 20.0.0 or higher

## Development

### Local testing

```bash
# Install dependencies
npm install

# Run locally
node bin/updates.js --help
```

### Link for local testing

```bash
npm link
updates --help
```

## License

MIT

## Support

- Documentation: https://updates.page/docs
- Issues: https://github.com/stratuslabs/updates-page-cli/issues
- Email: support@updates.page
