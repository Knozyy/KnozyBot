import PanelAPI from '../services/PanelAPI.js';
import cache from '../services/Cache.js';
import { logger } from '../core/logger.js';
import { embeds } from '../services/embeds.js';

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

      if (!targetChannelId) {
        logger.debug('Dashboard channel not configured');
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

      // Generate Chart URL
      let chartUrl = null;
      try {
        const history = await PanelAPI.getPlayerHistory();
        if (history && history.length > 0) {
          // Subsample to prevent URL from getting too long (max 100 points)
          const step = Math.max(1, Math.floor(history.length / 100));
          const sampledHistory = history.filter((_, index) => index % step === 0);
          
          const labels = sampledHistory.map(h => {
             const d = new Date(h.timestamp);
             return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
          });
          const dataPoints = sampledHistory.map(h => h.players);

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

          chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=800&h=400&bkg=%232C2F33`;
        }
      } catch (e) {
        logger.warn('Failed to generate dashboard chart', { error: e.message });
      }

      const embed = embeds.dashboardEmbed(servers, chartUrl);

      // Update or create dashboard message
      if (settings.dashboardMessageId) {
        try {
          const message = await channel.messages.fetch(
            settings.dashboardMessageId
          );
          await message.edit({ embeds: [embed] });
        } catch {
          // Message not found, create new one
          const newMessage = await channel.send({ embeds: [embed] });
          await PanelAPI.saveBotSettings({
            ...settings,
            dashboardMessageId: newMessage.id,
          });
        }
      } else {
        // Create new dashboard message
        const message = await channel.send({ embeds: [embed] });
        await PanelAPI.saveBotSettings({
          ...settings,
          dashboardMessageId: message.id,
        });
      }

      logger.debug('Dashboard updated successfully');
    } catch (error) {
      logger.warn('Dashboard update error:', { error: error.message });
    }
  },
};
