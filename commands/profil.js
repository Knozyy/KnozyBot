import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import PanelAPI from '../services/PanelAPI.js';
import { embeds } from '../services/embeds.js';
import { logger } from '../core/logger.js';
import axios from 'axios';
import path from 'path';
import { Jimp, loadFont } from 'jimp';
import { SANS_64_WHITE, SANS_32_WHITE, SANS_16_WHITE } from 'jimp/fonts';

// ═══════════════════════════════════════════════════════════════════════════
// CARD DIMENSIONS & LAYOUT
// ═══════════════════════════════════════════════════════════════════════════

const CARD_W = 900;
const CARD_H = 520;
const PAD = 22;
const GAP = 12;

// Panel positions — every pixel is intentional
const SKIN_PANEL  = { x: PAD, y: PAD, w: 260, h: 400 };
const NAME_PANEL  = { x: PAD + 260 + GAP, y: PAD, w: CARD_W - PAD * 2 - 260 - GAP, h: 130 };
const STATS_PANEL = { x: PAD + 260 + GAP, y: PAD + 130 + GAP, w: CARD_W - PAD * 2 - 260 - GAP, h: 400 - 130 - GAP };
const VIP_PANEL   = { x: PAD, y: PAD + 400 + GAP, w: CARD_W - PAD * 2, h: CARD_H - PAD - (PAD + 400 + GAP) };

// ═══════════════════════════════════════════════════════════════════════════
// COLOR PALETTE
// ═══════════════════════════════════════════════════════════════════════════

const COLORS = {
  panelBg:     0x0D0820C0,    // Semi-transparent dark (lets BG show through)
  panelBgLit:  0x1A103590,    // Slightly lighter variant for glass effect
  borderPurple: 0xB06CFFFF,   // Vivid purple
  borderGold:   0xF0C040FF,   // Bright gold
  glowPurple6:  0xB06CFF18,   // Outermost glow (very faint)
  glowPurple5:  0xB06CFF28,
  glowPurple4:  0xB06CFF40,
  glowPurple3:  0xB06CFF58,
  glowPurple2:  0xB06CFF78,
  glowPurple1:  0xB06CFFA0,   // Innermost glow (bright)
  glowGold6:    0xF0C04018,
  glowGold5:    0xF0C04028,
  glowGold4:    0xF0C04040,
  glowGold3:    0xF0C04058,
  glowGold2:    0xF0C04078,
  glowGold1:    0xF0C040A0,
  divider:      0x3D2860FF,
  badgePurple:  0x7B2FB8E0,
  badgeGreen:   0x2E8B40E0,
  onlineGreen:  0x00E676FF,
  labelColor:   0xA89CC0FF,   // Muted purple for labels
  highlight:    0xFFFFFF10,   // Glass highlight line
};

// ═══════════════════════════════════════════════════════════════════════════
// DRAWING HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function drawRect(image, x, y, w, h, colorHex) {
  const maxX = Math.min(x + w, image.width);
  const maxY = Math.min(y + h, image.height);
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
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
      this.bitmap.data[idx + 3] = 0xFF;
    } else {
      // Alpha blending for semi-transparent overlays
      const srcA = a / 255;
      const dstR = this.bitmap.data[idx];
      const dstG = this.bitmap.data[idx + 1];
      const dstB = this.bitmap.data[idx + 2];
      const dstA = this.bitmap.data[idx + 3] / 255;
      const outA = srcA + dstA * (1 - srcA);
      if (outA > 0) {
        this.bitmap.data[idx]     = Math.round((r * srcA + dstR * dstA * (1 - srcA)) / outA);
        this.bitmap.data[idx + 1] = Math.round((g * srcA + dstG * dstA * (1 - srcA)) / outA);
        this.bitmap.data[idx + 2] = Math.round((b * srcA + dstB * dstA * (1 - srcA)) / outA);
        this.bitmap.data[idx + 3] = Math.round(outA * 255);
      }
    }
  });
}

function drawBorder(image, x, y, w, h, colorHex, thickness = 2) {
  drawRect(image, x, y, w, thickness, colorHex);
  drawRect(image, x, y + h - thickness, w, thickness, colorHex);
  drawRect(image, x, y, thickness, h, colorHex);
  drawRect(image, x + w - thickness, y, thickness, h, colorHex);
}

// Draw a panel with multi-layer neon glow effect
function drawGlowPanel(image, panel, borderColor, glowLayers) {
  // 6 glow layers from outside in (increasing brightness)
  for (let i = 0; i < glowLayers.length; i++) {
    const offset = glowLayers.length - i;
    drawBorder(
      image,
      panel.x - offset, panel.y - offset,
      panel.w + offset * 2, panel.h + offset * 2,
      glowLayers[i], 1
    );
  }

  // Panel background (semi-transparent, lets BG texture show through)
  drawRect(image, panel.x, panel.y, panel.w, panel.h, COLORS.panelBg);

  // Glass highlight stripe at top (1px bright line for glass effect)
  drawRect(image, panel.x + 2, panel.y + 2, panel.w - 4, 1, COLORS.highlight);
  drawRect(image, panel.x + 2, panel.y + 3, panel.w - 4, 1, 0xFFFFFF08);

  // Subtle gradient: slightly lighter at top
  drawRect(image, panel.x + 2, panel.y + 4, panel.w - 4, 30, COLORS.panelBgLit);

  // Solid border
  drawBorder(image, panel.x, panel.y, panel.w, panel.h, borderColor, 2);

  // Corner accents (small bright dots at corners)
  const cs = 4; // corner size
  drawRect(image, panel.x, panel.y, cs, cs, borderColor);
  drawRect(image, panel.x + panel.w - cs, panel.y, cs, cs, borderColor);
  drawRect(image, panel.x, panel.y + panel.h - cs, cs, cs, borderColor);
  drawRect(image, panel.x + panel.w - cs, panel.y + panel.h - cs, cs, cs, borderColor);
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
// SKIN FETCH
// ═══════════════════════════════════════════════════════════════════════════

async function fetchSkinImage(uuid, mcNick) {
  const skinApis = [
    { name: 'mc-heads', url: `https://mc-heads.net/body/${encodeURIComponent(mcNick)}/600` },
    { name: 'minotar', url: `https://minotar.net/body/${encodeURIComponent(mcNick)}/300.png` },
    { name: 'crafatar', url: `https://crafatar.com/renders/body/${uuid}?overlay&size=4` },
  ];

  for (const api of skinApis) {
    try {
      const resp = await axios.get(api.url, { responseType: 'arraybuffer', timeout: 6000 });
      if (resp.status === 200 && resp.data && resp.data.length > 100) {
        logger.info(`Skin fetched from ${api.name} for ${mcNick}`);
        return Buffer.from(resp.data);
      }
    } catch (err) {
      logger.warn(`Skin API ${api.name} failed: ${err.message}`);
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND
// ═══════════════════════════════════════════════════════════════════════════

export default {
  data: new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Oyuncunun premium profil kartini goruntule')
    .addUserOption((opt) => opt.setName('kullanici').setDescription('Discord kullanicisi').setRequired(false))
    .addStringOption((opt) => opt.setName('nick').setDescription('Minecraft oyuncu adi').setRequired(false).setMinLength(3).setMaxLength(16)),

  async execute(interaction, bot) {
    await interaction.deferReply();

    try {
      // ── Resolve player ────────────────────────────────────────────────
      const targetUser = interaction.options.getUser('kullanici');
      const targetNick = interaction.options.getString('nick');
      let mcNick = null;
      let linkedUser = null;

      const whitelistData = await PanelAPI.getWhitelist();
      const entries = whitelistData.entries || [];

      if (targetNick) {
        mcNick = targetNick.trim();
        const link = entries.find((e) => e.mcNick.toLowerCase() === mcNick.toLowerCase());
        if (link) { try { linkedUser = await bot.users.fetch(link.userId); } catch { linkedUser = null; } }
      } else if (targetUser) {
        linkedUser = targetUser;
        const link = entries.find((e) => e.userId === targetUser.id);
        if (!link) return await interaction.editReply({ embeds: [embeds.errorEmbed('Profil Bulunamadi', `**${targetUser.username}** whitelist kaydi bulunamadi.`)] });
        mcNick = link.mcNick;
      } else {
        linkedUser = interaction.user;
        const link = entries.find((e) => e.userId === interaction.user.id);
        if (!link) return await interaction.editReply({ embeds: [embeds.errorEmbed('Profil Bulunamadi', '`/whitelist kayit` ile kayit olun.')] });
        mcNick = link.mcNick;
      }

      // ── Mojang UUID ───────────────────────────────────────────────────
      let uuid = '8667ba71b85a4004af544b3a8597e68d';
      try {
        const mojRes = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(mcNick)}`, { timeout: 3000 });
        if (mojRes.status === 200 && mojRes.data.id) { uuid = mojRes.data.id; mcNick = mojRes.data.name; }
      } catch (err) { logger.debug(`UUID resolve failed: ${err.message}`); }

      // ── Panel stats ───────────────────────────────────────────────────
      let profileData;
      try { profileData = await PanelAPI.getPlayerProfile(mcNick); }
      catch { profileData = { username: mcNick, isOnline: false, totalSeconds: 0, sessions: [], firstSeen: Date.now() }; }

      // ── Discord info ──────────────────────────────────────────────────
      const guild = interaction.guild;
      let isBooster = false;
      let memberRoleName = 'Oyuncu';

      if (linkedUser && guild) {
        try {
          const member = await guild.members.fetch(linkedUser.id);
          isBooster = !!member.premiumSince;
          const roles = member.roles.cache.filter((r) => r.name !== '@everyone').sort((a, b) => b.position - a.position);
          if (roles.size > 0) memberRoleName = roles.first().name;
        } catch { /* ignore */ }
      }

      const playtimeHours = Math.round((profileData.totalSeconds || 0) / 3600);
      const recentSessions = profileData.sessions?.filter((s) => Date.now() - s.joined_at < 7 * 24 * 60 * 60 * 1000).length || 0;
      const isConsistent = recentSessions >= 3 || playtimeHours > 10;

      // ═════════════════════════════════════════════════════════════════
      // BUILD THE CARD
      // ═════════════════════════════════════════════════════════════════

      logger.info(`Building profile card for ${mcNick}`);

      // Step 1: Load AI-generated background texture (or fallback to solid)
      let card;
      const bgPath = path.resolve('./assets/profile_bg.png');
      try {
        const bgImg = await Jimp.read(bgPath);
        bgImg.resize({ w: CARD_W, h: CARD_H });
        // Darken the background slightly so panels are readable
        bgImg.opacity(0.6);
        card = new Jimp({ width: CARD_W, height: CARD_H, color: 0x0A0614FF });
        card.composite(bgImg, 0, 0);
      } catch {
        logger.warn('Background image not found, using solid gradient');
        card = new Jimp({ width: CARD_W, height: CARD_H, color: 0x0F0A1CFF });
      }

      // Step 2: Draw outer card border (subtle)
      drawBorder(card, 0, 0, CARD_W, CARD_H, 0x2A1F40FF, 2);

      // Step 3: Draw glowing panels
      const purpleGlow = [COLORS.glowPurple6, COLORS.glowPurple5, COLORS.glowPurple4, COLORS.glowPurple3, COLORS.glowPurple2, COLORS.glowPurple1];
      const goldGlow = [COLORS.glowGold6, COLORS.glowGold5, COLORS.glowGold4, COLORS.glowGold3, COLORS.glowGold2, COLORS.glowGold1];

      drawGlowPanel(card, SKIN_PANEL, COLORS.borderPurple, purpleGlow);
      drawGlowPanel(card, NAME_PANEL, COLORS.borderPurple, purpleGlow);
      drawGlowPanel(card, STATS_PANEL, COLORS.borderPurple, purpleGlow);
      drawGlowPanel(card, VIP_PANEL, COLORS.borderGold, goldGlow);

      // Step 4: Composite skin (aspect ratio preserved)
      const skinBuffer = await fetchSkinImage(uuid, mcNick);
      if (skinBuffer) {
        try {
          const skinImg = await Jimp.read(skinBuffer);
          const padInner = 15;
          const fitW = SKIN_PANEL.w - padInner * 2;
          const fitH = SKIN_PANEL.h - padInner * 2;
          const scale = Math.min(fitW / skinImg.width, fitH / skinImg.height);
          const newW = Math.round(skinImg.width * scale);
          const newH = Math.round(skinImg.height * scale);
          skinImg.resize({ w: newW, h: newH });

          const skinX = SKIN_PANEL.x + Math.round((SKIN_PANEL.w - newW) / 2);
          const skinY = SKIN_PANEL.y + Math.round((SKIN_PANEL.h - newH) / 2);
          card.composite(skinImg, skinX, skinY);
        } catch (err) { logger.warn(`Skin composite failed: ${err.message}`); }
      }

      // Step 5: Load fonts
      const font64 = await loadFont(SANS_64_WHITE);
      const font32 = await loadFont(SANS_32_WHITE);
      const font16 = await loadFont(SANS_16_WHITE);

      // ─── NAME PANEL (294, 22, 584, 130) ─────────────────────────────
      const NX = NAME_PANEL.x + 18;
      const NY = NAME_PANEL.y;

      // Nickname
      const nickSafe = toAscii(mcNick);
      card.print({
        font: nickSafe.length > 10 ? font32 : font64,
        x: NX,
        y: NY + 15,
        text: nickSafe
      });

      // Badges row (well below the name, at y+85)
      let badgeX = NX;
      const badgeY = NY + 90;

      if (isBooster) {
        // Rounded-ish badge with padding
        drawRect(card, badgeX, badgeY, 125, 28, COLORS.badgePurple);
        drawBorder(card, badgeX, badgeY, 125, 28, 0xAA66EEFF, 1);
        card.print({ font: font16, x: badgeX + 22, y: badgeY + 7, text: 'BOOSTER' });
        badgeX += 138;
      }
      if (isConsistent) {
        drawRect(card, badgeX, badgeY, 140, 28, COLORS.badgeGreen);
        drawBorder(card, badgeX, badgeY, 140, 28, 0x44CC66FF, 1);
        card.print({ font: font16, x: badgeX + 18, y: badgeY + 7, text: 'ISTIKRARLI' });
        badgeX += 153;
      }

      // ─── STATS PANEL (294, 164, 584, 258) ──────────────────────────
      const SX = STATS_PANEL.x + 18;
      const SY = STATS_PANEL.y;
      const statW = STATS_PANEL.w - 36; // inner content width

      // Row 1: Toplam Oyun Suresi
      card.print({ font: font16, x: SX, y: SY + 18, text: 'TOPLAM OYUN SURESI' });
      card.print({ font: font32, x: SX, y: SY + 40, text: `${playtimeHours} Saat` });

      // Divider
      drawRect(card, SX, SY + 82, statW, 1, COLORS.divider);

      // Row 2: Sunucuya Katilim
      card.print({ font: font16, x: SX, y: SY + 96, text: 'SUNUCUYA KATILIM' });
      card.print({ font: font32, x: SX, y: SY + 118, text: formatProfileDate(profileData.firstSeen || Date.now()) });

      // Divider
      drawRect(card, SX, SY + 160, statW, 1, COLORS.divider);

      // Row 3: Aktif Rol
      card.print({ font: font16, x: SX, y: SY + 174, text: 'AKTIF ROL' });
      card.print({ font: font32, x: SX, y: SY + 196, text: toAscii(memberRoleName) });

      // Online indicator
      if (profileData.isOnline) {
        drawRect(card, SX, SY + 238, 12, 12, COLORS.onlineGreen);
        card.print({ font: font16, x: SX + 18, y: SY + 238, text: 'Su An Oyunda' });
      }

      // ─── VIP PANEL (22, 434, 856, ~64) ─────────────────────────────
      const VX = VIP_PANEL.x + 18;
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
        } catch { /* ignore */ }
      }

      if (vipRoleName) {
        const daysLeft = Math.max(0, Math.ceil((expiryTimestamp - Math.floor(Date.now() / 1000)) / 86400));
        card.print({ font: font32, x: VX, y: VY + 6, text: `VIP: ${toAscii(vipRoleName).toUpperCase()}` });

        // Gold progress bar
        const barY = VY + 44;
        const barW = VIP_PANEL.w - 36;
        drawRect(card, VX, barY, barW, 8, 0x2A2040FF);
        const fill = Math.min(barW, Math.max(0, Math.round((daysLeft / 30) * barW)));
        if (fill > 0) drawRect(card, VX, barY, fill, 8, COLORS.borderGold);
        card.print({ font: font16, x: VX + barW - 130, y: barY - 2, text: `${daysLeft} Gun Kaldi` });
      } else {
        card.print({ font: font32, x: VX, y: VY + 6, text: 'VIP & DESTEKCI' });
        card.print({ font: font16, x: VX, y: VY + 44, text: 'VIP ayricaliklarindan yararlanmak icin yetkililerle gorusun!' });
      }

      // ═════════════════════════════════════════════════════════════════
      // SEND
      // ═════════════════════════════════════════════════════════════════

      const imgBuf = await card.getBuffer('image/png');
      await interaction.editReply({
        files: [new AttachmentBuilder(imgBuf, { name: `${mcNick}_profil.png` })],
        embeds: [], components: []
      });
      logger.info(`Profile card sent for ${mcNick}`);

    } catch (error) {
      logger.error('Profile command error:', { error: error.message, stack: error.stack });
      await interaction.editReply({ embeds: [embeds.errorEmbed('Hata', error.message || 'Profil hatasi.')] });
    }
  }
};
