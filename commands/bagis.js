import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { donationStore } from '../services/donationStore.js';
import { COLORS } from '../utils/constants.js';
import { logger } from '../core/logger.js';

// ByNoGame sözleşmesi (7.2.d) donate'in ticari kullanımını yasaklar — bu yüzden
// tüm metinler "satış/ödeme" değil "destek/teşekkür avantajı" dilinde tutulur.
export default {
  data: new SlashCommandBuilder()
    .setName('bagis')
    .setDescription('Sunucuya ByNoGame üzerinden destek ol, teşekkür avantajı kazan')
    .addStringOption((opt) =>
      opt
        .setName('paket')
        .setDescription('Almak istediğin destek avantajı')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = (interaction.options.getFocused() || '').toLowerCase();
    const packages = await donationStore.enabledPackages();
    const choices = packages
      .filter((p) => p.label.toLowerCase().includes(focused) || p.id.includes(focused))
      .slice(0, 25)
      .map((p) => ({ name: `${p.label} — ${p.price}₺+ destek`, value: p.id }));
    await interaction.respond(choices);
  },

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const cfg = await donationStore.getConfig();
    if (!cfg.enabled || !cfg.donateListUrl || !cfg.publicDonateUrl) {
      return await interaction.editReply({
        content: '❌ Destek sistemi şu an aktif değil. Lütfen yetkililere bildir.',
      });
    }

    const packageId = interaction.options.getString('paket');
    const pkg = cfg.packages.find((p) => p.id === packageId && p.enabled);

    if (!pkg) {
      return await interaction.editReply({
        content: '❌ Geçersiz seçim. Listeden bir paket seçmelisin.',
      });
    }

    const { claim, isNew } = donationStore.createOrGetClaim(interaction.user.id, pkg.id, cfg);

    const incentiveNote =
      cfg.incentivePercent > 0
        ? `\n🎁 ByNoGame destekçilerine **+%${cfg.incentivePercent} süre bonusu** uygulanır!`
        : '';

    const steps = [
      `1️⃣ Aşağıdaki **Destek Ol** butonuna tıkla`,
      `2️⃣ En az **${pkg.price}₺** destek gönder`,
      `3️⃣ Bağış mesajına şu kodu yaz: \`${claim.code}\``,
      `4️⃣ Bot desteğini otomatik algılayıp avantajını tanımlar (genelde 2-3 dk içinde)`,
    ];

    const embed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setTitle('💜 Destekçi Avantajları')
      .setDescription(
        (isNew ? '' : 'ℹ️ Bu paket için zaten aktif bir kodun vardı, aynı kod tekrar gösteriliyor.\n\n') +
          steps.join('\n') +
          incentiveNote
      )
      .addFields(
        { name: '📦 Avantaj', value: pkg.label, inline: true },
        { name: '💰 Destek', value: `en az **${pkg.price}₺**`, inline: true },
        { name: '🔑 Destek Kodun', value: `\`\`\`${claim.code}\`\`\``, inline: false },
        {
          name: '⏳ Kod Geçerliliği',
          value: `<t:${Math.floor(claim.expiresAt / 1000)}:R> sona erer`,
          inline: true,
        }
      )
      .setFooter({
        text: 'Bağışlar gönüllü destektir; avantajlar teşekkür amaçlıdır. Kod bağış mesajında yer almazsa eşleştirme yapılamaz.',
      })
      .setTimestamp();

    if (pkg.stackable) {
      embed.addFields({
        name: '✨ Bonus',
        value: `Katı kadar destekte süren de katlanır (örn. ${pkg.price * 2}₺ → 2 kat süre).`,
        inline: false,
      });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('💜 Destek Ol').setStyle(ButtonStyle.Link).setURL(cfg.publicDonateUrl)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
    logger.info('Destek kodu üretildi', {
      user: interaction.user.tag,
      package: pkg.id,
      code: claim.code,
      isNew,
    });
  },
};
