import PanelAPI from '../services/PanelAPI.js';
import cache from '../services/Cache.js';
import { logger } from '../core/logger.js';
import { embeds } from '../services/embeds.js';

export default {
  name: 'serverHealthMonitor',
  interval: 2 * 60 * 1000, // 2 minutes

  serverStatuses: {}, // Track previous statuses to detect changes

  async execute(bot) {
    try {
      const settings = await cache.getOrFetch(
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
        return;
      }

      const allServersStatus = await PanelAPI.getAllServersStatus();
      const statusList = allServersStatus.servers || [];

      for (const serverStatus of statusList) {
        const serverId = serverStatus.id;
        const previousStatus = this.serverStatuses[serverId];

        // Detect status change (offline -> online or online -> offline)
        if (previousStatus && previousStatus !== serverStatus.status) {
          logger.info('Server status changed:', {
            server: serverStatus.name,
            from: previousStatus,
            to: serverStatus.status,
          });

          // Send notification to admin channel if configured
          if (settings.dashboardChannelId) {
            const channel = bot.channels.cache.get(settings.dashboardChannelId);
            if (channel) {
              const embed =
                serverStatus.status === 'online'
                  ? embeds.successEmbed(
                      'Sunucu Online',
                      `**${serverStatus.name}** sunucusu tekrar online oldu`
                    )
                  : embeds.errorEmbed(
                      'Sunucu Offline',
                      `⚠️ **${serverStatus.name}** sunucusu offline oldu`
                    );

              await channel.send({ embeds: [embed] });
            }
          }
        }

        // Update tracked status
        this.serverStatuses[serverId] = serverStatus.status;

        // Check for high CPU/RAM
        const performance = await PanelAPI.getSystemPerformance();
        if (performance.cpu > 90) {
          logger.warn('High CPU usage detected:', {
            server: serverStatus.name,
            cpu: performance.cpu,
          });
        }

        if (performance.ram > 90) {
          logger.warn('High memory usage detected:', {
            server: serverStatus.name,
            ram: performance.ram,
          });
        }
      }
    } catch (error) {
      logger.warn('Server health monitor error:', { error: error.message });
    }
  },
};
