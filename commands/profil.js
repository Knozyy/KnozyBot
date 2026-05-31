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

// ── Helper: Transliterate Turkish characters to ASCII & strip unsupported chars ─
// Jimp bitmap fonts only include basic ASCII. This prevents "?" rendering for
// Turkish chars (ş, ı, ğ, ü, ö, ç) AND emoji/unicode symbols in role names.
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
    .replace(/û/g, 'u').replace(/Û/g, 'U')
    // Strip ALL remaining non-ASCII characters (emoji, special unicode, etc.)
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
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
      // Left glass frame on this template: approx x:65-465, y:80-720
      // Frame inner area: approx x:85-445, y:100-700 (padding ~20px from border)

      const FRAME_X = 85, FRAME_Y = 100, FRAME_W = 360, FRAME_H = 600;

      const skinBuffer = await fetchSkinImage(uuid, mcNick);
      if (skinBuffer) {
        try {
          const skinImg = await Jimp.read(skinBuffer);
          const origW = skinImg.width;
          const origH = skinImg.height;

          // Preserve aspect ratio: fit within the frame
          const scale = Math.min(FRAME_W / origW, FRAME_H / origH);
          const newW = Math.round(origW * scale);
          const newH = Math.round(origH * scale);
          skinImg.resize({ w: newW, h: newH });

          // Center skin inside the left glass frame
          const skinX = FRAME_X + Math.round((FRAME_W - newW) / 2);
          const skinY = FRAME_Y + Math.round((FRAME_H - newH) / 2);
          imageCard.composite(skinImg, skinX, skinY);

          logger.debug(`Skin composited: orig ${origW}x${origH}, scaled ${newW}x${newH}, pos (${skinX},${skinY})`);
        } catch (err) {
          logger.warn(`Failed to composite skin image for ${mcNick}: ${err.message}`);
        }
      }

      // ── B. Load Fonts ─────────────────────────────────────────────────

      const font64 = await loadFont(SANS_64_WHITE);
      const font32 = await loadFont(SANS_32_WHITE);
      const font16 = await loadFont(SANS_16_WHITE);

      // ── C. Right side panels — PIXEL-PRECISE coordinates ─────────────────
      // Template: 1024x1024
      // Right Panel 1 (name+badges):  inner area ~x:530-945, y:95-270
      // Right Panel 2 (playtime):     inner area ~x:530-945, y:310-485
      // Right Panel 3 (role+join):    inner area ~x:530-945, y:525-695

      const RX = 540;  // Right panels text left margin

      // ─── Panel 1: Player Name + Badges ─────────────────────────────────
      const nickSafe = toAscii(mcNick);
      imageCard.print({
        font: nickSafe.length > 12 ? font32 : font64,
        x: RX,
        y: 110,
        text: nickSafe
      });

      // Badges row
      let badgeX = RX;
      const badgeY = 195;

      if (isBooster) {
        drawRect(imageCard, badgeX, badgeY, 140, 32, 0x7B1FA2CC);
        imageCard.print({ font: font16, x: badgeX + 28, y: badgeY + 8, text: 'BOOSTER' });
        badgeX += 155;
      }
      if (isConsistent) {
        drawRect(imageCard, badgeX, badgeY, 155, 32, 0x2E7D32CC);
        imageCard.print({ font: font16, x: badgeX + 20, y: badgeY + 8, text: 'ISTIKRARLI' });
      }

      // ─── Panel 2: Toplam Oyun Süresi ───────────────────────────────────
      imageCard.print({ font: font16, x: RX, y: 325, text: 'Toplam Oyun Suresi' });
      imageCard.print({ font: font32, x: RX, y: 355, text: `${playtimeHours} Saat` });

      // Sunucuya Katılım (still in panel 2)
      imageCard.print({ font: font16, x: RX, y: 415, text: 'Sunucuya Katilim' });
      imageCard.print({ font: font32, x: RX, y: 440, text: formatProfileDate(profileData.firstSeen || Date.now()) });

      // ─── Panel 3: Aktif Rol + Online status ────────────────────────────
      imageCard.print({ font: font16, x: RX, y: 540, text: 'Aktif Rol' });
      imageCard.print({ font: font32, x: RX, y: 565, text: toAscii(memberRoleName) });

      // Online status indicator
      if (profileData.isOnline) {
        drawRect(imageCard, RX, 620, 14, 14, 0x00E676FF);
        imageCard.print({ font: font16, x: RX + 22, y: 620, text: 'Su An Oyunda' });
      }

      // ── D. Bottom Banner — VIP & Destekci ──────────────────────────────
      // Bottom gold banner inner area: approx x:75-955, y:755-925
      const BTM_X = 95;
      const BTM_Y = 770;

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
        imageCard.print({ font: font32, x: BTM_X, y: BTM_Y, text: `VIP: ${toAscii(vipRoleName).toUpperCase()}` });

        // Progress bar (within banner bounds)
        const barX = BTM_X;
        const barY = BTM_Y + 50;
        const barW = 830;
        const barH = 12;

        drawRect(imageCard, barX, barY, barW, barH, 0x3E3E3EFF);
        const barFill = Math.min(barW, Math.max(0, Math.round((daysLeft / 30) * barW)));
        if (barFill > 0) {
          drawRect(imageCard, barX, barY, barFill, barH, 0xD4AF37FF);
        }

        // Days remaining
        imageCard.print({ font: font16, x: BTM_X, y: BTM_Y + 72, text: `Kalan VIP Suresi: ${daysLeft} Gun` });
      } else {
        imageCard.print({ font: font32, x: BTM_X, y: BTM_Y, text: 'VIP & DESTEKCI' });
        imageCard.print({ font: font16, x: BTM_X, y: BTM_Y + 45, text: 'Destekci olmak ve VIP ayricaliklarindan' });
        imageCard.print({ font: font16, x: BTM_X, y: BTM_Y + 68, text: 'yararlanmak icin yetkililerle gorusun!' });
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
