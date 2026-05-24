import PanelAPI from '../services/PanelAPI.js';
import { logger } from '../core/logger.js';
import { formatTime } from '../utils/formatters.js';

export default {
  name: 'timedRolesCheck',
  interval: 60 * 1000, // 60 seconds

  async execute(bot) {
    try {
      const timedRoles = await PanelAPI.getTimedRoles();
      const rolesList = timedRoles.roles || [];
      const settings = await PanelAPI.getBotSettings();

      if (rolesList.length === 0) {
        return;
      }

      const now = new Date();

      for (let i = 0; i < rolesList.length; i++) {
        const roleData = rolesList[i];
        const expiresAt = new Date(roleData.expiry_timestamp * 1000);
        
        const guild = bot.guilds.cache.get(roleData.guild_id) || bot.guilds.cache.first();
        if (!guild) continue;

        if (now >= expiresAt) {
          try {
            // Süresi dolmuş -> Sil
            const member = await guild.members.fetch(roleData.user_id).catch(() => null);
            if (member) {
              await member.roles.remove(roleData.role_id).catch(() => null);
            }

            // Remove from database (using the current index. Note: PanelAPI removes by index, but splicing shifts array. It's safer to remove by index if array didn't change, but PanelAPI expects the index from the GET request).
            // Actually, we pass the original index i to removeTimedRole.
            await PanelAPI.removeTimedRole(i);

            // Send notification to user
            try {
              const user = await bot.users.fetch(roleData.user_id);
              await user.send(
                `🕐 **${guild.name}** sunucusunda <@&${roleData.role_id}> rolü süresi doldu ve kaldırıldı.`
              );
            } catch {
              // User DM disabled
            }

            // Send notification to log channel
            if (settings.role_log_channel_id) {
              try {
                const logChannel = await guild.channels.fetch(settings.role_log_channel_id);
                if (logChannel) {
                  await logChannel.send(
                    `🕐 <@${roleData.user_id}> kullanıcısının <@&${roleData.role_id}> rolünün süresi doldu ve sistem tarafından geri alındı.`
                  );
                }
              } catch (e) {
                logger.warn('Could not send role expiration log');
              }
            }

            logger.info('Timed role expired:', {
              user: roleData.user_id,
              role: roleData.role_id,
            });
            
            // Veritabanı değiştiği için listeyi yeniden çekip döngüyü kırmak veya devam etmek riskli olabilir.
            // Bir kerede tek bir rol silsin, sonraki döngüde diğerlerini siler.
            break;
          } catch (error) {
            logger.warn('Error removing timed role:', {
              error: error.message,
            });
          }
        } else {
          // Süresi devam ediyor -> Rol yoksa ver
          try {
            const member = await guild.members.fetch(roleData.user_id).catch(() => null);
            if (member && !member.roles.cache.has(roleData.role_id)) {
              await member.roles.add(roleData.role_id);
              logger.info('Timed role assigned to member (sync):', {
                user: roleData.user_id,
                role: roleData.role_id,
              });
            }
          } catch (error) {
            // Ignore
          }
        }
      }
    } catch (error) {
      logger.warn('Timed roles check error:', { error: error.message });
    }
  },
};
