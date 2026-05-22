export class BotError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BotError';
  }
}

export class PanelAPIError extends BotError {
  constructor(message, statusCode = null) {
    super(message);
    this.name = 'PanelAPIError';
    this.statusCode = statusCode;
  }
}

export class ConfigError extends BotError {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class CommandError extends BotError {
  constructor(message) {
    super(message);
    this.name = 'CommandError';
  }
}

export class PermissionError extends CommandError {
  constructor(message = 'Insufficient permissions') {
    super(message);
    this.name = 'PermissionError';
  }
}

export class ValidationError extends BotError {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}
