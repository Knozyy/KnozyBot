import { EmbedBuilder } from 'discord.js';
import PanelAPI from '../services/PanelAPI.js';
import { bynoDonations } from '../services/BynoDonations.js';
import { donationStore } from '../services/donationStore.js';
import { config } from '../config.js';
import { COLORS } from '../utils/constants.js';
import { logger } from '../core/logger.js';

const MAX_STACK_MULTIPLIER = 12; // tek bağışla en fazla 12 kat süre

async function getLogChannel(bot, guild) {
  try {
    const settings = await PanelAPI.getBotSettings();
    const channelId = settings.donation_log_channel_id || settings.role_log_channel_id;
    if (!channelId) return null;
    return await guild.channels.fetch(channelId).catch(() => null);
  } catch {
    return null;
  }
}

async function grantPackage(bot, guild, claim, pkg, donation) {
  const multiplier = pkg.stackable
    ? Math.min(MAX_STACK_MULTIPLIER, Math.max(1, Math.floor(donation.amount / pkg.price)))
    : 1;

  if (pkg.type === 'timed_role') {
    const days = pkg.durationDays * multiplier;
    await PanelAPI.addTimedRole(claim.userId, pkg.roleId, days, 'd');
    // Rolü hemen ver — timedRolesCheck zaten 60sn'de bir senkronlar ama kullanıcı beklemesin
    const member = await guild.members.fetch(claim.userId).catch(() => null);
    if (member && !member.roles.cache.has(pkg.roleId)) {
      await member.roles.add(pkg.roleId).catch(() => null);
    }
    return { detail: `<@&${pkg.roleId}> — ${days} gün`, days, multiplier };
  }

  if (pkg.type === 'vip') {
    // Süreyi paneldeki VIP paketi belirler; katlama varsa gün sayısını biz hesaplarız
    let durationDays = null;
    if (multiplier > 1) {
      const vipPackages = await PanelAPI.getVipPackages();
      const vipPkg = vipPackages.find((p) => p.id === pkg.vipPackageId);
      if (vipPkg && Number(vipPkg.duration_days) > 0) {
        durationDays = Number(vipPkg.duration_days) * multiplier;
      }
    }
    await PanelAPI.addVipGrant({
      packageId: pkg.vipPackageId,
      userId: claim.userId,
      durationDays,
      note: `ByNoGame bağışı — ${donation.amount}₺ (${donation.nickName}, kod: ${claim.code})`,
    });
    return {
      detail: `VIP: ${pkg.label}${durationDays ? ` — ${durationDays} gün` : ''}`,
      days: durationDays,
      multiplier,
    };
  }

  throw new Error(`Bilinmeyen paket tipi: ${pkg.type}`);
}

async function notifySuccess(bot, guild, logChannel, claim, pkg, donation, grantResult) {
  // Kullanıcıya DM
  try {
    const user = await bot.users.fetch(claim.userId);
    await user.send(
      `🎉 **${donation.amount}₺** bağışın için teşekkürler!\n` +
        `**${pkg.label}** paketin tanımlandı${grantResult.multiplier > 1 ? ` (${grantResult.multiplier} kat süre bonusuyla)` : ''}.` +
        (grantResult.days ? `\nSüre: **${grantResult.days} gün**` : '')
    );
  } catch {
    // DM kapalı
  }

  if (logChannel) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle('💝 Bağış → Otomatik Tanımlama')
      .addFields(
        { name: 'Kullanıcı', value: `<@${claim.userId}>`, inline: true },
        { name: 'Tutar', value: `${donation.amount}₺`, inline: true },
        { name: 'Paket', value: grantResult.detail, inline: true },
        { name: 'ByNoGame Nick', value: donation.nickName, inline: true },
        { name: 'Kod', value: `\`${claim.code}\``, inline: true }
      )
      .setTimestamp();
    await logChannel.send({ embeds: [embed] }).catch(() => null);
  }
}

async function notifyUnmatched(logChannel, donation, reason) {
  if (!logChannel) return;
  const embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle('⚠️ Eşleşmeyen Bağış')
    .setDescription(reason)
    .addFields(
      { name: 'ByNoGame Nick', value: donation.nickName || '—', inline: true },
      { name: 'Tutar', value: `${donation.amount}₺`, inline: true },
      {
        name: 'Mesaj',
        value: donation.message ? donation.message.slice(0, 500) : '_(mesaj yok)_',
        inline: false,
      }
    )
    .setFooter({ text: 'Gerekirse !gecici-rol ile manuel tanımlama yapabilirsiniz.' })
    .setTimestamp();
  await logChannel.send({ embeds: [embed] }).catch(() => null);
}

export default {
  name: 'donationCheck',
  interval: 2 * 60 * 1000, // 2 dakika

  async execute(bot) {
    if (!config.byno.donateListUrl) return;

    const enabledPackages = donationStore.enabledPackages();
    if (enabledPackages.length === 0) return;

    const guild = bot.guilds.cache.get(config.discord.guildId) || bot.guilds.cache.first();
    if (!guild) return;

    let donations;
    try {
      donations = await bynoDonations.fetchDonations(config.byno.donateListUrl);
    } catch (error) {
      logger.warn('ByNoGame bağış listesi çekilemedi:', { error: error.message });
      return;
    }

    // İlk çalıştırma: mevcut geçmişi baseline al, geriye dönük işlem yapma
    if (donationStore.ensureBaseline(donations.map((d) => d.id))) {
      logger.info('Bağış geçmişi baseline alındı', { count: donations.length });
      return;
    }

    donationStore.expireOldClaims();

    const cfg = donationStore.getConfig();
    const logChannel = await getLogChannel(bot, guild);

    for (const donation of donations) {
      if (donationStore.isSeen(donation.id)) continue;
      donationStore.markSeen(donation.id);

      if (donation.isDeleted) continue;

      logger.info('Yeni bağış algılandı', {
        nick: donation.nickName,
        amount: donation.amount,
        id: donation.id,
      });

      const code = donationStore.findCodeInMessage(donation.message);

      if (!code) {
        if (donation.amount >= cfg.minNotifyAmount) {
          await notifyUnmatched(logChannel, donation, 'Bağış mesajında kod bulunamadı.');
        }
        continue;
      }

      const claim = donationStore.findActiveClaimByCode(code);
      if (!claim) {
        const oldClaim = donationStore.findAnyClaimByCode(code);
        const reason =
          oldClaim?.status === 'completed'
            ? `\`${code}\` kodu daha önce kullanılmış.`
            : oldClaim?.status === 'expired'
              ? `\`${code}\` kodunun süresi dolmuş (kullanıcı: <@${oldClaim.userId}>).`
              : `\`${code}\` koduna ait kayıt bulunamadı.`;
        await notifyUnmatched(logChannel, donation, reason);
        continue;
      }

      const pkg = donationStore.getPackage(claim.packageId);
      if (!pkg || !pkg.enabled) {
        await notifyUnmatched(
          logChannel,
          donation,
          `\`${code}\` kodu geçerli ama paketi (${claim.packageId}) artık aktif değil.`
        );
        continue;
      }

      if (donation.amount < pkg.price) {
        await notifyUnmatched(
          logChannel,
          donation,
          `\`${code}\` kodu <@${claim.userId}> kullanıcısına ait ama tutar yetersiz ` +
            `(${donation.amount}₺ < ${pkg.price}₺). Kod aktif kalmaya devam ediyor.`
        );
        try {
          const user = await bot.users.fetch(claim.userId);
          await user.send(
            `⚠️ **${donation.amount}₺** bağışın algılandı ancak **${pkg.label}** paketi için en az ` +
              `**${pkg.price}₺** gerekiyor. Eksik tutar tamamlanamaz — paket için tek seferde ` +
              `${pkg.price}₺ ve üzeri bağış yapman gerekiyor. Durumun için yetkililere ulaşabilirsin.`
          );
        } catch {
          // DM kapalı
        }
        continue;
      }

      try {
        const grantResult = await grantPackage(bot, guild, claim, pkg, donation);
        donationStore.completeClaim(code, donation, grantResult.detail);
        await notifySuccess(bot, guild, logChannel, claim, pkg, donation, grantResult);
        logger.info('Bağış işlendi, paket tanımlandı', {
          user: claim.userId,
          package: pkg.id,
          amount: donation.amount,
          code,
        });
      } catch (error) {
        logger.error('Bağış işlenirken grant hatası:', { error: error.message, code });
        await notifyUnmatched(
          logChannel,
          donation,
          `\`${code}\` kodu eşleşti (<@${claim.userId}>, paket: ${pkg.label}) ama tanımlama sırasında ` +
            `hata oluştu: ${error.message}\nManuel tanımlama gerekebilir.`
        );
      }
    }
  },
};
