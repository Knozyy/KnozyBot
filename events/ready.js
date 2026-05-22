import { logger } from '../core/logger.js';
import PanelAPI from '../services/PanelAPI.js';

export default {
  name: 'ready',
  once: true,
  async execute(bot) {
    logger.info(`✅ Bot logged in as ${bot.user.tag}`);

    try {
      // Register slash commands
      await bot.registerCommands();

      // Test panel connection
      const health = await PanelAPI.healthCheck();
      logger.info(`✅ Panel API connection successful`, { health });

      // Panelden status metnini oku
      let statusName = 'HooDoo FTB Evolution';
      try {
        const settings = await PanelAPI.getBotSettings();
        if (settings?.status_text) statusName = settings.status_text;
      } catch { /* panel yoksa varsayılanı kullan */ }

      // Set initial presence
      bot.user.setPresence({
        activities: [{ name: statusName, type: 0 }],
        status: 'online',
      });

      logger.info('🚀 Bot is ready!');
    } catch (error) {
      logger.error('Error in ready event:', { error: error.message });
    }
  },
};
