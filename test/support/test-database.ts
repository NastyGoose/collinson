import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

/** Prefix of every per-run test database; teardown refuses to drop anything else. */
export const TEST_DATABASE_PREFIX = 'collinson_test_';

/** Env key through which global setup hands the per-run database name to teardown. */
export const TEST_DATABASE_NAME_ENV = 'COLLINSON_TEST_DATABASE';

export function requireAdminUrl(): string {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (!adminUrl) {
    throw new Error(
      'TEST_DATABASE_ADMIN_URL is not set. Copy .env.example to .env, or export a URL for a ' +
        'PostgreSQL role that may CREATE DATABASE (tests create and drop their own database).',
    );
  }
  return adminUrl;
}

/** The admin URL with its database name swapped for the per-run test database. */
export function databaseUrlFor(adminUrl: string, databaseName: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Runs the Prisma CLI from node_modules against the given database. */
export function runPrisma(args: string[], databaseUrl: string): string {
  const prismaCli = join(dirname(require.resolve('prisma/package.json')), 'build', 'index.js');
  return execFileSync(process.execPath, [prismaCli, ...args], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
