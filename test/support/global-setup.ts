import { randomBytes } from 'node:crypto';
import { config } from 'dotenv';
import { Client } from 'pg';
import globalTeardown from './global-teardown';
import {
  databaseUrlFor,
  quoteIdentifier,
  requireAdminUrl,
  runPrisma,
  TEST_DATABASE_NAME_ENV,
  TEST_DATABASE_PREFIX,
} from './test-database';

/**
 * Creates an empty, uniquely named database for this test run and applies the
 * checked-in migrations with `prisma migrate deploy`, the same command used for
 * development. DATABASE_URL is then pointed at it, so the specs and the app under
 * test never touch the development database.
 */
export default async function globalSetup(): Promise<void> {
  config({ quiet: true });
  const adminUrl = requireAdminUrl();
  const name = `${TEST_DATABASE_PREFIX}${Date.now()}_${randomBytes(3).toString('hex')}`;

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
  } finally {
    await admin.end();
  }
  process.env[TEST_DATABASE_NAME_ENV] = name;

  const databaseUrl = databaseUrlFor(adminUrl, name);
  try {
    runPrisma(['migrate', 'deploy'], databaseUrl);
  } catch (error) {
    // Jest skips globalTeardown when globalSetup throws, so clean up here.
    await globalTeardown();
    const { stdout, stderr } = error as { stdout?: string; stderr?: string };
    throw new Error(`prisma migrate deploy failed for ${name}:\n${stdout ?? ''}${stderr ?? ''}`);
  }
  process.env.DATABASE_URL = databaseUrl;
}
