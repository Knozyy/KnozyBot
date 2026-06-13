# 🤖 KnozyBot v2 - Node.js Discord Bot

Modern Discord bot for KnozyServer management with full Panel integration.

## Features

- ✅ **Slash Commands** - User-friendly Discord commands
- ✅ **Prefix Commands** - Admin-only hidden commands
- ✅ **Whitelist Management** - Discord + Panel integration
- ✅ **Timed Roles** - Temporary role assignment
- ✅ **Night Guard** - Admin protection during night hours
- ✅ **Background Tasks** - Automated monitoring and updates
- ✅ **Panel API** - Full REST API integration

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your values
```

Required values:
- `DISCORD_TOKEN` - Bot token from Discord Developer Portal
- `TARGET_GUILD_ID` - Your Discord server ID
- `PANEL_API_TOKEN` - Panel API authentication token

### 3. Start Bot
```bash
npm start
```

Or development mode with auto-reload:
```bash
npm run dev
```

## Project Structure

```
KnozyBot/
├── core/              # Bot core (KnozyBot, logger, errors)
├── services/          # API clients (PanelAPI, Cache, embeds)
├── commands/          # Slash commands
├── prefixCommands/    # Prefix commands (admin only)
├── events/            # Discord event handlers
├── tasks/             # Scheduled background tasks
├── utils/             # Helpers (checks, formatters, constants)
└── data/              # Local data (nightguard.json, cache)
```

## Commands

### Slash Commands (Public)
- `/oyuncular [server]` - List online players
- `/istatistik [server]` - Server statistics
- `/whitelist kayit <nick>` - Register for whitelist
- `/whitelist bilgi [@user]` - Check whitelist status
- `/whitelist listele` - View full whitelist
- `/profil [@user]` - Render player profile card
- `/vip [@user]` - Show VIP membership status
- `/bagis <paket>` - Support via ByNoGame donation, get auto-assigned role/VIP (config on panel)

### Prefix Commands (Admin)
- `!wl ekle|sil|sync-mc|rol-kontrol|liste` - Whitelist management
- `!gecici-rol @user @role <time> <unit>` - Assign timed role
- `!sync` - Sync commands to Discord

## Architecture

```
Discord ←→ Bot ←→ Panel API ←→ Database
     ↑                         ↓
     └─────────────────────────┘
         (Commands & Events)
```

Bot communicates with Panel API for:
- User/role settings
- Whitelist management
- Server status
- Configuration storage

## Development

### Adding a New Slash Command

Create `commands/mycommand.js`:
```javascript
import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('mycommand')
    .setDescription('Description'),
  async execute(interaction, bot) {
    await interaction.reply('Response');
  },
};
```

### Adding a New Event

Create `events/myevent.js`:
```javascript
export default {
  name: 'eventName',
  once: false,
  async execute(bot, ...args) {
    // Handle event
  },
};
```

### Adding a New Task

Create `tasks/mytask.js`:
```javascript
export default {
  name: 'mytask',
  interval: 60000, // 1 minute
  async execute(bot) {
    // Perform task
  },
};
```

## Panel Integration

Bot endpoints used:
- `GET /api/discord/bot-settings` - Fetch configuration
- `GET /api/servers` - List available servers
- `GET /api/minecraft/players` - Get player list
- `POST /api/discord/whitelist` - Add to whitelist
- `DELETE /api/discord/whitelist/:id` - Remove from whitelist
- `POST /api/discord/timed-roles` - Assign timed role
- `GET /api/health` - Health check

## Logging

All logs are written to `logs/bot.log` and console.

Log levels: `error`, `warn`, `info`, `debug`

## Troubleshooting

### Bot doesn't start
- Check `.env` file for missing values
- Verify Discord token is valid
- Ensure panel API is accessible

### Commands not working
- Check bot has required permissions
- Verify guild ID matches your server
- Check user has required roles

### Panel API errors
- Ensure panel is running on correct URL
- Verify API token in `.env`
- Check network connectivity

## Next Steps

- [ ] Faz 2: Implement slash commands
- [ ] Faz 3: Implement prefix commands + night guard
- [ ] Faz 4: Implement background tasks
- [ ] Faz 5: Panel API endpoints
- [ ] Faz 6: Panel UI updates

---

Built with discord.js v14
