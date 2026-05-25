import { logger } from '../core/logger.js';
import { DateTime } from 'luxon';
import PanelAPI from '../services/PanelAPI.js';
import { EmbedBuilder } from 'discord.js';

export default {
  name: 'nightlyCleanup',
  interval: 60 * 1000, // Check every minute

  lastRun: null,

  async execute(bot, isTest = false) {
    try {
      // Check if it's midnight UTC+3 (00:00 to 00:59)
      const now = DateTime.now().setZone('Europe/Istanbul');

      if (!isTest) {
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
      }

      // Perform nightly cleanup
      logger.info(`Running nightly cleanup... (Test Mode: ${isTest})`);

      const guild = bot.guilds.cache.first();
      if (!guild) {
        logger.debug('No guild found for nightly cleanup');
        return;
      }

      const whitelistData = await PanelAPI.getWhitelist();
      const entries = whitelistData.entries || [];
      const settings = await PanelAPI.getBotSettings();
      const requiredRoleIds = settings.whitelist_required_role_ids || [];
      const allServersStatus = await PanelAPI.getAllServersStatus();
      const activeServers = allServersStatus.servers.filter(s => s.status === 'running' || s.status === 'online');

      let removedCount = 0;
      let removedUsers = [];

      for (const entry of entries) {
        let hasRole = false;
        try {
          const member = await guild.members.fetch(entry.userId);
          const { hasWhitelistRequiredRole } = await import('../utils/checks.js');
          hasRole = await hasWhitelistRequiredRole(member);
        } catch (err) {
          if (err.code === 10007) {
            hasRole = false; // Left server
          } else {
            logger.warn(`Could not check role for ${entry.mcNick}: ${err.message}`);
            continue; // Skip this user to avoid accidental deletion
          }
        }

        // Add a 500ms delay to avoid Discord API rate limits
        await new Promise(resolve => setTimeout(resolve, 500));

        if (!hasRole) {
          try {
            await PanelAPI.removeWhitelist(entry.userId);
            for (const server of activeServers) {
              try {
                await PanelAPI.executeMCCommand(server.id, `whitelist remove ${entry.mcNick}`);
              } catch (e) {
                logger.warn(`Failed to execute whitelist remove for ${entry.mcNick} on server ${server.id}`);
              }
            }
            removedCount++;
            removedUsers.push(entry.mcNick);
          } catch (e) {
            logger.warn(`Failed to remove ${entry.mcNick} from whitelist API`);
          }
        }
      }

      logger.info(`Nightly cleanup completed. Removed ${removedCount} users.`);

      if (removedCount > 0) {
        const logChannelId = settings.night_guard_log_channel_id || settings.dashboard_channel_id;
        if (logChannelId) {
          try {
            const channel = await guild.channels.fetch(logChannelId);
            if (channel) {
              const embed = new EmbedBuilder()
                .setTitle('🌙 Gece Temizliği Raporu')
                .setDescription(`${removedCount} oyuncu whitelist rolü olmadığı için veya sunucudan ayrıldığı için whitelistten çıkarıldı.`)
                .setColor('#ff3333')
                .addFields({ name: 'Çıkarılanlar', value: removedUsers.slice(0, 20).join(', ') + (removedUsers.length > 20 ? ` ve ${removedUsers.length - 20} daha...` : '') })
                .setTimestamp();
              await channel.send({ embeds: [embed] });
            }
          } catch (e) {
            logger.warn('Could not send nightly cleanup report embed');
          }
        }
      }
    } catch (error) {
      logger.warn('Nightly cleanup error:', { error: error.message });
    }
  },
};
