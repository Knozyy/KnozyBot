import { logger } from '../core/logger.js';
import { DateTime } from 'luxon';
import PanelAPI from '../services/PanelAPI.js';
import cleanupService from '../services/cleanupService.js';

export default {
  name: 'nightlyCleanup',
  interval: 60 * 1000, // Check every minute

  isRunning: false,

  async execute(bot, isTest = false) {
    if (this.isRunning) {
      logger.warn('nightlyCleanup is already running, skipping...');
      return;
    }
    this.isRunning = true;

    try {
      const now = DateTime.now().setZone('Europe/Istanbul');
      const currentDay = now.toFormat('yyyy-MM-dd');

      if (!isTest) {
        // Robust 6-hour daily check (runs once per day between 00:00 and 05:59 Turkey Time)
        if (now.hour < 0 || now.hour > 5) {
          return; // Skip if it's not night time
        }

        const lastRun = cleanupService.getLastRun();
        if (lastRun === currentDay) {
          return; // Already successfully ran today
        }

        // Don't persist yet — only save after successful execution
      }

      // Perform nightly cleanup
      logger.info(`Running nightly cleanup... (Test Mode: ${isTest})`);

      const guildId = bot.guildId || (await import('../config.js')).config.discord.guildId;
      const guild = bot.guilds.cache.get(guildId) || bot.guilds.cache.first();
      
      if (!guild) {
        logger.debug('No guild found for nightly cleanup');
        return;
      }

      const whitelistData = await PanelAPI.getWhitelist();
      const entries = whitelistData.entries || [];
      const settings = await PanelAPI.getBotSettings();
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
            logger.info(`[CLEANUP] Removing ${entry.mcNick} (${entry.userId}). No required role found.`);
            await PanelAPI.removeWhitelist(entry.userId);
            for (const server of activeServers) {
              try {
                await PanelAPI.executeMCCommand(server.id, `whitelist remove ${entry.mcNick}`);
              } catch (e) {
                logger.warn(`Failed to execute whitelist remove for ${entry.mcNick} on server ${server.id}`);
              }
            }
            removedCount++;
            removedUsers.push({ userId: entry.userId, mcNick: entry.mcNick });
          } catch (e) {
            logger.warn(`Failed to remove ${entry.mcNick} from whitelist API: ${e.message}`);
          }
        }
      }

      logger.info(`Nightly cleanup completed. Removed ${removedCount} users.`);

      // Persist the report in history
      cleanupService.addReport(removedCount, removedUsers, currentDay);

      // Mark run as successful AFTER cleanup completes without errors
      if (!isTest) {
        cleanupService.saveLastRun(currentDay);
      }

      // Always send the report (even if 0 removed) so admins know it ran
      const logChannelId = settings.night_guard_log_channel_id || settings.whitelist_log_channel_id || settings.dashboard_channel_id;
      if (logChannelId) {
        try {
          const channel = await guild.channels.fetch(logChannelId);
          if (channel) {
            const history = cleanupService.getHistory();
            const embed = cleanupService.buildEmbed(history[0], 0, history.length);
            const buttons = cleanupService.buildButtons(0, history.length);
            
            await channel.send({ embeds: [embed], components: [buttons] });
            logger.info('Nightly cleanup report embed sent successfully.');
          } else {
            logger.warn(`Log channel ${logChannelId} could not be found in the guild.`);
          }
        } catch (e) {
          logger.error('Could not send nightly cleanup report embed:', { error: e.message, code: e.code });
        }
      } else {
        logger.warn('No log channel configured for nightly cleanup.');
      }
    } catch (error) {
      logger.error('Error during nightly cleanup:', { error: error.message });
    } finally {
      this.isRunning = false;
    }
  },
};
