import { PermissionError } from '../core/errors.js';
import PanelAPI from '../services/PanelAPI.js';
import cache from '../services/Cache.js';

export async function hasAdminRole(member) {
  try {
    if (member.permissions?.has('Administrator')) return true;

    const settings = await cache.getOrFetch(
      'bot-settings',
      () => PanelAPI.getBotSettings(),
      5 * 60 * 1000 // 5 minutes
    );

    const adminRoleIds = settings.adminRoleIds || [];
    return member.roles.cache.some((role) => adminRoleIds.includes(role.id));
  } catch (error) {
    throw new PermissionError('Admin rolü kontrol edilemedi');
  }
}

export async function hasWhitelistRole(member) {
  try {
    const settings = await cache.getOrFetch(
      'bot-settings',
      () => PanelAPI.getBotSettings(),
      5 * 60 * 1000
    );

    const whitelistRoleIds = settings.whitelistRoleIds || [];
    return member.roles.cache.some((role) => whitelistRoleIds.includes(role.id));
  } catch (error) {
    throw new PermissionError('Whitelist rolü kontrol edilemedi');
  }
}

export async function hasWhitelistAddRole(member) {
  try {
    const settings = await cache.getOrFetch(
      'bot-settings',
      () => PanelAPI.getBotSettings(),
      5 * 60 * 1000
    );

    const whitelistAddRoleIds = settings.whitelistAddRoleIds || [];
    return member.roles.cache.some((role) => whitelistAddRoleIds.includes(role.id));
  } catch (error) {
    throw new PermissionError('Whitelist ekleme rolü kontrol edilemedi');
  }
}

export async function isValidNickname(nickname) {
  return /^[a-zA-Z0-9_]{3,16}$/.test(nickname);
}

export async function isValidUserId(userId) {
  return /^\d{17,19}$/.test(userId);
}

export function requireAdmin(fn) {
  return async (...args) => {
    const [interaction] = args;
    if (!(await hasAdminRole(interaction.member))) {
      throw new PermissionError('Bu komutu kullanmak için admin rolü gerekli');
    }
    return fn(...args);
  };
}

export function requireWhitelistRole(fn) {
  return async (...args) => {
    const [interaction] = args;
    if (!(await hasWhitelistRole(interaction.member))) {
      throw new PermissionError('Bu komutu kullanmak için whitelist rolü gerekli');
    }
    return fn(...args);
  };
}
