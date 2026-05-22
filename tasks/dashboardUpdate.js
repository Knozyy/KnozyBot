import PanelAPI from '../services/PanelAPI.js';
import cache from '../services/Cache.js';
import { logger } from '../core/logger.js';
import { embeds } from '../services/embeds.js';

export default {
  name: 'dashboardUpdate',
  interval: 60 * 1000, // 60 seconds

  async execute(bot) {
    try {
      const settings = await cache.getOrFetch(
        'bot-settings',
        () => PanelAPI.getBotSettings(),
        5 * 60 * 1000
      );

      if (!settings.dashboardChannelId) {
        logger.debug('Dashboard channel not configured');
        return;
      }

      const channel = bot.channels.cache.get(settings.dashboardChannelId);
      if (!channel) {
        logger.warn('Dashboard channel not found');
        return;
      }

      // Get all servers status
      const allServersStatus = await PanelAPI.getAllServersStatus();
      const servers = allServersStatus.servers || [];

      if (servers.length === 0) {
        logger.debug('No servers to display on dashboard');
        return;
      }

      const embed = embeds.dashboardEmbed(servers);

      // Update or create dashboard message
      if (settings.dashboardMessageId) {
        try {
          const message = await channel.messages.fetch(
            settings.dashboardMessageId
          );
          await message.edit({ embeds: [embed] });
        } catch {
          // Message not found, create new one
          const newMessage = await channel.send({ embeds: [embed] });
          await PanelAPI.saveBotSettings({
            ...settings,
            dashboardMessageId: newMessage.id,
          });
        }
      } else {
        // Create new dashboard message
        const message = await channel.send({ embeds: [embed] });
        await PanelAPI.saveBotSettings({
          ...settings,
          dashboardMessageId: message.id,
        });
      }

      logger.debug('Dashboard updated successfully');
    } catch (error) {
      logger.warn('Dashboard update error:', { error: error.message });
    }
  },
};
