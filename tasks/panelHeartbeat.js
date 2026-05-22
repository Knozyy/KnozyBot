import PanelAPI from '../services/PanelAPI.js';
import cache from '../services/Cache.js';
import { logger } from '../core/logger.js';

export default {
  name: 'panelHeartbeat',
  interval: 5 * 60 * 1000, // 5 minutes

  async execute(bot) {
    try {
      // Health check
      const health = await PanelAPI.healthCheck();
      logger.debug('Panel health check ok', { health });

      // Refresh bot settings cache
      cache.delete('bot-settings');
      const settings = await PanelAPI.getBotSettings();
      cache.set('bot-settings', settings, 5 * 60 * 1000);

      logger.debug('Bot settings refreshed from panel');

      // Refresh servers cache
      cache.delete('servers-list');
      const servers = await PanelAPI.getAllServers();
      cache.set('servers-list', servers, 10 * 60 * 1000);

      logger.debug('Servers list refreshed from panel');
    } catch (error) {
      logger.warn('Panel heartbeat error:', { error: error.message });
      // Continue even if panel is temporarily down
    }
  },
};
