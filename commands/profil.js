import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import PanelAPI from '../services/PanelAPI.js';
import { embeds } from '../services/embeds.js';
import { logger } from '../core/logger.js';
import axios from 'axios';
import path from 'path';
import { Jimp, loadFont } from 'jimp';
import { SANS_64_WHITE, SANS_32_WHITE, SANS_16_WHITE } from 'jimp/fonts';

// Helper to draw a filled rectangle directly onto Jimp bitmap (pure-JS, robust)
function drawRect(image, x, y, w, h, colorHex) {
  const r = (colorHex >> 24) & 0xFF;
  const g = (colorHex >> 16) & 0xFF;
  const b = (colorHex >> 8) & 0xFF;
  const a = colorHex & 0xFF;
  
  image.scan(x, y, w, h, function(xCoord, yCoord, idx) {
    this.bitmap.data[idx] = r;
    this.bitmap.data[idx + 1] = g;
    this.bitmap.data[idx + 2] = b;
    this.bitmap.data[idx + 3] = a;
  });
}

// Local Turkish date formatter
function formatProfileDate(timestamp) {
  if (!timestamp) return 'Bilinmiyor';
  const date = new Date(timestamp);
  const months = [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
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

      // 4. Draw Premium Image Card using Jimp
      const TEMPLATE_PATH = path.resolve('./assets/profile_bg.png');
      logger.info(`Rendering profile card for ${mcNick} using template: ${TEMPLATE_PATH}`);

      let imageCard = null;
      try {
        imageCard = await Jimp.read(TEMPLATE_PATH);
      } catch (err) {
        logger.error(`Failed to load profile background template: ${err.message}`);
        // Fallback to text embed if background image is missing
        const fallbackEmbed = embeds.profileEmbed(profileData, uuid, linkedUser, isBooster, profileData.isOnline);
        return await interaction.editReply({ embeds: [fallbackEmbed] });
      }

      // A. Composite 3D Minecraft Skin Render (placed inside left frame)
      try {
        const skinUrl = `https://crafatar.com/renders/body/${uuid}?overlay`;
        const skinResponse = await axios.get(skinUrl, { responseType: 'arraybuffer', timeout: 5000 });
        const skinBuffer = Buffer.from(skinResponse.data);
        const skinImg = await Jimp.read(skinBuffer);
        
        // Resize and blit skin to base template (Skin position: X: 110, Y: 180)
        skinImg.resize({ w: 320, h: 640 });
        imageCard.blit(skinImg, 80, 160);
      } catch (err) {
        logger.warn(`Could not render 3D skin for ${mcNick}: ${err.message}`);
      }

      // B. Load Fonts
      const font64 = await loadFont(SANS_64_WHITE);
      const font32 = await loadFont(SANS_32_WHITE);
      const font16 = await loadFont(SANS_16_WHITE);

      // C. Print Nickname (Right top, X: 480, Y: 155)
      imageCard.print({
        font: mcNick.length > 12 ? font32 : font64,
        x: 480,
        y: 155,
        text: mcNick
      });

      // D. Draw Badges (Purple Booster and Green Istikrarli, below name)
      let badgeX = 480;
      if (isBooster) {
        // Draw Purple slot (Booster)
        drawRect(imageCard, badgeX, 245, 170, 42, 0x7B1FA2FF);
        imageCard.print({ font: font16, x: badgeX + 35, y: 255, text: 'Booster' });
        badgeX += 190;
      }
      if (isConsistent) {
        // Draw Green slot (Istikrarli)
        drawRect(imageCard, badgeX, 245, 170, 42, 0x2E7D32FF);
        imageCard.print({ font: font16, x: badgeX + 30, y: 255, text: 'Istikrarli' });
      }

      // E. Print Main Statistics
      // ⏱️ Toplam Oyun Süresi (X: 520, Y: 350)
      imageCard.print({ font: font16, x: 535, y: 350, text: 'Toplam Oyun Suresi:' });
      imageCard.print({ font: font32, x: 535, y: 375, text: `${playtimeHours} Saat` });

      // 📅 Sunucuya Katılım (X: 520, Y: 460)
      imageCard.print({ font: font16, x: 535, y: 465, text: 'Sunucuya Katilim:' });
      imageCard.print({ font: font32, x: 535, y: 490, text: formatProfileDate(profileData.firstSeen || Date.now()) });

      // 🛡️ Aktif Rol (X: 520, Y: 580)
      imageCard.print({ font: font16, x: 535, y: 580, text: 'Aktif Rol:' });
      imageCard.print({ font: font32, x: 535, y: 605, text: memberRoleName });

      // F. Print VIP & Destekçi Box Details (At the bottom, X: 520, Y: 720)
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

        // Print VIP Rank Info
        imageCard.print({ font: font32, x: 535, y: 730, text: `VIP STATUS: ${vipRoleName.toUpperCase()}` });
        
        // Draw beautiful golden progress bar (W: 380, H: 12)
        // Background track (dark grey)
        drawRect(imageCard, 535, 785, 380, 12, 0x3E3E3EFF);
        
        // Gold fill track
        const barFillWidth = Math.min(380, Math.max(0, Math.round((daysLeft / 30) * 380)));
        if (barFillWidth > 0) {
          drawRect(imageCard, 535, 785, barFillWidth, 12, 0xD4AF37FF);
        }

        // Days left text
        imageCard.print({ font: font16, x: 535, y: 812, text: `Kalan VIP Suresi: ${daysLeft} Gun` });
      } else {
        // Default guest / support info inside box
        imageCard.print({ font: font32, x: 535, y: 725, text: 'VIP & DESTEKCI' });
        imageCard.print({ font: font16, x: 535, y: 775, text: 'Destekci olmak ve VIP ayricaliklarindan' });
        imageCard.print({ font: font16, x: 535, y: 805, text: 'yararlanmak icin yetkililerle gorusun!' });
      }

      // G. Render image as Buffer and send to Discord
      const imageBuffer = await imageCard.getBuffer('image/png');
      const attachment = new AttachmentBuilder(imageBuffer, { name: `${mcNick}_profile.png` });

      // Send the high-fidelity composite PNG image directly
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
