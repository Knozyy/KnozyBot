import { Events } from 'discord.js';
import { logger } from '../core/logger.js';
import PanelAPI from '../services/PanelAPI.js';

export default {
  name: Events.GuildMemberRemove,
  async execute(bot, member) {
    const userId = String(member.id);
    logger.info(`👤 Member left the server: ${member.user.tag} (${userId})`);

    try {
      // Whitelist verilerini al ve bu kullanıcının kaydı var mı kontrol et
      const whitelistData = await PanelAPI.getWhitelist();
      const entries = whitelistData.entries || [];

      // String karşılaştırma — hem trim hem de String() ile garanti altına al
      const userEntry = entries.find(e => String(e.userId).trim() === userId);

      if (!userEntry) {
        logger.info(`[Member Remove] No whitelist entry found for ${member.user.tag} (${userId}). Skipping.`);
        return;
      }

      logger.info(`[Member Remove] Whitelist entry found for leaving member: ${userEntry.mcNick} (Discord: ${member.user.tag}). Deleting...`);

      // Panel üzerinden whitelist'ten sil
      try {
        await PanelAPI.removeWhitelist(userId);
        logger.info(`[Member Remove] Successfully removed ${userEntry.mcNick} from panel whitelist.`);
      } catch (removeErr) {
        logger.error(`[Member Remove] FAILED to remove ${userEntry.mcNick} from panel whitelist: ${removeErr.message}`);
        // Panel silme başarısız olduysa bile MC sunucularından silmeyi dene
      }

      // Aktif tüm Minecraft sunucularından whitelist'ten sil
      try {
        const allServersStatus = await PanelAPI.getAllServersStatus();
        const activeServers = allServersStatus.servers.filter(s => s.status === 'running' || s.status === 'online');

        for (const server of activeServers) {
          try {
            await PanelAPI.executeMCCommand(server.id, `whitelist remove ${userEntry.mcNick}`);
            logger.info(`[Member Remove] Removed ${userEntry.mcNick} from MC server ${server.id}`);
          } catch (e) {
            logger.warn(`[Member Remove] Failed whitelist remove for ${userEntry.mcNick} on server ${server.id}: ${e.message}`);
          }
        }
      } catch (serverErr) {
        logger.warn(`[Member Remove] Could not fetch server statuses: ${serverErr.message}`);
      }

      // Log kanalına bildirim gönder
      try {
        const settings = await PanelAPI.getBotSettings();
        const logChannelId = settings.night_guard_log_channel_id || settings.whitelist_log_channel_id || settings.dashboard_channel_id;
        if (logChannelId) {
          const channel = await bot.channels.fetch(logChannelId).catch(() => null);
          if (channel) {
            await channel.send(
              `👋 **${member.user.tag}** sunucudan ayrıldı. Whitelist kaydı (**${userEntry.mcNick}**) sistemden otomatik olarak silindi.`
            );
          }
        }
      } catch (logErr) {
        logger.warn(`[Member Remove] Failed to send notification message: ${logErr.message}`);
      }
    } catch (error) {
      logger.error(`[Member Remove] Critical error processing member leave for ${member.user?.tag}: ${error.message}`);
    }
  },
};
