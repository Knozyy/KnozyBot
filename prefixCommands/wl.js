import PanelAPI from '../services/PanelAPI.js';
import { hasAdminRole } from '../utils/checks.js';
import { logger } from '../core/logger.js';
import { embeds } from '../services/embeds.js';
import { WhitelistPaginator } from '../components/WhitelistPaginator.js';

export default {
  name: 'wl',
  description: 'Whitelist yönetimi',
  usage: '!wl <ekle|sil|sync-mc|rol-kontrol|liste>',

  async execute(message, args, bot) {
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand) {
      return await message.reply(
        `\`\`\`!wl <ekle|sil|sync-mc|rol-kontrol|liste>\`\`\``
      );
    }

    try {
      const isAdmin = await hasAdminRole(message.member);
      if (!isAdmin) {
        return await message.reply('❌ Admin rolü gerekli');
      }

      switch (subcommand) {
        case 'ekle':
          await executeEkle(message, args);
          break;
        case 'sil':
          await executeSil(message, args);
          break;
        case 'sync-mc':
          await executeSyncMC(message, args);
          break;
        case 'rol-kontrol':
          await executeRolKontrol(message, args);
          break;
        case 'liste':
          await executeListele(message, args, bot);
          break;
        default:
          await message.reply('❌ Bilinmeyen alt komut');
      }
    } catch (error) {
      logger.error('Prefix command error: wl', { error: error.message });
      await message.reply(`❌ Hata: ${error.message}`);
    }
  },
};

async function executeEkle(message, args) {
  const user = message.mentions.members.first();
  const nick = args[2];

  if (!user) {
    return await message.reply('❌ Kullanıcı belirtin: `!wl ekle @user <nick>`');
  }

  if (!nick || nick.length < 3 || nick.length > 16) {
    return await message.reply('❌ Geçersiz nick (3-16 karakter)');
  }

  await PanelAPI.addWhitelist(user.id, nick);

  const embed = embeds.successEmbed(
    'Whitelist Eklendi',
    `**${user.username}** → \`${nick}\` whitelist'e eklendi`
  );

  await message.reply({ embeds: [embed] });

  logger.info('Admin whitelist ekle:', {
    user: message.author.tag,
    target: user.user.tag,
    nick,
  });
}

async function executeSil(message, args) {
  const user = message.mentions.members.first();

  if (!user) {
    return await message.reply('❌ Kullanıcı belirtin: `!wl sil @user`');
  }

  await PanelAPI.removeWhitelist(user.id);

  const embed = embeds.successEmbed(
    'Whitelist Silindi',
    `**${user.username}** whitelist'ten silindi`
  );

  await message.reply({ embeds: [embed] });

  logger.info('Admin whitelist sil:', {
    user: message.author.tag,
    target: user.user.tag,
  });
}

async function executeSyncMC(message, args) {
  const serverId = args[1];

  if (!serverId) {
    return await message.reply('❌ Server ID belirtin: `!wl sync-mc <serverId>`');
  }

  await message.reply('⏳ MC whitelist senkronize ediliyor...');

  try {
    await PanelAPI.executeMCCommand(serverId, 'whitelist reload');

    const embed = embeds.successEmbed(
      'Whitelist Senkronize Edildi',
      'MC sunucusu whitelist\'i yenilendi'
    );

    await message.reply({ embeds: [embed] });

    logger.info('Admin whitelist sync:', {
      user: message.author.tag,
      serverId,
    });
  } catch (error) {
    throw new Error(`MC sinkronizasyon hatası: ${error.message}`);
  }
}

async function executeRolKontrol(message, args) {
  const whitelist = await PanelAPI.getWhitelist();
  const users = whitelist.users || [];

  if (users.length === 0) {
    return await message.reply('❌ Whitelist boş');
  }

  const guild = message.guild;
  const missingRoleUsers = [];

  for (const user of users) {
    try {
      const member = await guild.members.fetch(user.userId);
      const hasRole = member.roles.cache.some((r) => r.name === 'whitelist');

      if (!hasRole) {
        missingRoleUsers.push(`• **${user.username}** (\`${user.nickname}\`)`);
      }
    } catch {
      // User not in guild
    }
  }

  if (missingRoleUsers.length === 0) {
    const embed = embeds.successEmbed(
      'Rol Kontrolü',
      'Tüm whitelist kullanıcılarının gerekli rolü var'
    );
    return await message.reply({ embeds: [embed] });
  }

  const embed = embeds.infoEmbed('Rol Kontrolü - Eksik Rol', [
    {
      name: `${missingRoleUsers.length} Kullanıcı Eksik Rol`,
      value: missingRoleUsers.join('\n'),
      inline: false,
    },
  ]);

  await message.reply({ embeds: [embed] });

  logger.info('Admin rol kontrol:', {
    user: message.author.tag,
    missing: missingRoleUsers.length,
  });
}

async function executeListele(message, args, bot) {
  const whitelist = await PanelAPI.getWhitelist();
  const users = whitelist.users || [];

  if (users.length === 0) {
    const embed = embeds.errorEmbed('Whitelist Boş', 'Kullanıcı yok');
    return await message.reply({ embeds: [embed] });
  }

  const paginator = new WhitelistPaginator(users, 10);
  const currentPage = 0;

  const embed = paginator.createEmbed(currentPage);
  const components = [paginator.createButtons(currentPage)];

  const reply = await message.reply({
    embeds: [embed],
    components,
  });

  const collector = reply.createMessageComponentCollector({
    time: 5 * 60 * 1000,
  });

  let page = currentPage;

  collector.on('collect', async (buttonInteraction) => {
    if (buttonInteraction.user.id !== message.author.id) {
      await buttonInteraction.reply({
        content: 'Bu butonları sadece komut kullanan kişi kullanabilir',
        ephemeral: true,
      });
      return;
    }

    page = paginator.handleButtonInteraction(buttonInteraction.customId, page);

    const newEmbed = paginator.createEmbed(page);
    const newComponents = [paginator.createButtons(page)];

    await buttonInteraction.update({
      embeds: [newEmbed],
      components: newComponents,
    });
  });

  logger.info('Admin whitelist liste:', {
    user: message.author.tag,
    count: users.length,
  });
}
