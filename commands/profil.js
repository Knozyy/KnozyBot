import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import PanelAPI from '../services/PanelAPI.js';
import { embeds } from '../services/embeds.js';
import { logger } from '../core/logger.js';
import axios from 'axios';

export default {
  data: new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Oyuncu profil kartını görüntüler')
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
        // Try to find if this mcNick is linked to a Discord user
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
        // Self lookup
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

      // 1. Fetch Mojang UUID (for high-fidelity 3D skin render)
      let uuid = null;
      try {
        const mojangResp = await axios.get(
          `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(mcNick)}`,
          { timeout: 3000 }
        );
        if (mojangResp.status === 200 && mojangResp.data.id) {
          uuid = mojangResp.data.id;
          mcNick = mojangResp.data.name; // Canonical capitalization
        }
      } catch (err) {
        logger.debug(`Could not resolve Mojang UUID for ${mcNick}: ${err.message}`);
      }

      // 2. Fetch Player stats & session details from Panel backend
      let profileData = null;
      try {
        profileData = await PanelAPI.getPlayerProfile(mcNick);
      } catch (err) {
        logger.warn(`Could not get panel profile for ${mcNick}: ${err.message}`);
        // Fallback profile details if panel lacks statistics yet
        profileData = {
          username: mcNick,
          isOnline: false,
          totalSeconds: 0,
          sessions: []
        };
      }

      // 3. Determine if Booster and Online
      const guild = interaction.guild;
      let isBooster = false;
      if (linkedUser && guild) {
        try {
          const member = await guild.members.fetch(linkedUser.id);
          isBooster = !!member.premiumSince;
        } catch {
          isBooster = false;
        }
      }

      const isOnline = profileData.isOnline || false;

      // 4. Create Interactive Tab Buttons
      const getButtons = (activeTab) => {
        const row = new ActionRowBuilder();

        const btnGeneral = new ButtonBuilder()
          .setCustomId('profile_tab_general')
          .setLabel('🎮 Genel Profil')
          .setStyle(activeTab === 'general' ? ButtonStyle.Success : ButtonStyle.Secondary);

        const btnVip = new ButtonBuilder()
          .setCustomId('profile_tab_vip')
          .setLabel('👑 VIP & Destekçi')
          .setStyle(activeTab === 'vip' ? ButtonStyle.Success : ButtonStyle.Secondary);

        row.addComponents(btnGeneral, btnVip);
        return row;
      };

      // Initial tab: General Profile
      const initialEmbed = embeds.profileEmbed(profileData, uuid, linkedUser, isBooster, isOnline);
      const message = await interaction.editReply({
        embeds: [initialEmbed],
        components: [getButtons('general')]
      });

      // 5. Button Interaction Collector (lasts for 2 minutes)
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120 * 1000
      });

      collector.on('collect', async (btnInt) => {
        if (btnInt.user.id !== interaction.user.id) {
          return await btnInt.reply({
            content: 'Bu profil kartının sekmelerini sadece sorguyu yapan kişi değiştirebilir!',
            ephemeral: true
          });
        }

        await btnInt.deferUpdate();

        try {
          if (btnInt.customId === 'profile_tab_general') {
            const generalEmbed = embeds.profileEmbed(profileData, uuid, linkedUser, isBooster, isOnline);
            await btnInt.editReply({
              embeds: [generalEmbed],
              components: [getButtons('general')]
            });
          } else if (btnInt.customId === 'profile_tab_vip') {
            // Find VIP and timed roles
            const timedRolesData = await PanelAPI.getTimedRoles();
            const rolesList = timedRolesData.roles || [];
            
            // Search for their active timed role
            const userVip = linkedUser ? rolesList.find((r) => r.user_id === linkedUser.id) : null;
            let vipRole = null;
            let expiryTimestamp = null;

            if (userVip && guild) {
              try {
                const role = await guild.roles.fetch(userVip.role_id);
                if (role) {
                  vipRole = { name: role.name };
                  expiryTimestamp = userVip.expiry_timestamp;
                }
              } catch {
                vipRole = null;
              }
            }

            const vipEmbed = embeds.vipProfileEmbed(profileData, uuid, linkedUser, vipRole, expiryTimestamp);
            await btnInt.editReply({
              embeds: [vipEmbed],
              components: [getButtons('vip')]
            });
          }
        } catch (error) {
          logger.error('Error switching profile tabs:', { error: error.message });
        }
      });

      collector.on('end', async () => {
        // Disable buttons when expired
        try {
          const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('disabled_general')
              .setLabel('🎮 Genel Profil')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId('disabled_vip')
              .setLabel('👑 VIP & Destekçi')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true)
          );
          await interaction.editReply({ components: [disabledRow] }).catch(() => {});
        } catch {
          // ignore if message deleted
        }
      });

    } catch (error) {
      logger.error('Error executing profile command:', { error: error.message });
      const errEmbed = embeds.errorEmbed(
        'Hata',
        error.message || 'Profil sorgulanırken bir hata oluştu.'
      );
      await interaction.editReply({ embeds: [errEmbed] });
    }
  }
};
