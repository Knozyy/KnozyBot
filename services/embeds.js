import { EmbedBuilder } from 'discord.js';
import { COLORS, EMOJIS } from '../utils/constants.js';

export const embeds = {
  // Players embed
  playersEmbed: (serverName, players, maxPlayers, onlinePlayers) => {
    const playerList = players
      .slice(0, 20)
      .map((p) => `• ${p}`)
      .join('\n') || 'Oyuncu yok';

    return new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(`${EMOJIS.PLAYERS} ${serverName} - Online Oyuncular`)
      .setDescription(`**${onlinePlayers}/${maxPlayers}** oyuncu online`)
      .addFields(
        {
          name: 'Oyuncular',
          value: playerList,
          inline: false,
        }
      )
      .setTimestamp();
  },

  // Statistics embed
  statsEmbed: (serverName, stats) => {
    return new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle(`${EMOJIS.STATS} ${serverName} - İstatistikler`)
      .addFields(
        { name: `${EMOJIS.CPU} CPU`, value: `${stats.cpu}%`, inline: true },
        { name: `${EMOJIS.RAM} RAM`, value: `${stats.ram}%`, inline: true },
        { name: `${EMOJIS.UPTIME} Uptime`, value: stats.uptime, inline: true },
        { name: `${EMOJIS.PLAYERS} Oyuncular`, value: `${stats.players}/${stats.maxPlayers}`, inline: true }
      )
      .setTimestamp();
  },

  // Error embed
  errorEmbed: (title, description) => {
    return new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle(`${EMOJIS.ERROR} ${title}`)
      .setDescription(description)
      .setTimestamp();
  },

  // Success embed
  successEmbed: (title, description) => {
    return new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(`${EMOJIS.SUCCESS} ${title}`)
      .setDescription(description)
      .setTimestamp();
  },

  // Whitelist embed
  whitelistEmbed: (users, page, totalPages) => {
    const userList = users
      .map((u) => `• **${u.username}** → \`${u.nickname}\``)
      .join('\n');

    return new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle(`${EMOJIS.WHITELIST} Whitelist Listesi`)
      .setDescription(userList || 'Whitelist boş')
      .setFooter({ text: `Sayfa ${page}/${totalPages}` })
      .setTimestamp();
  },

  // Dashboard embed
  dashboardEmbed: (servers) => {
    const serverList = servers
      .map((s) => `• **${s.name}**: ${s.status === 'online' ? '🟢' : '🔴'} (${s.players}/${s.maxPlayers})`)
      .join('\n');

    return new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(`${EMOJIS.DASHBOARD} Dashboard`)
      .setDescription(serverList || 'Sunucu yok')
      .setTimestamp();
  },

  // Info embed
  infoEmbed: (title, fields) => {
    const embed = new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle(title)
      .setTimestamp();

    fields.forEach((field) => {
      embed.addFields(field);
    });

    return embed;
  },
};

export default embeds;
