const { Command } = require('commander');
const { saveConfig } = require('./config');
const ApiClient = require('./api');

const program = new Command();

program
  .name('updates')
  .description('CLI tool for updates.page - Publish changelog posts from the command line')
  .version('1.3.0');

// Shared post-field options for publish/draft/update
function withPostFieldOptions(cmd) {
  return cmd
    .option('--title <title>', 'Post title')
    .option('--content <content>', 'Post content (HTML or plain text)')
    .option('--category-id <id>', 'Category ID (see: updates categories)')
    .option('--summary <text>', 'Short summary shown in feeds and embeds')
    .option('--url <url>', 'Override URL — link this post to an external page instead')
    .option('--private', 'Hide this post from the public changelog and embeds')
    .option('--public', 'Make this post publicly visible')
    .option('--cover-image <path>', 'Image file (png/jpg/gif/webp) to set as the post cover');
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

// Parse --at values: strict ISO 8601 (date, optional time, optional zone).
// "2026-08-10 09:00" is read as local time; a trailing Z/offset is honored.
// Strict parsing matters: Date() silently normalizes impossible dates
// (2026-02-30 becomes 2026-03-02), which would schedule the wrong day.
function parseWhen(value) {
  const m = String(value).trim().match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?)?(Z|[+-]\d{2}:?\d{2})?$/
  );
  if (!m) {
    throw new Error(`Could not parse date "${value}". Use ISO 8601, e.g. 2026-08-10T09:00:00Z`);
  }
  const [, y, mo, d, h = '00', mi = '00', s = '00', frac = '', tz] = m;
  const daysInMonth = new Date(Date.UTC(+y, +mo, 0)).getUTCDate();
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > daysInMonth || +h > 23 || +mi > 59 || +s > 59) {
    throw new Error(`"${value}" is not a valid calendar date/time.`);
  }
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${frac}${tz ? (tz === 'Z' ? 'Z' : tz.replace(/(\d{2})(\d{2})$/, '$1:$2')) : ''}`);
  if (isNaN(date.getTime())) {
    throw new Error(`Could not parse date "${value}". Use ISO 8601, e.g. 2026-08-10T09:00:00Z`);
  }
  // Zone-less values are local time; a spring-forward DST gap (e.g. 02:30 on
  // the switch night) silently normalizes an hour forward — round-trip the
  // local components so a nonexistent time errors instead of shifting.
  if (!tz && (date.getFullYear() !== +y || date.getMonth() + 1 !== +mo || date.getDate() !== +d ||
              date.getHours() !== +h || date.getMinutes() !== +mi)) {
    throw new Error(`"${value}" is not a valid local time (it falls in a DST transition gap).`);
  }
  if (date.getTime() <= Date.now()) {
    console.log('  (note: that time is in the past — the post will be live immediately)');
  }
  return date.toISOString();
}

// An immediate publish gets its published_at stamped by the server, which can
// sit a few seconds ahead of the local clock — treat anything within the skew
// window as already published, not scheduled.
const CLOCK_SKEW_MS = 60 * 1000;

function isFuture(dateish) {
  return new Date(dateish).getTime() > Date.now() + CLOCK_SKEW_MS;
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
    // The server's status is authoritative; the skew-tolerant time check is
    // only a fallback for API responses that omit it.
    const scheduled = post.status ? post.status === 'Scheduled' : isFuture(when);
    console.log(`  ${scheduled ? 'Scheduled for' : 'Published'}: ${when.toLocaleString()}`);
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
  .description('Configure your API key')
  .requiredOption('--api-key <key>', 'API key for authentication')
  .action((options) => {
    try {
      saveConfig({ apiKey: options.apiKey });
      console.log('✓ Configuration saved to ~/.updatespage/config.json');
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
      let postId = id;

      if (postId) {
        // Apply any field changes before publishing the existing draft
        const changes = collectPostFields(options);
        if (Object.keys(changes).length > 0) {
          await api.updatePost(postId, changes);
        }
      } else {
        if (!options.title || !options.content) {
          throw new Error('--title and --content are required when creating a new post.');
        }
        postId = (await api.createPost(collectPostFields(options), false)).id;
      }

      // Cover upload happens while the post is still a draft: a bad path or
      // a server rejection must not leave a half-configured post live.
      if (options.coverImage) {
        try {
          await api.setCoverImage(postId, options.coverImage);
          console.log('✓ Cover image set');
        } catch (error) {
          throw new Error(
            `${error.message}\n` +
            `  The post was NOT published and is saved as a draft (ID: ${postId}).\n` +
            `  Fix the image and run: updates publish ${postId} --cover-image <path>`
          );
        }
      }

      const post = await api.publishPost(postId, publishedAt);

      // --at with a future time is the only way to schedule; anything else is
      // an immediate publish, regardless of small client/server clock skew.
      const scheduled = Boolean(publishedAt) && new Date(publishedAt).getTime() > Date.now();
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
      // Print the ID before the cover upload: if the upload fails, the draft
      // exists and the user needs the ID to retry without duplicating it.
      console.log('✓ Draft created');
      console.log(`  ID: ${post.id}`);
      console.log(`  Title: ${post.title}`);
      if (options.coverImage) {
        await api.setCoverImage(post.id, options.coverImage);
        console.log('✓ Cover image set');
      }
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
      if (Object.keys(changes).length === 0 && !options.coverImage) {
        throw new Error('Nothing to update — pass at least one field flag (see: updates update --help).');
      }
      const api = ApiClient.fromConfig();
      let post = null;
      if (Object.keys(changes).length > 0) {
        post = await api.updatePost(id, changes);
      }
      if (options.coverImage) {
        post = await api.setCoverImage(id, options.coverImage);
        console.log('✓ Cover image set');
      }
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

// Categories command group — bare `updates categories` lists (backcompat)
const categories = program
  .command('categories')
  .description('Manage categories');

categories
  .command('list', { isDefault: true })
  .description('List all categories')
  .action(async () => {
    try {
      const api = ApiClient.fromConfig();
      const list = await api.listCategories();

      if (!list || list.length === 0) {
        console.log('No categories found.');
        return;
      }

      console.log(`Found ${list.length} category(ies):\n`);
      list.forEach((c) => {
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

categories
  .command('create')
  .description('Create a category')
  .requiredOption('--name <name>', 'Category name')
  .option('--color <hex>', 'Display color, e.g. #8B5CF6')
  .action(async (options) => {
    try {
      const api = ApiClient.fromConfig();
      const data = { name: options.name };
      if (options.color !== undefined) data.color = options.color;
      const category = await api.createCategory(data);
      console.log('✓ Category created');
      console.log(`  ID: ${category.id}`);
      console.log(`  Name: ${category.name}`);
      if (category.color) console.log(`  Color: ${category.color}`);
    } catch (error) {
      fail(error);
    }
  });

categories
  .command('update')
  .description('Update a category')
  .argument('<id>', 'Category ID')
  .option('--name <name>', 'New name')
  .option('--color <hex>', 'New display color, e.g. #8B5CF6')
  .action(async (id, options) => {
    try {
      const data = {};
      if (options.name !== undefined) data.name = options.name;
      if (options.color !== undefined) data.color = options.color;
      if (Object.keys(data).length === 0) {
        throw new Error('Nothing to update — pass --name and/or --color.');
      }
      const api = ApiClient.fromConfig();
      const category = await api.updateCategory(id, data);
      console.log('✓ Category updated');
      console.log(`  ID: ${category.id}`);
      console.log(`  Name: ${category.name}`);
      if (category.color) console.log(`  Color: ${category.color}`);
    } catch (error) {
      fail(error);
    }
  });

categories
  .command('delete')
  .description('Delete a category')
  .argument('<id>', 'Category ID')
  .action(async (id) => {
    try {
      const api = ApiClient.fromConfig();
      await api.deleteCategory(id);
      console.log('✓ Category deleted');
      console.log(`  ID: ${id}`);
    } catch (error) {
      fail(error);
    }
  });

// Upload command
program
  .command('upload')
  .description('Upload an image and print its public URL (for use in post content)')
  .argument('<file>', 'Image file (png/jpg/gif/webp)')
  .action(async (file) => {
    try {
      const api = ApiClient.fromConfig();
      const result = await api.uploadImage(file);
      console.log('✓ Image uploaded');
      console.log(`  URL: ${result.url}`);
    } catch (error) {
      fail(error);
    }
  });

module.exports = program;
