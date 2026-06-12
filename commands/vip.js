import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import PanelAPI from '../services/PanelAPI.js';
import { logger } from '../core/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('vip')
    .setDescription('VIP üyelik durumunu ve kalan süreni göster')
    .addUserOption((opt) =>
      opt.setName('kullanici').setDescription('Başka bir kullanıcının VIP durumu (boş = sen)').setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const user = interaction.options.getUser('kullanici') || interaction.user;
      const grants = await PanelAPI.getVipByUser(user.id);

      if (!grants.length) {
        const embed = new EmbedBuilder()
          .setColor('#7f8c8d')
          .setTitle('👑 VIP Durumu')
          .setDescription(
            user.id === interaction.user.id
              ? 'Aktif bir VIP üyeliğin yok.\nVIP avantajları için sunucu yetkilileriyle iletişime geçebilirsin.'
              : `**${user.username}** kullanıcısının aktif VIP üyeliği yok.`
          )
          .setTimestamp();
        return await interaction.editReply({ embeds: [embed] });
      }

      const embed = new EmbedBuilder()
        .setColor(grants[0].color || '#f1c40f')
        .setTitle(`👑 ${user.username} — VIP Durumu`)
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp();

      for (const g of grants) {
        let value;
        if (g.expires_at == null) {
          value = '♾️ **Süresiz üyelik**';
        } else {
          const daysLeft = Math.max(0, Math.ceil((g.expires_at - Math.floor(Date.now() / 1000)) / 86400));
          value = `Bitiş: <t:${g.expires_at}:D> (<t:${g.expires_at}:R>)\nKalan: **${daysLeft} gün**`;
        }
        embed.addFields({ name: `✨ ${g.package_name}`, value, inline: false });
      }

      await interaction.editReply({ embeds: [embed] });
      logger.info('VIP durumu sorgulandı', { user: interaction.user.tag, target: user.tag });
    } catch (error) {
      logger.error('VIP komut hatası:', { error: error.message });
      await interaction.editReply({ content: '❌ VIP bilgisi alınamadı.' });
    }
  },
};
