export const COLORS = {
  SUCCESS: 0x2ecc71,
  ERROR: 0xe74c3c,
  WARNING: 0xf39c12,
  INFO: 0x3498db,
  PRIMARY: 0x9b59b6,
};

export const EMOJIS = {
  SUCCESS: '✅',
  ERROR: '❌',
  WARNING: '⚠️',
  INFO: 'ℹ️',
  PLAYERS: '👥',
  STATS: '📊',
  UPTIME: '⏱️',
  CPU: '💻',
  RAM: '🧠',
  DASHBOARD: '📈',
  WHITELIST: '🤍',
  SETTINGS: '⚙️',
  NIGHTGUARD: '🌙',
};

export const PERMISSIONS = {
  ADMIN_ROLE: 'admin_role',
  WHITELIST_ROLE: 'whitelist_role',
  WHITELIST_ADD_ROLE: 'whitelist_add_role',
};

export const TIME_UNITS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

export const UNIT_NAMES = {
  m: 'dakika',
  h: 'saat',
  d: 'gün',
  w: 'hafta',
  mo: 'ay',
};

export const NIGHTGUARD_PENALTIES = [
  { level: 1, duration: 1 * 60 * 1000 }, // 1 minute
  { level: 2, duration: 5 * 60 * 1000 }, // 5 minutes
  { level: 3, duration: 15 * 60 * 1000 }, // 15 minutes
  { level: 4, duration: 30 * 60 * 1000 }, // 30 minutes
];
