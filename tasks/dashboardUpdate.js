import PanelAPI from '../services/PanelAPI.js';
import cache from '../services/Cache.js';
import { logger } from '../core/logger.js';
import { embeds } from '../services/embeds.js';
import axios from 'axios';
import { DateTime } from 'luxon';

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
          // Parse all timestamps safely and filter out invalid records
          const parsedHistory = history
            .map(h => {
              let ts = Number(h.timestamp);
              if (isNaN(ts)) ts = new Date(h.timestamp).getTime();
              return {
                timestamp: ts,
                players: typeof h.players === 'number' ? h.players : parseInt(h.players) || 0
              };
            })
            .filter(h => !isNaN(h.timestamp))
            .sort((a, b) => a.timestamp - b.timestamp);

          if (parsedHistory.length === 0) {
            throw new Error('No valid history records found');
          }

          // Use the latest record's timestamp as the reference point to prevent clock drift issues
          const latestTs = parsedHistory[parsedHistory.length - 1].timestamp;
          const oneDayAgo = latestTs - 24 * 60 * 60 * 1000;
          const recentHistory = parsedHistory.filter(h => h.timestamp >= oneDayAgo);

          const buckets = {};
          for (const h of recentHistory) {
            // Group into 5-minute buckets using timestamp (prevents overlapping across days)
            const bucketStart = Math.floor(h.timestamp / (5 * 60 * 1000)) * (5 * 60 * 1000);
            if (buckets[bucketStart] === undefined) {
              buckets[bucketStart] = h.players;
            } else {
              buckets[bucketStart] = Math.max(buckets[bucketStart], h.players);
            }
          }

          const sortedBuckets = Object.keys(buckets)
            .map(Number)
            .sort((a, b) => a - b);

          const labels = sortedBuckets.map(ts => {
            return DateTime.fromMillis(ts).setZone('Europe/Istanbul').toFormat('HH:mm');
          });

          const dataPoints = sortedBuckets.map(ts => buckets[ts]);

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
                steppedLine: false,
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
