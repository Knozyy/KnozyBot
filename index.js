import KnozyBot from './core/KnozyBot.js';
import { logger } from './core/logger.js';
import cache from './services/Cache.js';

const bot = new KnozyBot();

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down...');
  await bot.shutdown();
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  await bot.shutdown();
});

process.on('SIGUSR1', () => {
  logger.info('SIGUSR1 received: Clearing cache to force settings sync.');
  cache.clear();
});

// Start bot
bot.start().catch((error) => {
  logger.error('Failed to start bot:', { error: error.message });
  process.exit(1);
});
