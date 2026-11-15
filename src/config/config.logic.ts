import { DEFAULT_LOG_LEVEL, DEFAULT_PORT, LOG_LEVELS } from './config.constants';
import type { Env, LogLevel } from './config.types';

/**
 * Validates the process environment for ConfigModule. Fails at startup with a
 * message that names the missing or invalid key and where to set it.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const problems: string[] = [];

  const databaseUrl = typeof raw.DATABASE_URL === 'string' ? raw.DATABASE_URL.trim() : '';
  if (!databaseUrl) {
    problems.push('DATABASE_URL is not set. Copy .env.example to .env or export it.');
  } else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    problems.push('DATABASE_URL must be a postgresql:// connection URL.');
  }

  let port = DEFAULT_PORT;
  if (raw.PORT !== undefined && raw.PORT !== '') {
    port = Number(raw.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      problems.push(`PORT must be an integer from 1 to 65535, got ${JSON.stringify(raw.PORT)}.`);
    }
  }

  let logLevel: LogLevel = DEFAULT_LOG_LEVEL;
  if (raw.LOG_LEVEL !== undefined && raw.LOG_LEVEL !== '') {
    const level = LOG_LEVELS.find((candidate) => candidate === raw.LOG_LEVEL);
    if (level === undefined) {
      problems.push(
        `LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got ${JSON.stringify(raw.LOG_LEVEL)}.`,
      );
    } else {
      logLevel = level;
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);
  }

  return { DATABASE_URL: databaseUrl, PORT: port, LOG_LEVEL: logLevel };
}
