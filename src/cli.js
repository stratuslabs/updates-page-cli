const { Command } = require('commander');
const { saveConfig, loadConfig } = require('./config');
const ApiClient = require('./api');

const DEFAULT_BASE_URL = 'https://app.updates.page';

const program = new Command();

program
  .name('updates')
  .description('CLI tool for updates.page - Publish changelog posts from the command line')
  .version('1.1.0');

// Shared post-field options for publish/draft/update
function withPostFieldOptions(cmd) {
  return cmd
    .option('--title <title>', 'Post title')
    .option('--content <content>', 'Post content (HTML or plain text)')
    .option('--category-id <id>', 'Category ID (see: updates categories)')
    .option('--summary <text>', 'Short summary shown in feeds and embeds')
    .option('--url <url>', 'Override URL — link this post to an external page instead')
    .option('--private', 'Hide this post from the public changelog and embeds')
    .option('--public', 'Make this post publicly visible');
}

function collectPostFields(options) {
  if (options.private && options.public) {
    throw new Error('--private and --public are mutually exclusive.');
  }
  const data = {};
  if (options.title !== undefined) data.title = options.title;
  if (options.content !== undefined) data.content = options.content;
  if (options.categoryId !== undefined) data.category_id = options.categoryId;
  if (options.summary !== undefined) data.summary = options.summary;
  if (options.url !== undefined) data.override_url = options.url;
  if (options.private) data.is_public = false;
  if (options.public) data.is_public = true;
  return data;
}

// Parse --at values: ISO 8601 or anything Date can read (e.g. "2026-08-10 09:00" local time)
function parseWhen(value) {
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new Error(`Could not parse date "${value}". Use ISO 8601, e.g. 2026-08-10T09:00:00Z`);
  }
  if (date.getTime() <= Date.now()) {
    console.log('  (note: that time is in the past — the post will be live immediately)');
  }
  return date.toISOString();
}

function statusLine(post) {
  const icons = { Draft: '📝', Scheduled: '🗓', Published: '📢' };
  const status = post.status || (post.published_at ? 'Published' : 'Draft');
  const priv = post.is_public === false ? ' 🔒 private' : '';
  return `${icons[status] || ''} ${status}${priv}`;
}

function printPost(post, verbose = false) {
  console.log(`${statusLine(post)} ${post.title}`);
  console.log(`  ID: ${post.id}`);
  if (post.published_at) {
    const when = new Date(post.published_at);
    const label = when.getTime() > Date.now() ? 'Scheduled for' : 'Published';
    console.log(`  ${label}: ${when.toLocaleString()}`);
  }
  if (verbose) {
    if (post.summary) console.log(`  Summary: ${post.summary}`);
    if (post.override_url) console.log(`  Override URL: ${post.override_url}`);
    if (post.category && post.category.name) console.log(`  Category: ${post.category.name}`);
    if (post.portal_url) console.log(`  Portal URL: ${post.portal_url}`);
    console.log(`\nContent:\n${post.content || '(empty)'}`);
  }
}

function fail(error) {
  console.error('Error:', error.message);
  process.exit(1);
}

// Config command
program
  .command('config')
  .description('Configure API key and base URL')
  .requiredOption('--api-key <key>', 'API key for authentication')
  .option('--url <url>', `Base URL of your updates.page instance (default: ${DEFAULT_BASE_URL})`)
  .action((options) => {
    try {
      // No Commander default for --url: rotating just the API key must not
      // silently repoint an existing self-hosted config at the hosted service.
      let existing = null;
      try { existing = loadConfig(); } catch { /* corrupt config — start fresh */ }
      const baseUrl = options.url || existing?.baseUrl || DEFAULT_BASE_URL;
      saveConfig({
        apiKey: options.apiKey,
        baseUrl,
      });
      console.log('✓ Configuration saved to ~/.updatespage/config.json');
      console.log(`  API base URL: ${baseUrl}`);
    } catch (error) {
      fail(error);
    }
  });

// Publish command — create-and-publish, or publish an existing draft by id
withPostFieldOptions(
  program
    .command('publish')
    .description('Publish a post — create one, or publish an existing draft by ID')
    .argument('[id]', 'Existing draft ID to publish (omit to create a new post)')
    .option('--at <datetime>', 'Schedule: go live at this time instead of now')
)
  .action(async (id, options) => {
    try {
      const api = ApiClient.fromConfig();
      const publishedAt = options.at ? parseWhen(options.at) : null;
      let post;

      if (id) {
        // Publish an existing draft, applying any field changes first
        const changes = collectPostFields(options);
        if (Object.keys(changes).length > 0) {
          await api.updatePost(id, changes);
        }
        post = await api.publishPost(id, publishedAt);
      } else {
        if (!options.title || !options.content) {
          throw new Error('--title and --content are required when creating a new post.');
        }
        const data = collectPostFields(options);
        post = await api.createPost(data, publishedAt || true);
      }

      const scheduled = post.published_at && new Date(post.published_at).getTime() > Date.now();
      console.log(scheduled ? '✓ Post scheduled' : '✓ Post published');
      console.log(`  ID: ${post.id}`);
      console.log(`  Title: ${post.title}`);
      console.log(`  ${scheduled ? 'Goes live' : 'Published'} at: ${post.published_at}`);
    } catch (error) {
      fail(error);
    }
  });

// Draft command
withPostFieldOptions(
  program
    .command('draft')
    .description('Create a draft post')
)
  .action(async (options) => {
    try {
      if (!options.title || !options.content) {
        throw new Error('--title and --content are required.');
      }
      const api = ApiClient.fromConfig();
      const post = await api.createPost(collectPostFields(options), false);
      console.log('✓ Draft created');
      console.log(`  ID: ${post.id}`);
      console.log(`  Title: ${post.title}`);
    } catch (error) {
      fail(error);
    }
  });

// Update command
withPostFieldOptions(
  program
    .command('update')
    .description('Update fields on an existing post')
    .argument('<id>', 'Post ID')
)
  .action(async (id, options) => {
    try {
      const changes = collectPostFields(options);
      if (Object.keys(changes).length === 0) {
        throw new Error('Nothing to update — pass at least one field flag (see: updates update --help).');
      }
      const api = ApiClient.fromConfig();
      const post = await api.updatePost(id, changes);
      console.log('✓ Post updated');
      printPost(post);
    } catch (error) {
      fail(error);
    }
  });

// Unpublish command
program
  .command('unpublish')
  .description('Revert a published or scheduled post to a draft')
  .argument('<id>', 'Post ID')
  .action(async (id) => {
    try {
      const api = ApiClient.fromConfig();
      await api.unpublishPost(id);
      console.log('✓ Post reverted to draft');
      console.log(`  ID: ${id}`);
    } catch (error) {
      fail(error);
    }
  });

// Delete command
program
  .command('delete')
  .description('Delete a post permanently')
  .argument('<id>', 'Post ID')
  .action(async (id) => {
    try {
      const api = ApiClient.fromConfig();
      await api.deletePost(id);
      console.log('✓ Post deleted');
      console.log(`  ID: ${id}`);
    } catch (error) {
      fail(error);
    }
  });

// List command
program
  .command('list')
  .description('List posts')
  .option('--status <status>', 'Filter by status (draft|scheduled|published)')
  .action(async (options) => {
    try {
      const api = ApiClient.fromConfig();
      const posts = await api.listPosts(options.status);

      if (!posts || posts.length === 0) {
        console.log('No posts found.');
        return;
      }

      console.log(`Found ${posts.length} post(s):\n`);
      posts.forEach((post) => {
        printPost(post);
        console.log('');
      });
    } catch (error) {
      fail(error);
    }
  });

// Get command
program
  .command('get')
  .description('Get a single post by ID')
  .argument('<id>', 'Post ID')
  .action(async (id) => {
    try {
      const api = ApiClient.fromConfig();
      const post = await api.getPost(id);
      printPost(post, true);
    } catch (error) {
      fail(error);
    }
  });

// Categories command
program
  .command('categories')
  .description('List all categories')
  .action(async () => {
    try {
      const api = ApiClient.fromConfig();
      const categories = await api.listCategories();

      if (!categories || categories.length === 0) {
        console.log('No categories found.');
        return;
      }

      console.log(`Found ${categories.length} category(ies):\n`);
      categories.forEach((c) => {
        console.log(`${c.name}`);
        console.log(`  ID: ${c.id}`);
        if (c.color) {
          console.log(`  Color: ${c.color}`);
        }
        console.log('');
      });
    } catch (error) {
      fail(error);
    }
  });

module.exports = program;
