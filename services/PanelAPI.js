import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../core/logger.js';
import { PanelAPIError } from '../core/errors.js';

class PanelAPI {
  constructor() {
    this.baseURL = config.panel.url;
    this.token = config.panel.apiToken;
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const message = error.response?.data?.error || error.response?.data?.message || error.message;
        const statusCode = error.response?.status;
        logger.error(`Panel API Error: ${message}`, { statusCode });
        throw new PanelAPIError(message, statusCode);
      }
    );
  }

  // Minecraft Status
  async getServerStatus(serverId) {
    const response = await this.client.get(`/api/minecraft/status`, {
      params: { serverId },
    });
    const data = response.data;
    // KnozySunucu'nun response formatını normalize et
    return {
      status: data.status || 'stopped',
      onlinePlayers: data.playerCount || data.players?.length || 0,
      maxPlayers: data.maxPlayers || 20,
      name: data.name || `Sunucu #${serverId || 1}`,
      players: data.players || [],
      uptime: data.uptime || 0,
      processStats: data.processStats || {},
    };
  }

  async getServerPlayers(serverId) {
    const response = await this.client.get(`/api/minecraft/players`, {
      params: { serverId },
    });
    const data = response.data;
    return {
      players: data.players || [],
      count: data.count || 0,
    };
  }

  async getPlayerHistory() {
    try {
      const response = await this.client.get('/api/discord/player-history');
      return response.data.history || [];
    } catch (e) {
      logger.warn('Failed to fetch player history', { error: e.message });
      return [];
    }
  }

  async getAllServersStatus() {
    // KnozySunucu'da /api/servers/status-all yok — her sunucuyu tek tek al
    try {
      const serversResp = await this.client.get(`/api/servers`);
      const servers = serversResp.data.servers || [];
      const statuses = await Promise.all(
        servers.map(async (srv) => {
          try {
            const s = await this.getServerStatus(srv.id);
            return { ...s, id: srv.id, name: srv.name };
          } catch {
            return { id: srv.id, name: srv.name, status: 'stopped', onlinePlayers: 0 };
          }
        })
      );
      return { servers: statuses };
    } catch {
      return { servers: [] };
    }
  }

  async getAllServers() {
    const response = await this.client.get(`/api/servers`);
    return response.data.servers || [];
  }

  // System Info
  async getSystemInfo() {
    const response = await this.client.get(`/api/system/info`);
    return response.data;
  }

  async getSystemPerformance() {
    const response = await this.client.get(`/api/system/performance`);
    return response.data;
  }

  // Whitelist
  async getWhitelist() {
    const response = await this.client.get(`/api/discord/whitelist`);
    return response.data;
  }

  async addWhitelist(userId, nickname) {
    const response = await this.client.post(`/api/discord/whitelist`, {
      userId,
      mcNick: nickname,  // KnozySunucu mcNick bekliyor
    });
    return response.data;
  }

  async removeWhitelist(userId) {
    const response = await this.client.delete(`/api/discord/whitelist/${userId}`);
    return response.data;
  }

  // Timed Roles
  async getTimedRoles() {
    const response = await this.client.get(`/api/discord/timed-roles`);
    return response.data;
  }

  async addTimedRole(userId, roleId, duration, unit) {
    // KnozySunucu durationDays ve durationHours bekliyor
    let durationDays = 0;
    let durationHours = 0;
    if (unit === 'm') durationHours = duration / 60;
    else if (unit === 'h') durationHours = duration;
    else if (unit === 'd') durationDays = duration;
    else if (unit === 'w') durationDays = duration * 7;
    else if (unit === 'mo') durationDays = duration * 30;

    const response = await this.client.post(`/api/discord/timed-roles`, {
      user_id: userId,
      guild_id: config.discord.guildId,
      role_id: roleId,
      durationDays,
      durationHours,
    });
    return response.data;
  }

  async removeTimedRole(index) {
    const response = await this.client.delete(`/api/discord/timed-roles/${index}`);
    return response.data;
  }

  // Bot Settings
  async getBotSettings() {
    const response = await this.client.get(`/api/discord/bot-settings`);
    return response.data;
  }

  async saveBotSettings(settings) {
    const response = await this.client.put(`/api/discord/bot-settings`, settings);
    return response.data;
  }

  // Bot Control
  async getBotStatus() {
    const response = await this.client.get(`/api/discord/bot-status`);
    return response.data;
  }

  async controlBot(command) {
    const response = await this.client.post(`/api/discord/bot-command`, { command });
    return response.data;
  }

  async getBotLogs(lines = 100) {
    const response = await this.client.get(`/api/discord/logs`, {
      params: { lines },
    });
    return response.data.log;
  }

  // Minecraft Commands
  async executeMCCommand(serverId, command) {
    const response = await this.client.post(`/api/minecraft/command`, { command }, {
      params: { serverId },
    });
    return response.data;
  }

  // Health Check
  async healthCheck() {
    const response = await this.client.get(`/api/health`);
    return response.data;
  }
}

export default new PanelAPI();
