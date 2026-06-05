import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { logger } from './logger.js';
import { config } from '../config.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class KnozyBot extends Client {
  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.commands = new Collection();
    this.prefixCommands = new Collection();
    this.events = new Collection();
    this.tasks = new Collection();
    this.guildId = config.discord.guildId;
  }

  async loadCommands() {
    const commandsDir = path.join(__dirname, '../commands');
    const files = await fs.readdir(commandsDir);

    for (const file of files.filter((f) => f.endsWith('.js'))) {
      const filePath = path.join(commandsDir, file);
      const { default: command } = await import(`file://${filePath}`);

      if (!command.data || !command.execute) {
        logger.warn(`Command ${file} missing data or execute`);
        continue;
      }

      this.commands.set(command.data.name, command);
      logger.info(`Loaded command: ${command.data.name}`);
    }
  }

  async loadPrefixCommands() {
    const commandsDir = path.join(__dirname, '../prefixCommands');
    try {
      const files = await fs.readdir(commandsDir);

      for (const file of files.filter((f) => f.endsWith('.js'))) {
        const filePath = path.join(commandsDir, file);
        const { default: command } = await import(`file://${filePath}`);

        if (!command.name || !command.execute) {
          logger.warn(`Prefix command ${file} missing name or execute`);
          continue;
        }

        this.prefixCommands.set(command.name, command);
        logger.info(`Loaded prefix command: ${command.name}`);
      }
    } catch (error) {
      logger.warn('No prefix commands directory found');
    }
  }

  async loadEvents() {
    const eventsDir = path.join(__dirname, '../events');
    const files = await fs.readdir(eventsDir);

    for (const file of files.filter((f) => f.endsWith('.js'))) {
      const filePath = path.join(eventsDir, file);
      const { default: event } = await import(`file://${filePath}`);

      if (!event.name || !event.execute) {
        logger.warn(`Event ${file} missing name or execute`);
        continue;
      }

      this.events.set(event.name, event);

      if (event.once) {
        this.once(event.name, (...args) => event.execute(this, ...args));
      } else {
        this.on(event.name, (...args) => event.execute(this, ...args));
      }

      logger.info(`Loaded event: ${event.name}`);
    }
  }

  async loadTasks() {
    const tasksDir = path.join(__dirname, '../tasks');
    try {
      const files = await fs.readdir(tasksDir);

      for (const file of files.filter((f) => f.endsWith('.js'))) {
        const filePath = path.join(tasksDir, file);
        const { default: task } = await import(`file://${filePath}`);

        if (!task.name || !task.execute || !task.interval) {
          logger.warn(`Task ${file} missing name, execute, or interval`);
          continue;
        }

        this.tasks.set(task.name, task);
        this.startTask(task);
        logger.info(`Loaded task: ${task.name} (interval: ${task.interval}ms)`);
      }
    } catch (error) {
      logger.warn('No tasks directory found');
    }
  }

  startTask(task) {
    const intervalId = setInterval(async () => {
      try {
        await task.execute(this);
      } catch (error) {
        logger.error(`Task ${task.name} error:`, { error: error.message });
      }
    }, task.interval);
    this.taskIntervals = this.taskIntervals || [];
    this.taskIntervals.push(intervalId);
  }

  async registerCommands() {
    const guild = this.guilds.cache.get(this.guildId);
    if (!guild) {
      logger.error('Guild not found for command registration');
      return;
    }

    const commands = Array.from(this.commands.values()).map((cmd) => cmd.data.toJSON());

    try {
      // Çift komut oluşumunu (duplicate) önlemek için önce global komutları temizle
      if (this.application) {
        await this.application.commands.set([]);
        logger.info('Cleared global slash commands to prevent duplicates');
      }

      await guild.commands.set(commands);
      logger.info(`Registered ${commands.length} slash commands to guild`);
    } catch (error) {
      logger.error('Failed to register commands:', { error: error.message });
    }
  }

  async start() {
    try {
      logger.info('Loading bot components...');
      await this.loadCommands();
      await this.loadPrefixCommands();
      await this.loadEvents();
      await this.loadTasks();

      logger.info('Starting bot...');
      await this.login(config.discord.token);
    } catch (error) {
      logger.error('Failed to start bot:', { error: error.message });
      process.exit(1);
    }
  }

  async shutdown() {
    logger.info('Shutting down bot...');
    if (this.taskIntervals) {
      for (const intervalId of this.taskIntervals) {
        clearInterval(intervalId);
      }
    }
    this.destroy();
    process.exit(0);
  }
}

export default KnozyBot;
