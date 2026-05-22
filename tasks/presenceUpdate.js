import PanelAPI from '../services/PanelAPI.js';
import cache from '../services/Cache.js';
import { logger } from '../core/logger.js';

export default {
  name: 'presenceUpdate',
  interval: 30 * 1000, // 30 seconds

  async execute(bot) {
    try {
      // Panelden bot ayarlarını al (cache'den)
      const botSettings = await cache.getOrFetch(
        'bot-settings',
        () => PanelAPI.getBotSettings(),
        5 * 60 * 1000
      );

      const servers = await cache.getOrFetch(
        'servers-list',
        () => PanelAPI.getAllServers(),
        10 * 60 * 1000
      );

      if (!servers || servers.length === 0) {
        bot.user.setPresence({
          activities: [{ name: '❌ Kapalı', type: 0 }],
          status: 'dnd',
        });
        return;
      }

      const firstServer = servers[0];
      const status = await PanelAPI.getServerStatus(firstServer.id);

      // Panelden özel metin varsa onu kullan, yoksa oyuncu sayısını göster
      const customText = botSettings?.status_text;
      const activityName = customText
        ? customText
        : `${status.onlinePlayers || 0}/${status.maxPlayers || 20} oyuncu`;

      bot.user.setPresence({
        activities: [{ name: activityName, type: 0 }],
        status: status.status === 'running' ? 'online' : 'dnd',
      });
    } catch (error) {
      logger.warn('Presence update error:', { error: error.message });
    }
  },
};
