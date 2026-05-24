import { logger } from '../core/logger.js';
import { hasAdminRole } from '../utils/checks.js';
import cache from '../services/Cache.js';
import PanelAPI from '../services/PanelAPI.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '../data');
const nightguardFile = path.join(dataDir, 'nightguard.json');

export default {
  name: 'messageCreate',
  async execute(bot, message) {
    if (message.author.bot) return;

    // Prefix command handling
    if (message.content.startsWith('!')) {
      const args = message.content.slice(1).split(/\s+/);
      const commandName = args.shift().toLowerCase();

      const prefixCommand = bot.prefixCommands.get(commandName);
      if (!prefixCommand) return;

      try {
        const isAdmin = await hasAdminRole(message.member);
        if (!isAdmin) {
          await message.reply('❌ Admin rolü gerekli');
          return;
        }

        logger.info(`Executing prefix command: ${commandName}`, {
          user: message.author.tag,
          guild: message.guild.name,
        });

        await prefixCommand.execute(message, args, bot);
      } catch (error) {
        logger.error(`Prefix command error: ${commandName}`, {
          error: error.message,
        });
        await message.reply(`❌ Komut hatası: ${error.message}`);
      }
      return;
    }

    // Night guard system
    if (!message.member) return;

    try {
      const settings = await cache.getOrFetch(
        'bot-settings',
        () => PanelAPI.getBotSettings(),
        5 * 60 * 1000
      );

      const nightGuard = settings.nightGuard || {};
      if (!nightGuard.enabled) return;

      const now = new Date();
      const currentHour = now.getHours();
      const startHour = parseInt(nightGuard.startHour) || 0;
      const endHour = parseInt(nightGuard.endHour) || 8;

      const isNightTime =
        startHour < endHour
          ? currentHour >= startHour && currentHour < endHour
          : currentHour >= startHour || currentHour < endHour;

      if (!isNightTime) return;

      const adminId = nightGuard.adminId;
      const protectedRoleId = nightGuard.protectedRoleId;

      if (!adminId && !protectedRoleId) return;

      const mentionsAdmin = adminId ? message.mentions.users.has(adminId) : false;
      const mentionsProtectedRole = protectedRoleId ? message.mentions.roles.has(protectedRoleId) : false;

      if (!mentionsAdmin && !mentionsProtectedRole) return;

      // Log violation
      await ensureDataDir();
      const violations = await getNightguardData();
      const userId = message.author.id;

      if (!violations[userId]) {
        violations[userId] = { count: 0, violations: [] };
      }

      violations[userId].count += 1;
      violations[userId].violations.push({
        timestamp: now.toISOString(),
        messageContent: message.content.substring(0, 100),
      });

      await saveNightguardData(violations);

      // Apply penalty
      const penalties = [
        { level: 1, duration: 1 * 60 * 1000 },
        { level: 2, duration: 5 * 60 * 1000 },
        { level: 3, duration: 10 * 60 * 1000 },
        { level: 4, duration: 30 * 60 * 1000 },
      ];

      const level = Math.min(violations[userId].count, penalties.length);
      const penalty = penalties[level - 1];

      await message.reply(
        `⚠️ Gece koruma etkin. Gece saatlerinde yöneticiyi etiketlediğiniz için ${penalty.duration / 1000 / 60} dakika susturuldunuz.`
      );

      try {
        await message.member.timeout(penalty.duration, 'Gece koruması ihlali');
      } catch (timeoutErr) {
        logger.warn('Could not apply timeout', { error: timeoutErr.message });
      }

      try {
        await message.author.send(
          `🌙 Gece saatleri (${startHour}:00 - ${endHour}:00) admin etiketlenmesi yapılamaz.\nCeza Seviyesi: ${level}/4`
        );
      } catch (dmErr) {
        // user dm disabled
      }

      logger.info(`Night guard violation logged`, {
        user: message.author.tag,
        level,
      });
    } catch (error) {
      logger.error('Night guard error:', { error: error.message });
    }
  },
};

async function ensureDataDir() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
}

async function getNightguardData() {
  try {
    const data = await fs.readFile(nightguardFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveNightguardData(data) {
  await fs.writeFile(nightguardFile, JSON.stringify(data, null, 2));
}
