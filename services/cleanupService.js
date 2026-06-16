import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = path.join(__dirname, '../data/cleanup_history.json');
const LASTRUN_FILE = path.join(__dirname, '../data/cleanup_last_run.json');
const LASTMSG_FILE = path.join(__dirname, '../data/cleanup_last_message.json');

export const cleanupService = {
  getHistory() {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    try {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) || [];
    } catch {
      return [];
    }
  },

  saveHistory(history) {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  },

  getLastRun() {
    if (!fs.existsSync(LASTRUN_FILE)) return null;
    try {
      return JSON.parse(fs.readFileSync(LASTRUN_FILE, 'utf8')).lastRun || null;
    } catch {
      return null;
    }
  },

  saveLastRun(dateStr) {
    const dir = path.dirname(LASTRUN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LASTRUN_FILE, JSON.stringify({ lastRun: dateStr }), 'utf8');
  },

  // Son gönderilen gece raporu mesajı (bir sonraki gece eskiyi silmek için)
  getLastMessage() {
    if (!fs.existsSync(LASTMSG_FILE)) return null;
    try {
      return JSON.parse(fs.readFileSync(LASTMSG_FILE, 'utf8')) || null;
    } catch {
      return null;
    }
  },

  saveLastMessage(channelId, messageId) {
    const dir = path.dirname(LASTMSG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LASTMSG_FILE, JSON.stringify({ channelId, messageId }), 'utf8');
  },

  addReport(removedCount, removedUsers, dateStr) {
    const history = this.getHistory();
    
    // Check if report for this date already exists, if so update it
    const existingIndex = history.findIndex(r => r.date === dateStr);
    const newReport = {
      date: dateStr,
      timestamp: Date.now(),
      removedCount,
      removedUsers
    };

    if (existingIndex !== -1) {
      history[existingIndex] = newReport;
    } else {
      history.unshift(newReport);
    }

    // Keep only the last 7 days of reports
    if (history.length > 7) {
      history.splice(7);
    }

    this.saveHistory(history);
  },

  buildEmbed(report, index, total) {
    const embed = new EmbedBuilder()
      .setTitle('🌙 Gece Temizliği Raporu')
      .setDescription(`${report.removedCount} oyuncu whitelist rolü olmadığı için veya sunucudan ayrıldığı için whitelistten çıkarıldı.`)
      .setColor('#ff3333')
      .setFooter({ text: `Rapor ${index + 1}/${total} • ${report.date}` })
      .setTimestamp(new Date(report.timestamp));

    if (report.removedCount > 0) {
      const formattedUsers = report.removedUsers.map(u => {
        if (typeof u === 'string') {
          // Fallback for older string-only format
          return `\`${u}\``;
        }
        return `<@${u.userId}> (\`${u.mcNick}\`)`;
      });

      embed.addFields({ 
        name: 'Çıkarılanlar', 
        value: formattedUsers.slice(0, 20).join('\n') + (formattedUsers.length > 20 ? `\nve ${formattedUsers.length - 20} daha...` : '') 
      });
    } else {
      embed.addFields({ name: 'Durum', value: 'Çıkarılan oyuncu bulunmuyor.' });
    }

    return embed;
  },

  buildButtons(index, total) {
    const row = new ActionRowBuilder();

    const prevButton = new ButtonBuilder()
      .setCustomId(`cleanup_view_${index + 1}`)
      .setLabel('◀️ Önceki Gün')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(index + 1 >= total);

    const nextButton = new ButtonBuilder()
      .setCustomId(`cleanup_view_${index - 1}`)
      .setLabel('Sonraki Gün ▶️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(index - 1 < 0);

    row.addComponents(prevButton, nextButton);
    return row;
  }
};

export default cleanupService;
