import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

export class ConfirmDialog {
  constructor(options = {}) {
    this.confirmLabel = options.confirmLabel || '✅ Evet';
    this.cancelLabel = options.cancelLabel || '❌ İptal';
    this.timeout = options.timeout || 5 * 60 * 1000; // 5 minutes
  }

  createButtons() {
    const confirmButton = new ButtonBuilder()
      .setCustomId('confirm_yes')
      .setLabel(this.confirmLabel)
      .setStyle(ButtonStyle.Success);

    const cancelButton = new ButtonBuilder()
      .setCustomId('confirm_no')
      .setLabel(this.cancelLabel)
      .setStyle(ButtonStyle.Danger);

    return new ActionRowBuilder().addComponents(confirmButton, cancelButton);
  }

  async prompt(interaction, message) {
    const components = [this.createButtons()];

    const reply = await interaction.reply({
      content: message,
      components,
      ephemeral: true,
    });

    try {
      const confirmation = await reply.awaitMessageComponent({
        time: this.timeout,
      });

      const isConfirmed = confirmation.customId === 'confirm_yes';

      // Disable buttons
      const disabledComponents = [
        this.createButtons()
          .setComponents(
            this.createButtons()
              .components.map((btn) => btn.setDisabled(true))
          ),
      ];

      await confirmation.update({
        components: disabledComponents,
      });

      return isConfirmed;
    } catch {
      // Timeout
      const expiredComponents = [
        this.createButtons()
          .setComponents(
            this.createButtons()
              .components.map((btn) => btn.setDisabled(true))
          ),
      ];

      await reply.edit({
        components: expiredComponents,
      });

      return false;
    }
  }
}

export default ConfirmDialog;
