import PanelAPI from '../services/PanelAPI.js';
import { hasAdminRole } from '../utils/checks.js';
import { logger } from '../core/logger.js';
import { embeds } from '../services/embeds.js';
import { TIME_UNITS, UNIT_NAMES } from '../utils/constants.js';

export default {
  name: 'gecici-rol',
  description: 'Geçici rol ata',
  usage: '!gecici-rol @user @role <duration> <unit>',

  async execute(message, args, bot) {
    try {
      const isAdmin = await hasAdminRole(message.member);
      if (!isAdmin) {
        return await message.reply('❌ Admin rolü gerekli');
      }

      const user = message.mentions.members.first();
      const role = message.mentions.roles.first();
      const durationStr = args[2];
      const unit = args[3]?.toLowerCase();

      if (!user) {
        return await message.reply(
          '❌ Kullanıcı belirtin: `!gecici-rol @user @role <duration> <unit>`'
        );
      }

      if (!role) {
        return await message.reply(
          '❌ Rol belirtin: `!gecici-rol @user @role <duration> <unit>`'
        );
      }

      if (!durationStr || isNaN(durationStr)) {
        return await message.reply(
          '❌ Geçerli süre belirtin: `!gecici-rol @user @role 5 gün`'
        );
      }

      const validUnits = ['m', 'dakika', 'h', 'saat', 'd', 'gün', 'w', 'hafta', 'mo', 'ay'];
      if (!unit || !validUnits.includes(unit)) {
        return await message.reply(
          '❌ Geçerli birim: `dakika|saat|gün|hafta|ay` (veya kısaltma: m|h|d|w|mo)'
        );
      }

      const duration = parseInt(durationStr);
      if (duration < 1) {
        return await message.reply('❌ Süre en az 1 olmalı');
      }

      // Normalize unit
      let normalizedUnit = unit;
      if (unit === 'dakika' || unit === 'm') normalizedUnit = 'm';
      else if (unit === 'saat' || unit === 'h') normalizedUnit = 'h';
      else if (unit === 'gün' || unit === 'd') normalizedUnit = 'd';
      else if (unit === 'hafta' || unit === 'w') normalizedUnit = 'w';
      else if (unit === 'ay' || unit === 'mo') normalizedUnit = 'mo';

      // Add timed role
      await PanelAPI.addTimedRole(user.id, role.id, duration, normalizedUnit);

      // Give role immediately
      await user.roles.add(role);

      const unitDisplay = UNIT_NAMES[normalizedUnit] || normalizedUnit;
      const embed = embeds.successEmbed(
        'Geçici Rol Atandı',
        `**${user.user.username}** → **${role.name}** (${duration} ${unitDisplay})`
      );

      await message.reply({ embeds: [embed] });

      logger.info('Admin gecici rol:', {
        user: message.author.tag,
        target: user.user.tag,
        role: role.name,
        duration: `${duration}${normalizedUnit}`,
      });
    } catch (error) {
      logger.error('Prefix command error: gecici-rol', {
        error: error.message,
      });
      await message.reply(`❌ Hata: ${error.message}`);
    }
  },
};
