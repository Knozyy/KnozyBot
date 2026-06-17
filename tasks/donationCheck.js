import { EmbedBuilder } from 'discord.js';
import PanelAPI from '../services/PanelAPI.js';
import { bynoDonations } from '../services/BynoDonations.js';
import { donationStore } from '../services/donationStore.js';
import { COLORS } from '../utils/constants.js';
import { logger } from '../core/logger.js';

const MAX_STACK_MULTIPLIER = 12; // tek destekle en fazla 12 kat süre

// ByNoGame'e karşı nazik davran: üst üste hata alırsak bir süre tarama yapma
const FAIL_THRESHOLD = 3;
const COOLDOWN_CYCLES = 5;
let consecutiveFailures = 0;
let cooldownRemaining = 0;

/** Teşvik bonusu: %10 → 30 gün yerine 33 gün */
function applyIncentive(days, percent) {
  if (!percent || days <= 0) return days;
  return Math.round(days * (1 + percent / 100));
}

async function getLogChannel(bot, guild, cfg) {
  try {
    let channelId = cfg.donationLogChannelId;
    if (!channelId) {
      const settings = await PanelAPI.getBotSettings();
      channelId = settings.role_log_channel_id;
    }
    if (!channelId) return null;
    return await guild.channels.fetch(channelId).catch(() => null);
  } catch {
    return null;
  }
}

/**
 * Süreli rol: aynı rol için aktif kayıt varsa süresi ÜSTÜNE eklenir (uzatma),
 * yoksa yeni kayıt + rol anında verilir.
 */
async function grantTimedRole(guild, claim, pkg, totalDays) {
  const nowSec = Math.floor(Date.now() / 1000);

  const timedRoles = await PanelAPI.getTimedRoles();
  const rolesList = timedRoles.roles || [];
  const existingIndex = rolesList.findIndex(
    (r) =>
      String(r.user_id) === String(claim.userId) &&
      String(r.role_id) === String(pkg.roleId) &&
      r.expiry_timestamp > nowSec
  );

  if (existingIndex !== -1) {
    // Kalan süre + yeni süre → kaydı yenile
    const remainingHours = Math.max(0, (rolesList[existingIndex].expiry_timestamp - nowSec) / 3600);
    const totalHours = Math.round(remainingHours + totalDays * 24);
    await PanelAPI.removeTimedRole(existingIndex);
    await PanelAPI.addTimedRole(claim.userId, pkg.roleId, totalHours, 'h');
    return { mode: 'extended', totalDays: Math.round(totalHours / 24) };
  }

  await PanelAPI.addTimedRole(claim.userId, pkg.roleId, totalDays, 'd');
  // Rolü hemen ver — timedRolesCheck zaten 60sn'de bir senkronlar ama kullanıcı beklemesin
  const member = await guild.members.fetch(claim.userId).catch(() => null);
  if (member && !member.roles.cache.has(pkg.roleId)) {
    await member.roles.add(pkg.roleId).catch(() => null);
  }
  return { mode: 'new', totalDays };
}

/**
 * VIP: aynı paket → mevcut grant uzatılır. Daha değerli pakete geçiş (upgrade) →
 * eski paketlerin kalan süresi günlük değer oranıyla yeni pakete çevrilir,
 * eskiler iptal edilir, yeni paket toplam süreyle verilir.
 */
async function grantVip(claim, pkg, cfg, donation, multiplier) {
  const vipPackages = await PanelAPI.getVipPackages();
  const newVip = vipPackages.find((p) => Number(p.id) === Number(pkg.vipPackageId));
  if (!newVip) throw new Error(`Panelde VIP paketi bulunamadı (id: ${pkg.vipPackageId})`);

  const baseDays = Number(newVip.duration_days) || 0;
  const totalDays = applyIncentive(baseDays * multiplier, cfg.incentivePercent);
  const note = `ByNoGame desteği — ${donation.amount}₺ (${donation.nickName}, kod: ${claim.code})`;
  const nowSec = Math.floor(Date.now() / 1000);
  const activeGrants = await PanelAPI.getVipByUser(claim.userId);

  // 1) Aynı paket zaten aktifse: uzat
  const sameGrant = activeGrants.find((g) => Number(g.package_id) === Number(pkg.vipPackageId));
  if (sameGrant) {
    if (sameGrant.expires_at == null) {
      return { mode: 'unlimited', totalDays: 0, warning: 'Kullanıcının bu paketi zaten süresiz — süre eklenmedi.' };
    }
    await PanelAPI.extendVipGrant(sameGrant.id, totalDays);
    const remaining = Math.max(0, Math.ceil((sameGrant.expires_at - nowSec) / 86400));
    return { mode: 'extended', totalDays: remaining + totalDays };
  }

  // 2) Üst kademeye geçiş: eski paketlerin kalan süresini değer oranıyla çevir
  // Günlük değer = paket fiyatı / paket süresi; sadece bağış paketlerinde tanımlı VIP'ler çevrilebilir
  const newDaily = pkg.price / Math.max(1, Number(newVip.duration_days) || 0);
  let convertedDays = 0;
  const conversionNotes = [];
  const revokeWarnings = [];

  for (const grant of activeGrants) {
    if (grant.expires_at == null) continue; // süresiz alt paket — dokunma
    const oldCfgPkg = cfg.packages.find(
      (p) => p.type === 'vip' && Number(p.vipPackageId) === Number(grant.package_id)
    );
    const oldVip = vipPackages.find((p) => Number(p.id) === Number(grant.package_id));
    if (!oldCfgPkg || !oldVip || !(Number(oldVip.duration_days) > 0)) continue;

    const oldDaily = oldCfgPkg.price / Number(oldVip.duration_days);
    if (oldDaily >= newDaily) continue; // sadece üst kademeye geçişte çevir

    const remainingDays = Math.max(0, (grant.expires_at - nowSec) / 86400);
    const converted = Math.round(remainingDays * (oldDaily / newDaily));

    try {
      await PanelAPI.revokeVipGrant(grant.id, `Üst pakete geçiş: ${pkg.label} (kod: ${claim.code})`);
      convertedDays += converted;
      conversionNotes.push(`${grant.package_name}: kalan ${Math.round(remainingDays)} gün → +${converted} gün`);
    } catch (e) {
      // MC sunucusu kapalıysa revoke 409 dönebilir — yeni paketi yine ver, admin'e haber et
      revokeWarnings.push(`${grant.package_name} geri alınamadı (${e.message}) — manuel kontrol gerekli.`);
    }
  }

  await PanelAPI.addVipGrant({
    packageId: Number(pkg.vipPackageId),
    userId: claim.userId,
    durationDays: Number(newVip.duration_days) > 0 ? totalDays + convertedDays : null,
    note,
  });

  return {
    mode: convertedDays > 0 ? 'upgraded' : 'new',
    totalDays: Number(newVip.duration_days) > 0 ? totalDays + convertedDays : 0,
    convertedDays,
    conversionNotes,
    warning: revokeWarnings.join('\n') || null,
  };
}

async function grantPackage(guild, claim, pkg, cfg, donation) {
  const multiplier = pkg.stackable
    ? Math.min(MAX_STACK_MULTIPLIER, Math.max(1, Math.floor(donation.amount / pkg.price)))
    : 1;

  if (pkg.type === 'timed_role') {
    const totalDays = applyIncentive(pkg.durationDays * multiplier, cfg.incentivePercent);
    const result = await grantTimedRole(guild, claim, pkg, totalDays);
    return { ...result, multiplier, grantedDays: totalDays, label: pkg.label };
  }

  if (pkg.type === 'vip') {
    const result = await grantVip(claim, pkg, cfg, donation, multiplier);
    return { ...result, multiplier, label: pkg.label };
  }

  throw new Error(`Bilinmeyen paket tipi: ${pkg.type}`);
}

function describeGrant(result) {
  const parts = [];
  if (result.mode === 'extended') parts.push(`süre uzatıldı — toplam ~${result.totalDays} gün kaldı`);
  else if (result.mode === 'upgraded')
    parts.push(`üst pakete geçildi — ${result.totalDays} gün (+${result.convertedDays} gün eski paketten aktarıldı)`);
  else if (result.mode === 'unlimited') parts.push('zaten süresiz üyelik mevcut');
  else if (result.totalDays > 0) parts.push(`${result.totalDays} gün`);
  else parts.push('süresiz');
  if (result.multiplier > 1) parts.push(`${result.multiplier}× destek katı`);
  return parts.join(' · ');
}

async function notifySuccess(bot, logChannel, claim, pkg, donation, result, cfg) {
  try {
    const user = await bot.users.fetch(claim.userId);
    const bonusLine = cfg.incentivePercent > 0 ? `\n🎁 ByNoGame destek bonusu: +%${cfg.incentivePercent} süre` : '';
    const modeLine =
      result.mode === 'extended'
        ? `\n⏱️ Mevcut süren uzatıldı — toplam **~${result.totalDays} gün**`
        : result.mode === 'upgraded'
          ? `\n⬆️ Üst pakete geçtin! Eski paketinden **+${result.convertedDays} gün** aktarıldı — toplam **${result.totalDays} gün**`
          : result.totalDays > 0
            ? `\nSüre: **${result.totalDays} gün**`
            : '';
    await user.send(
      `🎉 **${donation.amount}₺** desteğin için teşekkürler!\n**${pkg.label}** avantajın tanımlandı.` +
        modeLine +
        bonusLine +
        (result.multiplier > 1 ? `\n✨ ${result.multiplier} kat destek bonusu uygulandı` : '')
    );
  } catch {
    // DM kapalı
  }

  if (logChannel) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle('💜 Destek → Otomatik Tanımlama')
      .addFields(
        { name: 'Kullanıcı', value: `<@${claim.userId}>`, inline: true },
        { name: 'Destek', value: `${donation.amount}₺`, inline: true },
        { name: 'Avantaj', value: `${pkg.label}\n${describeGrant(result)}`, inline: false },
        { name: 'ByNoGame Nick', value: donation.nickName, inline: true },
        { name: 'Kod', value: `\`${donationStore.codeToNatural(claim.code)}\``, inline: true }
      )
      .setTimestamp();
    if (result.conversionNotes?.length) {
      embed.addFields({ name: 'Paket Aktarımı', value: result.conversionNotes.join('\n'), inline: false });
    }
    if (result.warning) {
      embed.addFields({ name: '⚠️ Uyarı', value: result.warning, inline: false });
    }
    await logChannel.send({ embeds: [embed] }).catch(() => null);
  }
}

async function notifyUnmatched(logChannel, donation, reason) {
  if (!logChannel) return;
  const embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle('⚠️ Eşleşmeyen Destek')
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
    .setFooter({ text: 'Gerekirse !gecici-rol veya panel VIP sayfasıyla manuel tanımlama yapabilirsiniz.' })
    .setTimestamp();
  await logChannel.send({ embeds: [embed] }).catch(() => null);
}

export default {
  name: 'donationCheck',
  interval: 2 * 60 * 1000, // 2 dakika

  async execute(bot) {
    const cfg = await donationStore.getConfig();
    if (!cfg.enabled || !cfg.donateListUrl) return;
    if (!cfg.packages.some((p) => p.enabled)) return;

    if (cooldownRemaining > 0) {
      cooldownRemaining--;
      return;
    }

    const guild = bot.guilds.cache.get(bot.guildId) || bot.guilds.cache.first();
    if (!guild) return;

    let donations;
    try {
      donations = await bynoDonations.fetchDonations(cfg.donateListUrl);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures++;
      // Gerçek sebebi (HTTP kodu / network hatası) tek satıra göm — Winston meta
      // objesini terminale yansıtmadığından eskiden sadece "çekilemedi" görünüyordu.
      const status = error.response?.status;
      const code = error.code; // ECONNREFUSED, ETIMEDOUT, ENOTFOUND vb.
      const detail = [status && `HTTP ${status}`, code, error.message].filter(Boolean).join(' · ');
      logger.warn(`ByNoGame bağış listesi çekilemedi (${consecutiveFailures}. hata): ${detail}`);
      if (consecutiveFailures >= FAIL_THRESHOLD) {
        cooldownRemaining = COOLDOWN_CYCLES;
        logger.warn(`Bağış taraması ${COOLDOWN_CYCLES} tur (${COOLDOWN_CYCLES * 2} dk) durduruldu — üst üste hata. URL ve sunucu erişimini kontrol edin.`);
      }
      return;
    }

    // İlk çalıştırma: mevcut geçmişi baseline al, geriye dönük işlem yapma
    if (donationStore.ensureBaseline(donations.map((d) => d.id))) {
      logger.info('Bağış geçmişi baseline alındı', { count: donations.length });
      return;
    }

    donationStore.expireOldClaims();

    const logChannel = await getLogChannel(bot, guild, cfg);

    for (const donation of donations) {
      if (donationStore.isSeen(donation.id)) continue;
      donationStore.markSeen(donation.id);

      if (donation.isDeleted) continue;

      logger.info('Yeni bağış algılandı', {
        nick: donation.nickName,
        amount: donation.amount,
        id: donation.id,
      });

      // Mesajdaki tüm "hoodoo <kelime>" adaylarını topla, aktif claim'le eşleştir
      const candidates = donationStore.findCodesInMessage(donation.message, cfg);

      let claim = null;
      let code = null;
      for (const cand of candidates) {
        const active = donationStore.findActiveClaimByCode(cand);
        if (active) {
          claim = active;
          code = cand;
          break;
        }
      }

      if (!claim) {
        // Aktif claim yok. Adaylardan biri kullanılmış/süresi dolmuş gerçek bir kod mu?
        const usedCode = candidates.find((c) => donationStore.findAnyClaimByCode(c));
        if (usedCode) {
          const oldClaim = donationStore.findAnyClaimByCode(usedCode);
          const reason =
            oldClaim.status === 'completed'
              ? `\`${donationStore.codeToNatural(usedCode)}\` kodu daha önce kullanılmış.`
              : oldClaim.status === 'expired'
                ? `\`${donationStore.codeToNatural(usedCode)}\` kodunun süresi dolmuş (kullanıcı: <@${oldClaim.userId}>).`
                : `\`${donationStore.codeToNatural(usedCode)}\` koduna ait kayıt bulunamadı.`;
          await notifyUnmatched(logChannel, donation, reason);
        } else if (donation.amount >= cfg.minNotifyAmount) {
          // Hiçbir aday gerçek koda denk gelmedi → normal bağış muamelesi
          await notifyUnmatched(logChannel, donation, 'Bağış mesajında geçerli bir üyelik kodu yok (normal bağış olabilir).');
        }
        continue;
      }

      const pkg = cfg.packages.find((p) => p.id === claim.packageId);
      if (!pkg || !pkg.enabled) {
        await notifyUnmatched(
          logChannel,
          donation,
          `\`${donationStore.codeToNatural(code)}\` kodu geçerli ama paketi (${claim.packageId}) artık aktif değil.`
        );
        continue;
      }

      if (donation.amount < pkg.price) {
        await notifyUnmatched(
          logChannel,
          donation,
          `\`${donationStore.codeToNatural(code)}\` kodu <@${claim.userId}> kullanıcısına ait ama tutar yetersiz ` +
            `(${donation.amount}₺ < ${pkg.price}₺). Kod aktif kalmaya devam ediyor.`
        );
        try {
          const user = await bot.users.fetch(claim.userId);
          await user.send(
            `⚠️ **${donation.amount}₺** desteğin algılandı ancak **${pkg.label}** için en az ` +
              `**${pkg.price}₺** gerekiyor. Tek seferde ${pkg.price}₺ ve üzeri destek gerekiyor — ` +
              `durumun için yetkililere ulaşabilirsin.`
          );
        } catch {
          // DM kapalı
        }
        continue;
      }

      try {
        const result = await grantPackage(guild, claim, pkg, cfg, donation);
        donationStore.completeClaim(code, donation, describeGrant(result));
        await notifySuccess(bot, logChannel, claim, pkg, donation, result, cfg);
        logger.info('Bağış işlendi, avantaj tanımlandı', {
          user: claim.userId,
          package: pkg.id,
          amount: donation.amount,
          code,
          mode: result.mode,
        });
      } catch (error) {
        logger.error('Bağış işlenirken grant hatası:', { error: error.message, code });
        await notifyUnmatched(
          logChannel,
          donation,
          `\`${donationStore.codeToNatural(code)}\` kodu eşleşti (<@${claim.userId}>, paket: ${pkg.label}) ama tanımlama sırasında ` +
            `hata oluştu: ${error.message}\nManuel tanımlama gerekebilir.`
        );
      }
    }
  },
};
