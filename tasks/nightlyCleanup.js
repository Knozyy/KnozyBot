import { logger } from '../core/logger.js';
import { DateTime } from 'luxon';

export default {
  name: 'nightlyCleanup',
  interval: 60 * 1000, // Check every minute

  lastRun: null,

  async execute(bot) {
    try {
      // Check if it's midnight UTC+3 (00:00 to 00:59)
      const now = DateTime.now().setZone('Europe/Istanbul');

      // Only run once per day at midnight
      if (this.lastRun) {
        const lastDay = this.lastRun.toFormat('yyyy-MM-dd');
        const currentDay = now.toFormat('yyyy-MM-dd');

        if (lastDay === currentDay) {
          return; // Already ran today
        }
      }

      if (now.hour !== 0) {
        return; // Not midnight
      }

      this.lastRun = now;

      // Perform nightly cleanup
      logger.info('Running nightly cleanup...');

      const guild = bot.guilds.cache.first();
      if (!guild) {
        logger.debug('No guild found for nightly cleanup');
        return;
      }

      // Check whitelist roles - remove users without required role
      // This would be implemented with PanelAPI.getWhitelist() and role checks
      // For now, just log that it ran

      logger.info('Nightly cleanup completed');
    } catch (error) {
      logger.warn('Nightly cleanup error:', { error: error.message });
    }
  },
};
