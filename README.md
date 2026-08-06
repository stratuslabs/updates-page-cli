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

The CLI talks to `https://app.updates.page` by default. If you run a
self-hosted instance, pass `--url`:

```bash
updates config --api-key <your-api-key> --url https://your-instance.example.com
```

Your configuration is saved to `~/.updatespage/config.json`.

### Getting an API Key

1. Log in to your updates.page account
2. Navigate to API settings
3. Create a new API key
4. Copy the key (it will only be shown once)

## Usage

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

### List categories

View all available categories:

```bash
updates categories
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
  "apiKey": "your-api-key-here",
  "baseUrl": "https://yourdomain.updates.page"
}
```

To update your configuration, simply run the `config` command again.

## Error Handling

The CLI provides clear error messages:

- **Not configured**: Run `updates config` first
- **Invalid API key**: Check your API key in the updates.page dashboard
- **Connection refused**: Verify your base URL is correct
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
- Issues: https://github.com/stellarco/updates-page-cli/issues
- Email: support@updates.page
