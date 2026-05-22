import { SlashCommandBuilder } from 'discord.js';
import PanelAPI from '../services/PanelAPI.js';
import cache from '../services/Cache.js';
import { embeds } from '../services/embeds.js';
import { logger } from '../core/logger.js';
import { hasWhitelistRole, hasWhitelistAddRole } from '../utils/checks.js';
import { sanitizeNickname, formatDate } from '../utils/formatters.js';
import { WhitelistPaginator } from '../components/WhitelistPaginator.js';

export default {
  data: new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Whitelist yönetimi')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('kayit')
        .setDescription('Whitelist kaydı yap')
        .addStringOption((option) =>
          option
            .setName('nick')
            .setDescription('Minecraft nick')
            .setRequired(true)
            .setMinLength(3)
            .setMaxLength(16)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('bilgi')
        .setDescription('Whitelist durumunu kontrol et')
        .addUserOption((option) =>
          option
            .setName('kullanici')
            .setDescription('Kontrol edilecek kullanıcı (boş = sen)')
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('listele')
        .setDescription('Tüm whitelist kullanıcılarını listele')
    ),

  async execute(interaction, bot) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'kayit':
        await executeKayit(interaction);
        break;
      case 'bilgi':
        await executeBilgi(interaction);
        break;
      case 'listele':
        await executeListele(interaction, bot);
        break;
    }
  },
};

async function executeKayit(interaction) {
  await interaction.deferReply();

  try {
    const hasPermission = await hasWhitelistRole(interaction.member);
    if (!hasPermission) {
      const errorEmbed = embeds.errorEmbed(
        'Yetki Yok',
        'Whitelist kaydı yapmak için gerekli rolü yoksunuz'
      );
      return await interaction.editReply({ embeds: [errorEmbed] });
    }

    const nickname = sanitizeNickname(
      interaction.options.getString('nick')
    );

    if (!nickname || nickname.length < 3) {
      const errorEmbed = embeds.errorEmbed(
        'Geçersiz Nick',
        'Nick 3-16 karakter arası olmalı'
      );
      return await interaction.editReply({ embeds: [errorEmbed] });
    }

    await PanelAPI.addWhitelist(interaction.user.id, nickname);

    const successEmbed = embeds.successEmbed(
      'Whitelist Kaydı Başarılı',
      `**${nickname}** nick'i whitelist'e eklendi!`
    );

    await interaction.editReply({ embeds: [successEmbed] });

    logger.info('Whitelist kayıt:', {
      user: interaction.user.tag,
      nickname,
    });
  } catch (error) {
    logger.error('Whitelist kayit error:', { error: error.message });
    const errorEmbed = embeds.errorEmbed(
      'Hata',
      error.message || 'Whitelist kaydı başarısız'
    );
    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

async function executeBilgi(interaction) {
  await interaction.deferReply();

  try {
    const user = interaction.options.getUser('kullanici') || interaction.user;

    const [whitelist, timedRoles] = await Promise.all([
      PanelAPI.getWhitelist(),
      PanelAPI.getTimedRoles(),
    ]);

    const whitelistEntry = whitelist.users?.find((u) => u.userId === user.id);

    if (!whitelistEntry) {
      const errorEmbed = embeds.errorEmbed(
        'Whitelist Kaydı Bulunamadı',
        `**${user.username}** whitelist'te kayıtlı değil`
      );
      return await interaction.editReply({ embeds: [errorEmbed] });
    }

    const userRoles = timedRoles.roles?.filter((r) => r.userId === user.id) || [];

    const embed = embeds.infoEmbed('Whitelist Bilgisi', [
      { name: '👤 Kullanıcı', value: `${user.username}`, inline: true },
      { name: '🎮 Minecraft Nick', value: `${whitelistEntry.nickname}`, inline: true },
      {
        name: '📅 Kayıt Tarihi',
        value: formatDate(whitelistEntry.createdAt),
        inline: false,
      },
      {
        name: '⏱️ Süreli Roller',
        value:
          userRoles.length > 0
            ? userRoles
                .map((r) => `• <@&${r.roleId}> (Bitiş: ${formatDate(r.expiresAt)})`)
                .join('\n')
            : 'Aktif süreli rol yok',
        inline: false,
      },
    ]);

    await interaction.editReply({ embeds: [embed] });

    logger.info('Whitelist bilgi sorgulandı:', {
      user: interaction.user.tag,
      target: user.tag,
    });
  } catch (error) {
    logger.error('Whitelist bilgi error:', { error: error.message });
    const errorEmbed = embeds.errorEmbed(
      'Hata',
      error.message || 'Whitelist bilgisi alınamadı'
    );
    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

async function executeListele(interaction, bot) {
  await interaction.deferReply();

  try {
    const hasPermission = await hasWhitelistRole(interaction.member);
    if (!hasPermission) {
      const errorEmbed = embeds.errorEmbed(
        'Yetki Yok',
        'Whitelist listesini görüntülemek için gerekli rolü yoksunuz'
      );
      return await interaction.editReply({ embeds: [errorEmbed] });
    }

    const whitelistData = await PanelAPI.getWhitelist();
    const users = whitelistData.users || [];

    if (users.length === 0) {
      const errorEmbed = embeds.errorEmbed(
        'Whitelist Boş',
        'Henüz hiç kullanıcı whitelist\'te yok'
      );
      return await interaction.editReply({ embeds: [errorEmbed] });
    }

    const paginator = new WhitelistPaginator(users, 10);
    const currentPage = 0;

    const embed = paginator.createEmbed(currentPage);
    const components = [paginator.createButtons(currentPage)];

    const message = await interaction.editReply({
      embeds: [embed],
      components,
    });

    const collector = message.createMessageComponentCollector({
      time: 5 * 60 * 1000,
    });

    let page = currentPage;

    collector.on('collect', async (buttonInteraction) => {
      if (buttonInteraction.user.id !== interaction.user.id) {
        await buttonInteraction.reply({
          content: 'Bu butonları sadece komutu kullanan kişi kullanabilir',
          ephemeral: true,
        });
        return;
      }

      page = paginator.handleButtonInteraction(
        buttonInteraction.customId,
        page
      );

      const newEmbed = paginator.createEmbed(page);
      const newComponents = [paginator.createButtons(page)];

      await buttonInteraction.update({
        embeds: [newEmbed],
        components: newComponents,
      });
    });

    collector.on('end', async () => {
      const disabledComponents = [
        paginator
          .createButtons(page)
          .setComponents(
            paginator
              .createButtons(page)
              .components.map((btn) => btn.setDisabled(true))
          ),
      ];

      await message.edit({
        components: disabledComponents,
      });
    });

    logger.info('Whitelist listesi gösterildi:', {
      user: interaction.user.tag,
      count: users.length,
    });
  } catch (error) {
    logger.error('Whitelist listele error:', {
      error: error.message,
    });
    const errorEmbed = embeds.errorEmbed(
      'Hata',
      error.message || 'Whitelist listesi alınamadı'
    );
    await interaction.editReply({ embeds: [errorEmbed] });
  }
}
