import type { Env } from './config.types';

const DEFAULT_PORT = 3000;

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

  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);
  }

  return { DATABASE_URL: databaseUrl, PORT: port };
}
