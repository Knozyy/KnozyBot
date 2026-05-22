import { SlashCommandBuilder } from 'discord.js';
import PanelAPI from '../services/PanelAPI.js';
import cache from '../services/Cache.js';
import { embeds } from '../services/embeds.js';
import { logger } from '../core/logger.js';
import { formatUptime } from '../utils/formatters.js';

export default {
  data: new SlashCommandBuilder()
    .setName('istatistik')
    .setDescription('Sunucu istatistiklerini gösterir')
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
        10 * 60 * 1000
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

      const [serverStatus, performance] = await Promise.all([
        PanelAPI.getServerStatus(serverId),
        PanelAPI.getSystemPerformance(),
      ]);

      const stats = {
        cpu: performance.cpu || 0,
        ram: performance.ram || 0,
        uptime: formatUptime(serverStatus.uptime || 0),
        players: serverStatus.onlinePlayers || 0,
        maxPlayers: serverStatus.maxPlayers || 0,
      };

      const embed = embeds.statsEmbed(serverStatus.name, stats);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Command error: istatistik', { error: error.message });
      const errorEmbed = embeds.errorEmbed(
        'Hata',
        error.message || 'İstatistikler alınamadı'
      );
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};
