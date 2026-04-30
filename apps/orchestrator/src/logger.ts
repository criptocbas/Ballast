import pino from 'pino';
import type { LoggerOptions } from 'pino';
import { loadConfig } from './config.js';

export function createLogger(name: string): pino.Logger {
  const cfg = loadConfig();
  const opts: LoggerOptions = { name, level: cfg.LOG_LEVEL };
  if (process.env.NODE_ENV !== 'production') {
    opts.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss.l' },
    };
  }
  return pino(opts);
}
