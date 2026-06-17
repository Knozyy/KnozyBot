import KnozyBot from './core/KnozyBot.js';
import { logger } from './core/logger.js';
import cache from './services/Cache.js';
import { bynoDonations } from './services/BynoDonations.js';

const bot = new KnozyBot();

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down...');
  await bynoDonations.closeBrowser();
  await bot.shutdown();
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  await bynoDonations.closeBrowser();
  await bot.shutdown();
});

process.on('SIGUSR1', async () => {
  logger.info('SIGUSR1 received: Clearing cache to force settings sync.');
  cache.clear();

  try {
    const { default: PanelAPI } = await import('./services/PanelAPI.js');
    const settings = await PanelAPI.getBotSettings();
    if (settings.test_command) {
      logger.info(`Received test command from Panel: ${settings.test_command}`);
      
      // Clear the test command so it doesn't run multiple times
      await PanelAPI.saveBotSettings({ ...settings, test_command: null });
      
      // Run the test command
      if (settings.test_command === 'nightGuardTest') {
        // Send a dummy test message to the log channel
        const guild = bot.guilds.cache.first();
        const channelId = settings.night_guard_log_channel_id || settings.dashboard_channel_id;
        if (guild && channelId) {
          const channel = await guild.channels.fetch(channelId).catch(() => null);
          if (channel) {
             channel.send('🛡️ **Test:** Gece koruması sistemi aktiftir ve başarıyla haberleşmektedir.');
          }
        }
      } else {
        const task = bot.tasks.get(settings.test_command);
        if (task) {
          logger.info(`Executing test for task: ${settings.test_command}`);
          await task.execute(bot, true); // true = isTest
        } else {
          logger.warn(`Unknown test command: ${settings.test_command}`);
        }
      }
    }
  } catch (err) {
    logger.error('Failed to process SIGUSR1 test command:', { error: err.message });
  }
});

// Start bot
bot.start().catch((error) => {
  logger.error('Failed to start bot:', { error: error.message });
  process.exit(1);
});
