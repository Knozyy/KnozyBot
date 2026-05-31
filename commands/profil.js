import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import PanelAPI from '../services/PanelAPI.js';
import { embeds } from '../services/embeds.js';
import { logger } from '../core/logger.js';
import axios from 'axios';
import path from 'path';
import { Jimp, loadFont } from 'jimp';
import { SANS_64_WHITE, SANS_32_WHITE, SANS_16_WHITE } from 'jimp/fonts';

// ── Helper: Draw a filled rectangle directly onto Jimp bitmap ───────────────
function drawRect(image, x, y, w, h, colorHex) {
  const r = (colorHex >> 24) & 0xFF;
  const g = (colorHex >> 16) & 0xFF;
  const b = (colorHex >> 8) & 0xFF;
  const a = colorHex & 0xFF;

  image.scan(x, y, w, h, function (xCoord, yCoord, idx) {
    this.bitmap.data[idx] = r;
    this.bitmap.data[idx + 1] = g;
    this.bitmap.data[idx + 2] = b;
    this.bitmap.data[idx + 3] = a;
  });
}

// ── Helper: Transliterate Turkish characters to ASCII ───────────────────────
// Jimp bitmap fonts don't include ş, ı, ğ, ü, ö, ç, İ etc. This prevents "?" rendering.
function toAscii(text) {
  if (!text) return '';
  return text
    .replace(/ı/g, 'i').replace(/İ/g, 'I')
    .replace(/ş/g, 's').replace(/Ş/g, 'S')
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
    .replace(/ü/g, 'u').replace(/Ü/g, 'U')
    .replace(/ö/g, 'o').replace(/Ö/g, 'O')
    .replace(/ç/g, 'c').replace(/Ç/g, 'C')
    .replace(/â/g, 'a').replace(/Â/g, 'A')
    .replace(/î/g, 'i').replace(/Î/g, 'I')
    .replace(/û/g, 'u').replace(/Û/g, 'U');
}

// ── Helper: Local Turkish date formatter (already transliterated) ───────────
function formatProfileDate(timestamp) {
  if (!timestamp) return 'Bilinmiyor';
  const date = new Date(timestamp);
  const months = [
    'Ocak', 'Subat', 'Mart', 'Nisan', 'Mayis', 'Haziran',
    'Temmuz', 'Agustos', 'Eylul', 'Ekim', 'Kasim', 'Aralik'
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

// ── Helper: Try multiple skin APIs with fallback ────────────────────────────
async function fetchSkinImage(uuid, mcNick) {
  // List of skin render APIs to try in order
  const skinApis = [
    { name: 'mc-heads', url: `https://mc-heads.net/body/${encodeURIComponent(mcNick)}/600` },
    { name: 'minotar', url: `https://minotar.net/body/${encodeURIComponent(mcNick)}/300.png` },
    { name: 'crafatar', url: `https://crafatar.com/renders/body/${uuid}?overlay&size=4` },
  ];

  for (const api of skinApis) {
    try {
      logger.debug(`Trying skin API: ${api.name} for ${mcNick}`);
      const resp = await axios.get(api.url, { responseType: 'arraybuffer', timeout: 6000 });
      if (resp.status === 200 && resp.data && resp.data.length > 100) {
        logger.info(`Skin fetched from ${api.name} for ${mcNick}`);
        return Buffer.from(resp.data);
      }
    } catch (err) {
      logger.warn(`Skin API ${api.name} failed for ${mcNick}: ${err.message}`);
    }
  }

  logger.warn(`All skin APIs failed for ${mcNick}, card will render without skin`);
  return null;
}

export default {
  data: new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Oyuncunun premium Steam benzeri profil kartını görüntüler')
    .addUserOption((option) =>
      option
        .setName('kullanici')
        .setDescription('Profilini görmek istediğiniz Discord kullanıcısı')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('nick')
        .setDescription('Minecraft oyuncu adı')
        .setRequired(false)
        .setMinLength(3)
        .setMaxLength(16)
    ),

  async execute(interaction, bot) {
    await interaction.deferReply();

    try {
      const targetUser = interaction.options.getUser('kullanici');
      const targetNick = interaction.options.getString('nick');

      let mcNick = null;
      let linkedUser = null;

      const whitelistData = await PanelAPI.getWhitelist();
      const entries = whitelistData.entries || [];

      if (targetNick) {
        mcNick = targetNick.trim();
        const link = entries.find((e) => e.mcNick.toLowerCase() === mcNick.toLowerCase());
        if (link) {
          try {
            linkedUser = await bot.users.fetch(link.userId);
          } catch {
            linkedUser = null;
          }
        }
      } else if (targetUser) {
        linkedUser = targetUser;
        const link = entries.find((e) => e.userId === targetUser.id);
        if (!link) {
          const errEmbed = embeds.errorEmbed(
            'Profil Bulunamadı',
            `**${targetUser.username}** kullanıcısının whitelist kaydı bulunamadı.`
          );
          return await interaction.editReply({ embeds: [errEmbed] });
        }
        mcNick = link.mcNick;
      } else {
        linkedUser = interaction.user;
        const link = entries.find((e) => e.userId === interaction.user.id);
        if (!link) {
          const errEmbed = embeds.errorEmbed(
            'Profil Bulunamadı',
            `Henüz whitelist kaydınız bulunmuyor! Profilinizi oluşturmak için lütfen \`/whitelist kayit\` komutunu kullanın.`
          );
          return await interaction.editReply({ embeds: [errEmbed] });
        }
        mcNick = link.mcNick;
      }

      // 1. Fetch Mojang UUID
      let uuid = '8667ba71b85a4004af544b3a8597e68d'; // Default Steve
      try {
        const mojangResp = await axios.get(
          `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(mcNick)}`,
          { timeout: 3000 }
        );
        if (mojangResp.status === 200 && mojangResp.data.id) {
          uuid = mojangResp.data.id;
          mcNick = mojangResp.data.name; // Use canonical name capitalization
        }
      } catch (err) {
        logger.debug(`Could not resolve Mojang UUID for ${mcNick}: ${err.message}`);
      }

      // 2. Fetch Player stats from Panel backend
      let profileData = null;
      try {
        profileData = await PanelAPI.getPlayerProfile(mcNick);
      } catch (err) {
        logger.warn(`Could not get panel profile for ${mcNick}: ${err.message}`);
        profileData = {
          username: mcNick,
          isOnline: false,
          totalSeconds: 0,
          sessions: [],
          firstSeen: Date.now()
        };
      }

      // 3. Determine Booster & Active role
      const guild = interaction.guild;
      let isBooster = false;
      let memberRoleName = 'Oyuncu';

      if (linkedUser && guild) {
        try {
          const member = await guild.members.fetch(linkedUser.id);
          isBooster = !!member.premiumSince;

          // Get highest non-default role name
          const roles = member.roles.cache
            .filter((r) => r.name !== '@everyone')
            .sort((a, b) => b.position - a.position);
          if (roles.size > 0) {
            memberRoleName = roles.first().name;
          }
        } catch {
          isBooster = false;
        }
      }

      // Calculate consistency
      const playtimeHours = Math.round((profileData.totalSeconds || 0) / 3600);
      const recentSessionsCount = profileData.sessions?.filter(
        (s) => Date.now() - s.joined_at < 7 * 24 * 60 * 60 * 1000
      ).length || 0;
      const isConsistent = recentSessionsCount >= 3 || playtimeHours > 10;

      // ─── 4. Draw Premium Image Card using Jimp ───────────────────────────

      const TEMPLATE_PATH = path.resolve('./assets/profile_bg.png');
      logger.info(`Rendering profile card for ${mcNick} using template: ${TEMPLATE_PATH}`);

      let imageCard = null;
      try {
        imageCard = await Jimp.read(TEMPLATE_PATH);
      } catch (err) {
        logger.error(`Failed to load profile background template: ${err.message}`);
        const fallbackEmbed = embeds.profileEmbed(profileData, uuid, linkedUser, isBooster, profileData.isOnline);
        return await interaction.editReply({ embeds: [fallbackEmbed] });
      }

      // Get template dimensions for coordinate calculations
      const tW = imageCard.width;
      const tH = imageCard.height;
      logger.debug(`Template dimensions: ${tW}x${tH}`);

      // ── A. Composite Minecraft Skin Render (left frame area) ──────────

      const skinBuffer = await fetchSkinImage(uuid, mcNick);
      if (skinBuffer) {
        try {
          const skinImg = await Jimp.read(skinBuffer);

          // Scale skin to fit the left glass frame (~40% of template width, ~55% of height)
          const skinTargetW = Math.round(tW * 0.28);
          const skinTargetH = Math.round(tH * 0.50);
          skinImg.resize({ w: skinTargetW, h: skinTargetH });

          // Center skin inside the left glass frame
          const skinX = Math.round(tW * 0.09) + Math.round((tW * 0.32 - skinTargetW) / 2);
          const skinY = Math.round(tH * 0.12) + Math.round((tH * 0.55 - skinTargetH) / 2);
          imageCard.composite(skinImg, skinX, skinY);
        } catch (err) {
          logger.warn(`Failed to composite skin image for ${mcNick}: ${err.message}`);
        }
      }

      // ── B. Load Fonts ─────────────────────────────────────────────────

      const font64 = await loadFont(SANS_64_WHITE);
      const font32 = await loadFont(SANS_32_WHITE);
      const font16 = await loadFont(SANS_16_WHITE);

      // ── C. Right side panels — coordinates relative to template ────────
      // The template has 3 glass panels on the right side (~55% to ~92% width, stacked vertically)

      const rightPanelX = Math.round(tW * 0.56);     // Left edge of right panels
      const rightTextX  = Math.round(tW * 0.58);      // Text indent inside panels

      // Panel 1: Player Name + Badges (top right panel, ~10% to ~32% height)
      const panel1Y = Math.round(tH * 0.12);

      // Print MC Nick
      const nickSafe = toAscii(mcNick);
      imageCard.print({
        font: nickSafe.length > 12 ? font32 : font64,
        x: rightTextX,
        y: panel1Y + Math.round(tH * 0.03),
        text: nickSafe
      });

      // Draw Badges below name
      let badgeX = rightTextX;
      const badgeY = panel1Y + Math.round(tH * 0.12);

      if (isBooster) {
        drawRect(imageCard, badgeX, badgeY, 150, 36, 0x7B1FA2CC);
        imageCard.print({ font: font16, x: badgeX + 30, y: badgeY + 10, text: 'BOOSTER' });
        badgeX += 165;
      }
      if (isConsistent) {
        drawRect(imageCard, badgeX, badgeY, 160, 36, 0x2E7D32CC);
        imageCard.print({ font: font16, x: badgeX + 22, y: badgeY + 10, text: 'ISTIKRARLI' });
      }

      // Panel 2: Stats — Playtime + Join Date (middle right panel, ~35% to ~56% height)
      const panel2Y = Math.round(tH * 0.36);

      // Playtime
      imageCard.print({ font: font16, x: rightTextX, y: panel2Y + Math.round(tH * 0.03), text: 'Toplam Oyun Suresi' });
      imageCard.print({
        font: font32,
        x: rightTextX,
        y: panel2Y + Math.round(tH * 0.07),
        text: `${playtimeHours} Saat`
      });

      // Join date
      imageCard.print({
        font: font16,
        x: rightTextX,
        y: panel2Y + Math.round(tH * 0.14),
        text: 'Sunucuya Katilim'
      });
      imageCard.print({
        font: font32,
        x: rightTextX,
        y: panel2Y + Math.round(tH * 0.18),
        text: formatProfileDate(profileData.firstSeen || Date.now())
      });

      // Panel 3: Active Role (bottom right panel, ~59% to ~72% height)
      const panel3Y = Math.round(tH * 0.60);

      imageCard.print({
        font: font16,
        x: rightTextX,
        y: panel3Y + Math.round(tH * 0.03),
        text: 'Aktif Rol'
      });
      imageCard.print({
        font: font32,
        x: rightTextX,
        y: panel3Y + Math.round(tH * 0.07),
        text: toAscii(memberRoleName)
      });

      // Online status indicator
      if (profileData.isOnline) {
        const dotX = rightTextX;
        const dotY = panel3Y + Math.round(tH * 0.15);
        drawRect(imageCard, dotX, dotY, 14, 14, 0x00E676FF);
        imageCard.print({ font: font16, x: dotX + 20, y: dotY, text: 'Su An Oyunda' });
      }

      // ── D. Bottom Banner — VIP & Destekci ──────────────────────────────
      // Bottom gold banner spans full width (~78% to ~93% height)
      const bottomY = Math.round(tH * 0.79);
      const bottomTextX = Math.round(tW * 0.10);

      const timedRolesData = await PanelAPI.getTimedRoles();
      const rolesList = timedRolesData.roles || [];
      const userVip = linkedUser ? rolesList.find((r) => r.user_id === linkedUser.id) : null;

      let vipRoleName = null;
      let expiryTimestamp = null;

      if (userVip && guild) {
        try {
          const role = await guild.roles.fetch(userVip.role_id);
          if (role) {
            vipRoleName = role.name;
            expiryTimestamp = userVip.expiry_timestamp;
          }
        } catch {
          vipRoleName = null;
        }
      }

      if (vipRoleName) {
        const totalSecsLeft = expiryTimestamp - Math.floor(Date.now() / 1000);
        const daysLeft = Math.max(0, Math.ceil(totalSecsLeft / 86400));

        // VIP Title
        imageCard.print({
          font: font32,
          x: bottomTextX,
          y: bottomY + Math.round(tH * 0.01),
          text: `VIP: ${toAscii(vipRoleName).toUpperCase()}`
        });

        // Progress bar
        const barX = bottomTextX;
        const barY = bottomY + Math.round(tH * 0.06);
        const barW = Math.round(tW * 0.80);
        const barH = 10;

        drawRect(imageCard, barX, barY, barW, barH, 0x3E3E3EFF);
        const barFill = Math.min(barW, Math.max(0, Math.round((daysLeft / 30) * barW)));
        if (barFill > 0) {
          drawRect(imageCard, barX, barY, barFill, barH, 0xD4AF37FF);
        }

        // Days remaining
        imageCard.print({
          font: font16,
          x: bottomTextX,
          y: bottomY + Math.round(tH * 0.09),
          text: `Kalan VIP Suresi: ${daysLeft} Gun`
        });
      } else {
        imageCard.print({
          font: font32,
          x: bottomTextX,
          y: bottomY + Math.round(tH * 0.01),
          text: 'VIP & DESTEKCI'
        });
        imageCard.print({
          font: font16,
          x: bottomTextX,
          y: bottomY + Math.round(tH * 0.06),
          text: 'Destekci olmak ve VIP ayricaliklarindan'
        });
        imageCard.print({
          font: font16,
          x: bottomTextX,
          y: bottomY + Math.round(tH * 0.09),
          text: 'yararlanmak icin yetkililerle gorusun!'
        });
      }

      // ── E. Render final image and send to Discord ─────────────────────

      const imageBuffer = await imageCard.getBuffer('image/png');
      const attachment = new AttachmentBuilder(imageBuffer, { name: `${mcNick}_profile.png` });

      await interaction.editReply({
        files: [attachment],
        embeds: [],
        components: []
      });

      logger.info(`Profile card rendered and sent successfully for ${mcNick}`);

    } catch (error) {
      logger.error('Error executing premium profile command:', { error: error.message });
      const errEmbed = embeds.errorEmbed(
        'Hata',
        error.message || 'Profil sorgulanırken bir hata oluştu.'
      );
      await interaction.editReply({ embeds: [errEmbed] });
    }
  }
};
