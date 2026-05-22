import { UNIT_NAMES } from './constants.js';

export function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} gün ${hours % 24} saat`;
  if (hours > 0) return `${hours} saat ${minutes % 60} dakika`;
  if (minutes > 0) return `${minutes} dakika`;
  return `${seconds} saniye`;
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

export function formatDuration(duration, unit) {
  const unitName = UNIT_NAMES[unit] || unit;
  return `${duration} ${unitName}`;
}

export function formatDate(date) {
  const d = new Date(date);
  return d.toLocaleString('tr-TR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatTime(date) {
  const d = new Date(date);
  return d.toLocaleString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function sanitizeNickname(nickname) {
  return nickname.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
}

export function truncate(text, length = 100) {
  return text.length > length ? text.substring(0, length - 3) + '...' : text;
}

export function codeBlock(text, language = '') {
  return `\`\`\`${language}\n${text}\n\`\`\``;
}

export function bold(text) {
  return `**${text}**`;
}

export function italic(text) {
  return `*${text}*`;
}

export function inlineCode(text) {
  return `\`${text}\``;
}
