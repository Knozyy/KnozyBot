import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { COLORS, EMOJIS } from '../utils/constants.js';

export class WhitelistPaginator {
  constructor(users, pageSize = 10) {
    this.users = users;
    this.pageSize = pageSize;
    this.totalPages = Math.ceil(users.length / pageSize);
  }

  getPage(pageNum) {
    const page = Math.max(0, Math.min(pageNum, this.totalPages - 1));
    const start = page * this.pageSize;
    const end = start + this.pageSize;

    return {
      page,
      users: this.users.slice(start, end),
      totalPages: this.totalPages,
    };
  }

  createEmbed(pageNum) {
    const { page, users, totalPages } = this.getPage(pageNum);

    const userList = users
      .map((u) => `• **${u.username || u.discordName}** → \`${u.mcNick}\``)
      .join('\n');

    return new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle(`${EMOJIS.WHITELIST} Whitelist Listesi`)
      .setDescription(userList || 'Bu sayfada kullanıcı yok')
      .setFooter({
        text: `Sayfa ${page + 1}/${totalPages} • Toplam: ${this.users.length}`,
      })
      .setTimestamp();
  }

  createButtons(pageNum) {
    const { page, totalPages } = this.getPage(pageNum);

    const prevButton = new ButtonBuilder()
      .setCustomId(`whitelist_prev_${page}`)
      .setLabel('⬅️ Önceki')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page === 0);

    const nextButton = new ButtonBuilder()
      .setCustomId(`whitelist_next_${page}`)
      .setLabel('Sonraki ➡️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page === totalPages - 1);

    return new ActionRowBuilder().addComponents(prevButton, nextButton);
  }

  handleButtonInteraction(customId, currentPage) {
    if (customId.startsWith('whitelist_prev_')) {
      return Math.max(0, currentPage - 1);
    } else if (customId.startsWith('whitelist_next_')) {
      return Math.min(this.totalPages - 1, currentPage + 1);
    }
    return currentPage;
  }
}

export default WhitelistPaginator;
