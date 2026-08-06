const { Command } = require('commander');
const { saveConfig } = require('./config');
const ApiClient = require('./api');

const DEFAULT_BASE_URL = 'https://app.updates.page';

const program = new Command();

program
  .name('updates')
  .description('CLI tool for updates.page - Publish changelog posts from the command line')
  .version('1.0.0');

// Config command
program
  .command('config')
  .description('Configure API key and base URL')
  .requiredOption('--api-key <key>', 'API key for authentication')
  .option('--url <url>', 'Base URL of your updates.page instance', DEFAULT_BASE_URL)
  .action((options) => {
    try {
      saveConfig({
        apiKey: options.apiKey,
        baseUrl: options.url,
      });
      console.log('✓ Configuration saved to ~/.updatespage/config.json');
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Publish command
program
  .command('publish')
  .description('Create and publish a post')
  .requiredOption('--title <title>', 'Post title')
  .requiredOption('--content <content>', 'Post content')
  .option('--category-id <id>', 'Category ID (optional)')
  .action(async (options) => {
    try {
      const api = ApiClient.fromConfig();
      const data = {
        title: options.title,
        content: options.content,
      };
      if (options.categoryId) {
        data.category_id = options.categoryId;
      }

      const post = await api.createPost(data, true);
      console.log('✓ Post published');
      console.log(`  ID: ${post.id}`);
      console.log(`  Title: ${post.title}`);
      console.log(`  Published at: ${post.published_at}`);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Draft command
program
  .command('draft')
  .description('Create a draft post')
  .requiredOption('--title <title>', 'Post title')
  .requiredOption('--content <content>', 'Post content')
  .option('--category-id <id>', 'Category ID (optional)')
  .action(async (options) => {
    try {
      const api = ApiClient.fromConfig();
      const data = {
        title: options.title,
        content: options.content,
      };
      if (options.categoryId) {
        data.category_id = options.categoryId;
      }

      const post = await api.createPost(data, false);
      console.log('✓ Draft created');
      console.log(`  ID: ${post.id}`);
      console.log(`  Title: ${post.title}`);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// List command
program
  .command('list')
  .description('List posts')
  .option('--status <status>', 'Filter by status (draft|published)')
  .action(async (options) => {
    try {
      const api = ApiClient.fromConfig();
      const posts = await api.listPosts(options.status);
      
      if (!posts || posts.length === 0) {
        console.log('No posts found.');
        return;
      }

      console.log(`Found ${posts.length} post(s):\n`);
      posts.forEach((a) => {
        const status = a.published_at ? '📢 Published' : '📝 Draft';
        console.log(`${status} ${a.title}`);
        console.log(`  ID: ${a.id}`);
        if (a.published_at) {
          console.log(`  Published: ${new Date(a.published_at).toLocaleString()}`);
        }
        console.log('');
      });
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
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
      
      console.log(`Title: ${post.title}`);
      console.log(`ID: ${post.id}`);
      console.log(`Status: ${post.published_at ? 'Published' : 'Draft'}`);
      if (post.published_at) {
        console.log(`Published: ${new Date(post.published_at).toLocaleString()}`);
      }
      console.log(`\nContent:\n${post.content || '(empty)'}`);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
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
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

module.exports = program;
