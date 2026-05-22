import PanelAPI from '../services/PanelAPI.js';
import { logger } from '../core/logger.js';
import { formatTime } from '../utils/formatters.js';

export default {
  name: 'timedRolesCheck',
  interval: 60 * 1000, // 60 seconds

  async execute(bot) {
    try {
      const guild = bot.guilds.cache.first();
      if (!guild) {
        logger.debug('No guild found for timed roles check');
        return;
      }

      const timedRoles = await PanelAPI.getTimedRoles();
      const expiring = timedRoles.expiring || [];

      if (expiring.length === 0) {
        return;
      }

      const now = new Date();

      for (const roleData of expiring) {
        const expiresAt = new Date(roleData.expiresAt);

        if (now >= expiresAt) {
          try {
            // Remove role from user
            const member = await guild.members.fetch(roleData.userId);
            await member.roles.remove(roleData.roleId);

            // Remove from database
            await PanelAPI.removeTimedRole(expiring.indexOf(roleData));

            // Send notification
            try {
              const user = await bot.users.fetch(roleData.userId);
              await user.send(
                `🕐 **${guild.name}** sunucusunda <@&${roleData.roleId}> rolü süresi doldu ve kaldırıldı.`
              );
            } catch {
              // User DM disabled
            }

            logger.info('Timed role expired:', {
              user: roleData.userId,
              role: roleData.roleId,
            });
          } catch (error) {
            logger.warn('Error removing timed role:', {
              error: error.message,
            });
          }
        }
      }
    } catch (error) {
      logger.warn('Timed roles check error:', { error: error.message });
    }
  },
};
