import { logger } from '../core/logger.js';
import { embeds } from '../services/embeds.js';

export default {
  name: 'interactionCreate',
  async execute(bot, interaction) {
    // Handle autocomplete
    if (interaction.isAutocomplete()) {
      const command = bot.commands.get(interaction.commandName);
      if (!command || !command.autocomplete) return;

      try {
        await command.autocomplete(interaction);
      } catch (error) {
        logger.error(`Autocomplete error: ${interaction.commandName}`, {
          error: error.message,
        });
        await interaction.respond([]);
      }
      return;
    }

    // Handle slash commands
    if (!interaction.isChatInputCommand()) return;

    const command = bot.commands.get(interaction.commandName);
    if (!command) {
      logger.warn(`Unknown command: ${interaction.commandName}`);
      return;
    }

    try {
      logger.info(`Executing command: ${interaction.commandName}`, {
        user: interaction.user.tag,
        guild: interaction.guild?.name,
      });

      await command.execute(interaction, bot);
    } catch (error) {
      logger.error(`Command error: ${interaction.commandName}`, {
        error: error.message,
      });

      const errorEmbed = embeds.errorEmbed(
        'Komut Hatası',
        error.message || 'Komut çalıştırılırken hata oluştu'
      );

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [errorEmbed] });
      } else {
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
    }
  },
};
