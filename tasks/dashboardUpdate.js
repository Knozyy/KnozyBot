import PanelAPI from '../services/PanelAPI.js';
import cache from '../services/Cache.js';
import { logger } from '../core/logger.js';
import { embeds } from '../services/embeds.js';
import axios from 'axios';

export default {
  name: 'dashboardUpdate',
  interval: 60 * 1000, // 60 seconds

  async execute(bot) {
    try {
      const settings = await cache.getOrFetch(
        'bot-settings',
        () => PanelAPI.getBotSettings(),
        5 * 60 * 1000
      );

      const targetChannelId = settings.dashboardChannelId || settings.dashboard_channel_id;
      const updateIntervalMins = parseInt(settings.dashboard_update_interval) || 1;

      if (!targetChannelId) {
        logger.debug('Dashboard channel not configured');
        return;
      }

      const now = Date.now();
      if (!bot.lastDashboardUpdate) bot.lastDashboardUpdate = 0;
      
      // interval'in süresi dolmadıysa atla
      if (now - bot.lastDashboardUpdate < (updateIntervalMins * 60 * 1000) - 5000) {
        return;
      }

      const channel = bot.channels.cache.get(targetChannelId);
      if (!channel) {
        logger.warn('Dashboard channel not found');
        return;
      }

      // Get all servers status
      const allServersStatus = await PanelAPI.getAllServersStatus();
      const servers = allServersStatus.servers || [];

      if (servers.length === 0) {
        logger.debug('No servers to display on dashboard');
        return;
      }

      // Get player history for chart
      const history = await PanelAPI.getPlayerHistory();
      
      let chartUrl = null;
      if (history && history.length > 0) {
        try {
          // Group by hour for clean x-axis labels
          const grouped = [];
          let currentHour = null;
          let maxPlayers = 0;
          
          for (const h of history) {
            const d = new Date(h.timestamp);
            const trTime = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
            const hour = `${trTime.getHours().toString().padStart(2, '0')}:00`;
            
            if (hour !== currentHour) {
              if (currentHour !== null) grouped.push({ label: currentHour, value: maxPlayers });
              currentHour = hour;
              maxPlayers = h.players;
            } else {
              if (h.players > maxPlayers) maxPlayers = h.players;
            }
          }
          if (currentHour !== null) grouped.push({ label: currentHour, value: maxPlayers });
          
          const labels = grouped.map(g => g.label);
          const dataPoints = grouped.map(g => g.value);

          const chartConfig = {
            type: 'line',
            data: {
              labels,
              datasets: [{
                label: 'Oyuncu Sayısı',
                data: dataPoints,
                borderColor: '#f5a623',
                backgroundColor: 'rgba(245, 166, 35, 0.2)',
                borderWidth: 2,
                fill: true,
                steppedLine: true,
                pointRadius: 0
              }]
            },
            options: {
              title: { display: true, text: 'Son 24 Saatlik Oyuncu Aktivitesi', fontColor: '#ffffff' },
              legend: { display: false },
              scales: {
                yAxes: [{ ticks: { beginAtZero: true, fontColor: '#ffffff' }, gridLines: { color: 'rgba(255, 255, 255, 0.1)' } }],
                xAxes: [{ ticks: { fontColor: '#ffffff', maxTicksLimit: 12 }, gridLines: { color: 'rgba(255, 255, 255, 0.1)' } }]
              }
            }
          };

          const chartResponse = await axios.post('https://quickchart.io/chart/create', {
            chart: chartConfig,
            width: 800,
            height: 400,
            backgroundColor: '#2C2F33'
          });
          
          if (chartResponse.data && chartResponse.data.url) {
            chartUrl = chartResponse.data.url;
          }
        } catch (e) {
          logger.warn('Failed to generate dashboard chart', { error: e.message });
        }
      }

      const embed = embeds.dashboardEmbed(servers, chartUrl);

      // Update or create dashboard message
      if (settings.dashboardMessageId) {
        try {
          const message = await channel.messages.fetch(
            settings.dashboardMessageId
          );
          await message.edit({ embeds: [embed] });
          bot.lastDashboardUpdate = Date.now();
        } catch {
          // Message not found, create new one
          const newMessage = await channel.send({ embeds: [embed] });
          await PanelAPI.saveBotSettings({
            ...settings,
            dashboardMessageId: newMessage.id,
          });
          bot.lastDashboardUpdate = Date.now();
        }
      } else {
        // Create new dashboard message
        const message = await channel.send({ embeds: [embed] });
        await PanelAPI.saveBotSettings({
          ...settings,
          dashboardMessageId: message.id,
        });
        bot.lastDashboardUpdate = Date.now();
      }

      logger.debug('Dashboard updated successfully');
    } catch (error) {
      logger.warn('Dashboard update error:', { error: error.message });
    }
  },
};
