import type { LogLevel } from './config.types';

/** Accepted LOG_LEVEL values, most severe first. */
export const LOG_LEVELS: readonly LogLevel[] = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
];

/** LOG_LEVEL when it is not set (ADR 0006). */
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';
