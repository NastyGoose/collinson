import { Client } from 'pg';
import {
  quoteIdentifier,
  requireAdminUrl,
  TEST_DATABASE_NAME_ENV,
  TEST_DATABASE_PREFIX,
} from './test-database';

/** Drops the database created by global-setup.ts for this run, and nothing else. */
export default async function globalTeardown(): Promise<void> {
  const name = process.env[TEST_DATABASE_NAME_ENV];
  if (!name?.startsWith(TEST_DATABASE_PREFIX)) {
    return;
  }

  const admin = new Client({ connectionString: requireAdminUrl() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
