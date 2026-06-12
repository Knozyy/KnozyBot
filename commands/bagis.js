import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { donationStore } from '../services/donationStore.js';
import { config } from '../config.js';
import { COLORS } from '../utils/constants.js';
import { logger } from '../core/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('bagis')
    .setDescription('ByNoGame bağışı ile otomatik rol/VIP al — sana özel bağış kodu üretir')
    .addStringOption((opt) =>
      opt
        .setName('paket')
        .setDescription('Almak istediğin paket')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = (interaction.options.getFocused() || '').toLowerCase();
    const packages = donationStore.enabledPackages();
    const choices = packages
      .filter((p) => p.label.toLowerCase().includes(focused) || p.id.includes(focused))
      .slice(0, 25)
      .map((p) => ({ name: `${p.label} — ${p.price}₺`, value: p.id }));
    await interaction.respond(choices);
  },

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    if (!config.byno.donateListUrl || !config.byno.publicDonateUrl) {
      return await interaction.editReply({
        content: '❌ Bağış sistemi şu an yapılandırılmamış. Lütfen yetkililere bildir.',
      });
    }

    const packageId = interaction.options.getString('paket');
    const pkg = donationStore.getPackage(packageId);

    if (!pkg || !pkg.enabled) {
      return await interaction.editReply({
        content: '❌ Geçersiz paket. Listeden bir paket seçmelisin.',
      });
    }

    const { claim, isNew } = donationStore.createOrGetClaim(interaction.user.id, pkg.id);

    const steps = [
      `1️⃣ Aşağıdaki **Bağış Yap** butonuna tıkla`,
      `2️⃣ Tutar olarak en az **${pkg.price}₺** gir`,
      `3️⃣ Bağış mesajına şu kodu yaz: \`${claim.code}\``,
      `4️⃣ Bot bağışını otomatik algılayıp rolünü tanımlar (genelde 2-3 dk içinde)`,
    ];

    const embed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setTitle('💝 Bağış ile Üyelik')
      .setDescription(steps.join('\n'))
      .addFields(
        { name: '📦 Paket', value: pkg.label, inline: true },
        { name: '💰 Tutar', value: `en az **${pkg.price}₺**`, inline: true },
        { name: '🔑 Bağış Kodun', value: `\`\`\`${claim.code}\`\`\``, inline: false },
        {
          name: '⏳ Kod Geçerliliği',
          value: `<t:${Math.floor(claim.expiresAt / 1000)}:R> sona erer`,
          inline: true,
        }
      )
      .setFooter({
        text: 'Kod sana özeldir — bağış mesajında mutlaka yer almalı, yoksa eşleştirme yapılamaz.',
      })
      .setTimestamp();

    if (pkg.stackable) {
      embed.addFields({
        name: '✨ Bonus',
        value: `Fiyatın katı kadar bağış yaparsan süren de katlanır (örn. ${pkg.price * 2}₺ → 2 kat süre).`,
        inline: false,
      });
    }

    if (!isNew) {
      embed.setDescription(
        `ℹ️ Bu paket için zaten aktif bir kodun vardı, aynı kod tekrar gösteriliyor.\n\n${steps.join('\n')}`
      );
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('💝 Bağış Yap').setStyle(ButtonStyle.Link).setURL(config.byno.publicDonateUrl)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
    logger.info('Bağış kodu üretildi', {
      user: interaction.user.tag,
      package: pkg.id,
      code: claim.code,
      isNew,
    });
  },
};
