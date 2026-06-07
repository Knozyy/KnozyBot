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
      .map((u) => `• **${u.username || u.discordName}** → \`${u.mcNick}\``)
      .join('\n');

    return new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle(`${EMOJIS.WHITELIST} Whitelist Listesi`)
      .setDescription(userList || 'Whitelist boş')
      .setFooter({ text: `Sayfa ${page}/${totalPages}` })
      .setTimestamp();
  },

  dashboardEmbed: (servers, chartUrl = null, lagGuard = null) => {
    const serverList = servers
      .map((s) => `• **${s.name}**: ${s.status === 'running' ? '🟢' : '🔴'} (${s.onlinePlayers}/${s.maxPlayers})`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(`${EMOJIS.DASHBOARD} Dashboard`)
      .setDescription(serverList || 'Sunucu yok')
      .setTimestamp();

    if (lagGuard) {
      // Stabilite seviyesi → Türkçe etiket + emoji (panel: unknown/stable/minor/warn/critical)
      const LEVELS = {
        stable:   { emoji: '🟢', label: 'STABİL' },
        minor:    { emoji: '🟡', label: 'SINIRDA' },
        warn:     { emoji: '🟠', label: 'UYARI' },
        critical: { emoji: '🔴', label: 'KRİTİK' },
        unknown:  { emoji: '⚪', label: 'BİLİNMİYOR' },
      };
      const lvl = LEVELS[lagGuard.level] || LEVELS.unknown;

      const tpsVal = lagGuard.tps != null ? parseFloat(lagGuard.tps).toFixed(1) : '—';
      const msptVal = lagGuard.mspt != null ? `${parseFloat(lagGuard.mspt).toFixed(1)} ms` : '—';

      // Mini trend grafiği (sparkline) — status endpoint'inden gelen ring verisi
      const BLOCKS = '▁▂▃▄▅▆▇█';
      const spark = (vals, min, max) => {
        const pts = vals.filter(v => v != null).slice(-24);
        if (pts.length < 2) return '';
        const span = (max - min) || 1;
        return pts.map(v => BLOCKS[Math.max(0, Math.min(7, Math.round(((v - min) / span) * 7)))]).join('');
      };
      const ring = Array.isArray(lagGuard.ring) ? lagGuard.ring : [];
      const tpsSpark = spark(ring.map(r => r.tps), 0, 20);
      const msptPeak = Math.max(100, ...ring.map(r => r.mspt || 0));
      const msptSpark = spark(ring.map(r => r.mspt), 0, msptPeak);

      embed.addFields(
        { name: '📊 Durum', value: `**${lvl.emoji} ${lvl.label}**`, inline: true },
        { name: '⚡ TPS', value: `\`${tpsVal}\` /20`, inline: true },
        { name: '⏱️ MSPT', value: `\`${msptVal}\``, inline: true }
      );
      if (tpsSpark || msptSpark) {
        embed.addFields({
          name: '📈 Trend (son ~12 dk)',
          value: `TPS  \`${tpsSpark || '—'}\`\nMSPT \`${msptSpark || '—'}\``,
          inline: false,
        });
      }
    }
      
    if (chartUrl) {
      embed.setImage(chartUrl);
    }
    
    return embed;
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

  // Main player profile embed
  profileEmbed: (playerData, uuid, discordUser, isBooster, isOnline) => {
    const playtimeHours = Math.round((playerData.totalSeconds || 0) / 3600);
    const lastSeenFormatted = playerData.lastSeen
      ? `<t:${Math.floor(playerData.lastSeen / 1000)}:R>`
      : 'Bilinmiyor';
    const firstSeenFormatted = playerData.firstSeen
      ? `<t:${Math.floor(playerData.firstSeen / 1000)}:D>`
      : 'Bilinmiyor';

    const badges = [];
    if (isBooster) badges.push('🔮 **Booster**');
    
    // Calculate consistency: active in the last 7 days (at least 3 session count or total hours)
    const recentSessionsCount = playerData.sessions?.filter(
      (s) => Date.now() - s.joined_at < 7 * 24 * 60 * 60 * 1000
    ).length || 0;
    
    if (recentSessionsCount >= 3 || playtimeHours > 10) {
      badges.push('🟢 **İstikrarlı**');
    }

    const badgeStr = badges.length > 0 ? badges.join(' · ') : 'Henüz rozet yok';

    return new EmbedBuilder()
      .setColor(isOnline ? '#2ecc71' : '#7f8c8d')
      .setTitle(`🎴 ${playerData.username} Oyuncu Profili`)
      .setDescription(`Bu profil **${discordUser ? `<@${discordUser.id}>` : 'Bilinmeyen'}** adlı kullanıcıya aittir.`)
      .setThumbnail(`https://crafatar.com/renders/body/${uuid || '8667ba71-b85a-4004-af54-4b3a8597e68d'}?overlay`)
      .addFields(
        { name: '⭐ Kazanılan Rozetler', value: badgeStr, inline: false },
        { name: '⏱️ Toplam Oyun Süresi', value: `\`${playtimeHours} Saat\``, inline: true },
        { name: '📅 Sunucuya Katılım', value: firstSeenFormatted, inline: true },
        { name: '🟢 Aktiflik Durumu', value: isOnline ? '🟢 **Şu an oyunda**' : `🔴 Çevrimdışı (Son giriş: ${lastSeenFormatted})`, inline: false }
      )
      .setTimestamp();
  },

  // VIP player profile embed
  vipProfileEmbed: (playerData, uuid, discordUser, vipRole, expiryTimestamp) => {
    const embed = new EmbedBuilder()
      .setColor('#f1c40f')
      .setTitle(`👑 VIP & Destekçi Bilgisi - ${playerData.username}`)
      .setThumbnail(`https://crafatar.com/renders/body/${uuid || '8667ba71-b85a-4004-af54-4b3a8597e68d'}?overlay`)
      .setTimestamp();

    if (vipRole) {
      const totalSecsLeft = expiryTimestamp - Math.floor(Date.now() / 1000);
      const daysLeft = Math.max(0, Math.ceil(totalSecsLeft / 86400));
      
      // Visual progress bar of 10 blocks (30 days total assumed or just 10 blocks showing active state)
      const barLength = 10;
      const filledBlocks = Math.min(barLength, Math.max(0, Math.round((daysLeft / 30) * barLength)));
      const progressBar = '▰'.repeat(filledBlocks) + '▱'.repeat(barLength - filledBlocks);

      embed.addFields(
        { name: '👑 Aktif VIP Üyeliği', value: `**${vipRole.name}**`, inline: true },
        { name: '⏳ Kalan VIP Süresi', value: `\`${daysLeft} Gün\``, inline: true },
        { name: '📊 Üyelik İlerlemesi', value: `\`[${progressBar}]\` (Kalan: ${daysLeft} gün)`, inline: false }
      );
    } else {
      embed.setDescription('Bu kullanıcının aktif bir VIP üyeliği bulunmamaktadır.\nSunucumuza destek olmak ve VIP ayrıcalıklarından yararlanmak için yöneticilerle iletişime geçebilirsiniz!');
    }

    return embed;
  },
};

export default embeds;
