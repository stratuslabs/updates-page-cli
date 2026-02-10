# updates.page CLI

Official command-line tool for [updates.page](https://updates.page) - Publish announcements from your terminal.

## Installation

```bash
npm install -g @updatespage/cli
```

Or use directly with `npx`:

```bash
npx @updatespage/cli <command>
```

## Setup

Before using the CLI, you need to configure your API key and instance URL:

```bash
updates config --api-key <your-api-key> --url https://yourdomain.updates.page
```

Your configuration is saved to `~/.updatespage/config.json`.

### Getting an API Key

1. Log in to your updates.page account
2. Navigate to API settings
3. Create a new API key
4. Copy the key (it will only be shown once)

## Usage

### Publish an announcement

Create and immediately publish an announcement:

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

Create an announcement without publishing:

```bash
updates draft --title "Upcoming Feature" --content "Coming soon..."
```

### List announcements

List all announcements:

```bash
updates list
```

Filter by status:

```bash
updates list --status published
updates list --status draft
```

### Get a single announcement

Retrieve details for a specific announcement:

```bash
updates get <announcement-id>
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

### Check recent announcements

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

- Node.js 18.0.0 or higher

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
