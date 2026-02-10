const { Command } = require('commander');
const { saveConfig, loadConfig } = require('./config');
const ApiClient = require('./api');

const program = new Command();

program
  .name('updates')
  .description('CLI tool for updates.page - Publish announcements from the command line')
  .version('1.0.0');

// Config command
program
  .command('config')
  .description('Configure API key and base URL')
  .requiredOption('--api-key <key>', 'API key for authentication')
  .requiredOption('--url <url>', 'Base URL of your updates.page instance')
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
  .description('Create and publish an announcement')
  .requiredOption('--title <title>', 'Announcement title')
  .requiredOption('--content <content>', 'Announcement content')
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

      const announcement = await api.createAnnouncement(data, true);
      console.log('✓ Announcement published');
      console.log(`  ID: ${announcement.id}`);
      console.log(`  Title: ${announcement.title}`);
      console.log(`  Published at: ${announcement.published_at}`);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Draft command
program
  .command('draft')
  .description('Create a draft announcement')
  .requiredOption('--title <title>', 'Announcement title')
  .requiredOption('--content <content>', 'Announcement content')
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

      const announcement = await api.createAnnouncement(data, false);
      console.log('✓ Draft created');
      console.log(`  ID: ${announcement.id}`);
      console.log(`  Title: ${announcement.title}`);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// List command
program
  .command('list')
  .description('List announcements')
  .option('--status <status>', 'Filter by status (draft|published)')
  .action(async (options) => {
    try {
      const api = ApiClient.fromConfig();
      const announcements = await api.listAnnouncements(options.status);
      
      if (!announcements || announcements.length === 0) {
        console.log('No announcements found.');
        return;
      }

      console.log(`Found ${announcements.length} announcement(s):\n`);
      announcements.forEach((a) => {
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
  .description('Get a single announcement by ID')
  .argument('<id>', 'Announcement ID')
  .action(async (id) => {
    try {
      const api = ApiClient.fromConfig();
      const announcement = await api.getAnnouncement(id);
      
      console.log(`Title: ${announcement.title}`);
      console.log(`ID: ${announcement.id}`);
      console.log(`Status: ${announcement.published_at ? 'Published' : 'Draft'}`);
      if (announcement.published_at) {
        console.log(`Published: ${new Date(announcement.published_at).toLocaleString()}`);
      }
      console.log(`\nContent:\n${announcement.content || '(empty)'}`);
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
