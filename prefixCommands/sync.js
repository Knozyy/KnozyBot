import { hasAdminRole } from '../utils/checks.js';
import { logger } from '../core/logger.js';
import { embeds } from '../services/embeds.js';

export default {
  name: 'sync',
  description: 'Slash komutlarını senkronize et',
  usage: '!sync',

  async execute(message, args, bot) {
    try {
      const isAdmin = await hasAdminRole(message.member);
      if (!isAdmin) {
        return await message.reply('❌ Admin rolü gerekli');
      }

      const reply = await message.reply('⏳ Slash komutları senkronize ediliyor...');

      await bot.registerCommands();

      const embed = embeds.successEmbed(
        'Komutlar Senkronize Edildi',
        `${bot.commands.size} slash komut Discord'a kaydedildi`
      );

      await reply.edit({ embeds: [embed] });

      logger.info('Admin sync komutlar:', {
        user: message.author.tag,
        count: bot.commands.size,
      });
    } catch (error) {
      logger.error('Prefix command error: sync', {
        error: error.message,
      });
      await message.reply(`❌ Hata: ${error.message}`);
    }
  },
};
