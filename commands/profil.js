import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import PanelAPI from '../services/PanelAPI.js';
import { embeds } from '../services/embeds.js';
import { logger } from '../core/logger.js';
import axios from 'axios';
import { Jimp, loadFont } from 'jimp';
import { SANS_64_WHITE, SANS_32_WHITE, SANS_16_WHITE } from 'jimp/fonts';

// ═══════════════════════════════════════════════════════════════════════════
// CARD LAYOUT — All positions in absolute pixels, 100% controlled
// ═══════════════════════════════════════════════════════════════════════════

const CARD_W = 900;
const CARD_H = 500;
const PAD = 20;
const GAP = 15;

// Panel bounds (x, y, w, h)
const SKIN_PANEL  = { x: PAD, y: PAD, w: 260, h: 380 };
const NAME_PANEL  = { x: PAD + 260 + GAP, y: PAD, w: 900 - PAD * 2 - 260 - GAP, h: 100 };
const STATS_PANEL = { x: PAD + 260 + GAP, y: PAD + 100 + GAP, w: 900 - PAD * 2 - 260 - GAP, h: 265 };
const VIP_PANEL   = { x: PAD, y: PAD + 380 + GAP, w: 900 - PAD * 2, h: 500 - PAD - (PAD + 380 + GAP) };

// Colors
const BG_COLOR      = 0x110A1EFF;
const PANEL_BG      = 0x1C1230FF;
const BORDER_PURPLE = 0x9B59B6FF;
const BORDER_GOLD   = 0xD4AF37FF;
const GLOW_PURPLE   = 0x9B59B640;
const GLOW_GOLD     = 0xD4AF3740;
const DIVIDER_COLOR = 0x2A1F40FF;
const BADGE_PURPLE  = 0x7B1FA2DD;
const BADGE_GREEN   = 0x2E7D32DD;
const ONLINE_GREEN  = 0x00E676FF;

// ═══════════════════════════════════════════════════════════════════════════
// DRAWING HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function drawRect(image, x, y, w, h, colorHex) {
  // Clamp to image bounds
  const maxX = Math.min(x + w, image.width);
  const maxY = Math.min(y + h, image.height);
  const startX = Math.max(0, x);
  const startY = Math.max(0, y);
  const clampW = maxX - startX;
  const clampH = maxY - startY;
  if (clampW <= 0 || clampH <= 0) return;

  const r = (colorHex >> 24) & 0xFF;
  const g = (colorHex >> 16) & 0xFF;
  const b = (colorHex >> 8) & 0xFF;
  const a = colorHex & 0xFF;

  image.scan(startX, startY, clampW, clampH, function (px, py, idx) {
    if (a === 0xFF) {
      this.bitmap.data[idx] = r;
      this.bitmap.data[idx + 1] = g;
      this.bitmap.data[idx + 2] = b;
      this.bitmap.data[idx + 3] = a;
    } else {
      // Alpha blending
      const srcA = a / 255;
      const dstA = this.bitmap.data[idx + 3] / 255;
      const outA = srcA + dstA * (1 - srcA);
      if (outA > 0) {
        this.bitmap.data[idx]     = Math.round((r * srcA + this.bitmap.data[idx] * dstA * (1 - srcA)) / outA);
        this.bitmap.data[idx + 1] = Math.round((g * srcA + this.bitmap.data[idx + 1] * dstA * (1 - srcA)) / outA);
        this.bitmap.data[idx + 2] = Math.round((b * srcA + this.bitmap.data[idx + 2] * dstA * (1 - srcA)) / outA);
        this.bitmap.data[idx + 3] = Math.round(outA * 255);
      }
    }
  });
}

function drawBorder(image, x, y, w, h, colorHex, thickness = 2) {
  drawRect(image, x, y, w, thickness, colorHex);           // Top
  drawRect(image, x, y + h - thickness, w, thickness, colorHex); // Bottom
  drawRect(image, x, y, thickness, h, colorHex);           // Left
  drawRect(image, x + w - thickness, y, thickness, h, colorHex); // Right
}

function drawPanel(image, panel, borderColor, glowColor) {
  // Outer glow (4px outside the border)
  drawBorder(image, panel.x - 3, panel.y - 3, panel.w + 6, panel.h + 6, glowColor, 3);
  // Panel background
  drawRect(image, panel.x, panel.y, panel.w, panel.h, PANEL_BG);
  // Glass highlight (subtle brighter line at top)
  drawRect(image, panel.x + 2, panel.y + 2, panel.w - 4, 1, 0xFFFFFF15);
  // Border
  drawBorder(image, panel.x, panel.y, panel.w, panel.h, borderColor, 2);
}

function drawGradientBG(image) {
  // Vertical gradient from dark purple to very dark
  const steps = 50;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const r = Math.round(17 * (1 - t) + 6 * t);
    const g = Math.round(10 * (1 - t) + 4 * t);
    const b = Math.round(30 * (1 - t) + 12 * t);
    const color = ((r << 24) | (g << 16) | (b << 8) | 0xFF) >>> 0;
    const bandY = Math.round(t * CARD_H);
    const bandH = Math.ceil(CARD_H / steps);
    drawRect(image, 0, bandY, CARD_W, bandH, color);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEXT HELPERS
// ═══════════════════════════════════════════════════════════════════════════

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
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

function formatProfileDate(timestamp) {
  if (!timestamp) return 'Bilinmiyor';
  const date = new Date(timestamp);
  const months = [
    'Ocak', 'Subat', 'Mart', 'Nisan', 'Mayis', 'Haziran',
    'Temmuz', 'Agustos', 'Eylul', 'Ekim', 'Kasim', 'Aralik'
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// SKIN FETCH WITH FALLBACK
// ═══════════════════════════════════════════════════════════════════════════

async function fetchSkinImage(uuid, mcNick) {
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

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND
// ═══════════════════════════════════════════════════════════════════════════

export default {
  data: new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Oyuncunun premium Steam benzeri profil kartini goruntule')
    .addUserOption((option) =>
      option
        .setName('kullanici')
        .setDescription('Profilini gormek istediginiz Discord kullanicisi')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('nick')
        .setDescription('Minecraft oyuncu adi')
        .setRequired(false)
        .setMinLength(3)
        .setMaxLength(16)
    ),

  async execute(interaction, bot) {
    await interaction.deferReply();

    try {
      // ── Resolve player ──────────────────────────────────────────────────
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
          try { linkedUser = await bot.users.fetch(link.userId); } catch { linkedUser = null; }
        }
      } else if (targetUser) {
        linkedUser = targetUser;
        const link = entries.find((e) => e.userId === targetUser.id);
        if (!link) {
          return await interaction.editReply({
            embeds: [embeds.errorEmbed('Profil Bulunamadi', `**${targetUser.username}** kullanicisinin whitelist kaydi bulunamadi.`)]
          });
        }
        mcNick = link.mcNick;
      } else {
        linkedUser = interaction.user;
        const link = entries.find((e) => e.userId === interaction.user.id);
        if (!link) {
          return await interaction.editReply({
            embeds: [embeds.errorEmbed('Profil Bulunamadi', 'Henuz whitelist kaydiniz bulunmuyor! `/whitelist kayit` komutunu kullanin.')]
          });
        }
        mcNick = link.mcNick;
      }

      // ── Fetch Mojang UUID ────────────────────────────────────────────────
      let uuid = '8667ba71b85a4004af544b3a8597e68d';
      try {
        const mojangResp = await axios.get(
          `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(mcNick)}`,
          { timeout: 3000 }
        );
        if (mojangResp.status === 200 && mojangResp.data.id) {
          uuid = mojangResp.data.id;
          mcNick = mojangResp.data.name;
        }
      } catch (err) {
        logger.debug(`Could not resolve Mojang UUID for ${mcNick}: ${err.message}`);
      }

      // ── Fetch Panel stats ────────────────────────────────────────────────
      let profileData = null;
      try {
        profileData = await PanelAPI.getPlayerProfile(mcNick);
      } catch (err) {
        logger.warn(`Could not get panel profile for ${mcNick}: ${err.message}`);
        profileData = { username: mcNick, isOnline: false, totalSeconds: 0, sessions: [], firstSeen: Date.now() };
      }

      // ── Determine Booster & Active role ──────────────────────────────────
      const guild = interaction.guild;
      let isBooster = false;
      let memberRoleName = 'Oyuncu';

      if (linkedUser && guild) {
        try {
          const member = await guild.members.fetch(linkedUser.id);
          isBooster = !!member.premiumSince;
          const roles = member.roles.cache
            .filter((r) => r.name !== '@everyone')
            .sort((a, b) => b.position - a.position);
          if (roles.size > 0) memberRoleName = roles.first().name;
        } catch { isBooster = false; }
      }

      const playtimeHours = Math.round((profileData.totalSeconds || 0) / 3600);
      const recentSessionsCount = profileData.sessions?.filter(
        (s) => Date.now() - s.joined_at < 7 * 24 * 60 * 60 * 1000
      ).length || 0;
      const isConsistent = recentSessionsCount >= 3 || playtimeHours > 10;

      // ═════════════════════════════════════════════════════════════════════
      // BUILD CARD — Everything drawn from scratch, no template needed
      // ═════════════════════════════════════════════════════════════════════

      logger.info(`Rendering profile card for ${mcNick} (${CARD_W}x${CARD_H})`);

      const card = new Jimp({ width: CARD_W, height: CARD_H, color: BG_COLOR });

      // 1. Gradient background
      drawGradientBG(card);

      // 2. Draw all panels
      drawPanel(card, SKIN_PANEL, BORDER_PURPLE, GLOW_PURPLE);
      drawPanel(card, NAME_PANEL, BORDER_PURPLE, GLOW_PURPLE);
      drawPanel(card, STATS_PANEL, BORDER_PURPLE, GLOW_PURPLE);
      drawPanel(card, VIP_PANEL, BORDER_GOLD, GLOW_GOLD);

      // 3. Composite Minecraft skin (aspect-ratio preserved)
      const skinBuffer = await fetchSkinImage(uuid, mcNick);
      if (skinBuffer) {
        try {
          const skinImg = await Jimp.read(skinBuffer);
          const origW = skinImg.width;
          const origH = skinImg.height;

          // Fit skin inside panel with 10px padding
          const fitW = SKIN_PANEL.w - 20;
          const fitH = SKIN_PANEL.h - 20;
          const scale = Math.min(fitW / origW, fitH / origH);
          const newW = Math.round(origW * scale);
          const newH = Math.round(origH * scale);
          skinImg.resize({ w: newW, h: newH });

          // Center inside skin panel
          const skinX = SKIN_PANEL.x + Math.round((SKIN_PANEL.w - newW) / 2);
          const skinY = SKIN_PANEL.y + Math.round((SKIN_PANEL.h - newH) / 2);
          card.composite(skinImg, skinX, skinY);

          logger.debug(`Skin composited: ${origW}x${origH} -> ${newW}x${newH} at (${skinX},${skinY})`);
        } catch (err) {
          logger.warn(`Failed to composite skin: ${err.message}`);
        }
      }

      // 4. Load fonts
      const font64 = await loadFont(SANS_64_WHITE);
      const font32 = await loadFont(SANS_32_WHITE);
      const font16 = await loadFont(SANS_16_WHITE);

      // ─── NAME PANEL (295, 20, 585, 100) ────────────────────────────────
      const NX = NAME_PANEL.x + 15;  // 15px inner padding
      const NY = NAME_PANEL.y;

      // Nickname
      const nickSafe = toAscii(mcNick);
      card.print({
        font: nickSafe.length > 12 ? font32 : font64,
        x: NX,
        y: NY + 10,
        text: nickSafe
      });

      // Badges (below name)
      let badgeX = NX;
      const badgeY = NY + 65;

      if (isBooster) {
        drawRect(card, badgeX, badgeY, 120, 26, BADGE_PURPLE);
        card.print({ font: font16, x: badgeX + 22, y: badgeY + 7, text: 'BOOSTER' });
        badgeX += 132;
      }
      if (isConsistent) {
        drawRect(card, badgeX, badgeY, 135, 26, BADGE_GREEN);
        card.print({ font: font16, x: badgeX + 16, y: badgeY + 7, text: 'ISTIKRARLI' });
      }

      // ─── STATS PANEL (295, 135, 585, 265) ─────────────────────────────
      const SX = STATS_PANEL.x + 15;
      const SY = STATS_PANEL.y;

      // Row 1: Toplam Oyun Suresi
      card.print({ font: font16, x: SX, y: SY + 15, text: 'TOPLAM OYUN SURESI' });
      card.print({ font: font32, x: SX, y: SY + 35, text: `${playtimeHours} Saat` });

      // Divider line
      drawRect(card, SX, SY + 75, STATS_PANEL.w - 30, 1, DIVIDER_COLOR);

      // Row 2: Sunucuya Katilim
      card.print({ font: font16, x: SX, y: SY + 90, text: 'SUNUCUYA KATILIM' });
      card.print({ font: font32, x: SX, y: SY + 110, text: formatProfileDate(profileData.firstSeen || Date.now()) });

      // Divider line
      drawRect(card, SX, SY + 155, STATS_PANEL.w - 30, 1, DIVIDER_COLOR);

      // Row 3: Aktif Rol
      card.print({ font: font16, x: SX, y: SY + 170, text: 'AKTIF ROL' });
      card.print({ font: font32, x: SX, y: SY + 190, text: toAscii(memberRoleName) });

      // Online indicator
      if (profileData.isOnline) {
        drawRect(card, SX, SY + 235, 12, 12, ONLINE_GREEN);
        card.print({ font: font16, x: SX + 18, y: SY + 235, text: 'Su An Oyunda' });
      }

      // ─── VIP PANEL (20, 415, 860, 65) ──────────────────────────────────
      const VX = VIP_PANEL.x + 15;
      const VY = VIP_PANEL.y;

      const timedRolesData = await PanelAPI.getTimedRoles();
      const rolesList = timedRolesData.roles || [];
      const userVip = linkedUser ? rolesList.find((r) => r.user_id === linkedUser.id) : null;

      let vipRoleName = null;
      let expiryTimestamp = null;

      if (userVip && guild) {
        try {
          const role = await guild.roles.fetch(userVip.role_id);
          if (role) { vipRoleName = role.name; expiryTimestamp = userVip.expiry_timestamp; }
        } catch { vipRoleName = null; }
      }

      if (vipRoleName) {
        const totalSecsLeft = expiryTimestamp - Math.floor(Date.now() / 1000);
        const daysLeft = Math.max(0, Math.ceil(totalSecsLeft / 86400));

        card.print({ font: font32, x: VX, y: VY + 5, text: `VIP: ${toAscii(vipRoleName).toUpperCase()}` });

        // Progress bar
        const barX = VX;
        const barY = VY + 42;
        const barW = VIP_PANEL.w - 30;

        drawRect(card, barX, barY, barW, 8, 0x3E3E3EFF);
        const barFill = Math.min(barW, Math.max(0, Math.round((daysLeft / 30) * barW)));
        if (barFill > 0) drawRect(card, barX, barY, barFill, 8, BORDER_GOLD);

        card.print({ font: font16, x: barX + barW - 200, y: VY + 42, text: `${daysLeft} Gun Kaldi` });
      } else {
        card.print({ font: font32, x: VX, y: VY + 5, text: 'VIP & DESTEKCI' });
        card.print({ font: font16, x: VX, y: VY + 42, text: 'VIP ayricaliklarindan yararlanmak icin yetkililerle gorusun!' });
      }

      // ═════════════════════════════════════════════════════════════════════
      // SEND TO DISCORD
      // ═════════════════════════════════════════════════════════════════════

      const imageBuffer = await card.getBuffer('image/png');
      const attachment = new AttachmentBuilder(imageBuffer, { name: `${mcNick}_profile.png` });

      await interaction.editReply({ files: [attachment], embeds: [], components: [] });
      logger.info(`Profile card sent for ${mcNick}`);

    } catch (error) {
      logger.error('Error executing profile command:', { error: error.message, stack: error.stack });
      const errEmbed = embeds.errorEmbed('Hata', error.message || 'Profil sorgulanirken bir hata olustu.');
      await interaction.editReply({ embeds: [errEmbed] });
    }
  }
};
