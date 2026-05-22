import { SlashCommandBuilder } from 'discord.js';
import PanelAPI from '../services/PanelAPI.js';
import cache from '../services/Cache.js';
import { embeds } from '../services/embeds.js';
import { logger } from '../core/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('oyuncular')
    .setDescription('Online oyuncu listesini gösterir')
    .addStringOption((option) =>
      option
        .setName('sunucu')
        .setDescription('Sunucu seçin')
        .setAutocomplete(true)
        .setRequired(false)
    ),

  async autocomplete(interaction) {
    try {
      const servers = await cache.getOrFetch(
        'servers-list',
        () => PanelAPI.getAllServers(),
        10 * 60 * 1000 // 10 minutes
      );

      const focused = interaction.options.getFocused();
      const filtered = servers
        .filter((s) => s.name.toLowerCase().includes(focused.toLowerCase()))
        .slice(0, 25);

      await interaction.respond(
        filtered.map((s) => ({ name: s.name, value: s.id }))
      );
    } catch (error) {
      logger.error('Autocomplete error:', { error: error.message });
      await interaction.respond([]);
    }
  },

  async execute(interaction, bot) {
    await interaction.deferReply();

    try {
      let serverId = interaction.options.getString('sunucu');

      // If no server selected, get first active server
      if (!serverId) {
        const servers = await cache.getOrFetch(
          'servers-list',
          () => PanelAPI.getAllServers(),
          10 * 60 * 1000
        );

        if (!servers || servers.length === 0) {
          const errorEmbed = embeds.errorEmbed(
            'Sunucu Bulunamadı',
            'Aktif sunucu yok'
          );
          return await interaction.editReply({ embeds: [errorEmbed] });
        }

        serverId = servers[0].id;
      }

      const playerData = await PanelAPI.getServerPlayers(serverId);
      const serverStatus = await PanelAPI.getServerStatus(serverId);

      const playerList = playerData.players || [];
      const embed = embeds.playersEmbed(
        serverStatus.name,
        playerList,
        serverStatus.maxPlayers,
        playerList.length
      );

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Command error: oyuncular', { error: error.message });
      const errorEmbed = embeds.errorEmbed(
        'Hata',
        error.message || 'Oyuncu listesi alınamadı'
      );
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};
