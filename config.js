import dotenv from 'dotenv';

dotenv.config();

export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    guildId: process.env.TARGET_GUILD_ID,
  },
  panel: {
    url: process.env.PANEL_URL || 'http://localhost:3001',
    apiToken: process.env.PANEL_API_TOKEN,
  },
  byno: {
    // Botun bağışları okuduğu liste sayfası (donatelist/<uuid>)
    donateListUrl: process.env.BYNO_DONATE_LIST_URL || '',
    // Kullanıcılara gösterilen bağış sayfası (donate.bynogame.com/<slug>)
    publicDonateUrl: process.env.BYNO_PUBLIC_DONATE_URL || '',
  },
  environment: process.env.NODE_ENV || 'development',
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'logs/bot.log',
  },
  cache: {
    ttl: 5 * 60 * 1000, // 5 minutes
  },
};

// Validate required config
const required = [
  'discord.token',
  'discord.guildId',
  'panel.apiToken',
];

for (const key of required) {
  const [section, field] = key.split('.');
  if (!config[section]?.[field]) {
    throw new Error(`Missing required config: ${key}`);
  }
}
