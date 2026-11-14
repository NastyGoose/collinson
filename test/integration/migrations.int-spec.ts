import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { runPrisma, TEST_DATABASE_NAME_ENV, TEST_DATABASE_PREFIX } from '../support/test-database';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'prisma', 'migrations');

function checkedInMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe('checked-in Prisma migrations', () => {
  const databaseUrl = process.env.DATABASE_URL as string;
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it('run against the per-run test database, not the development database', async () => {
    const { rows } = await client.query<{ name: string }>('SELECT current_database() AS name');

    expect(rows[0].name).toBe(process.env[TEST_DATABASE_NAME_ENV]);
    expect(rows[0].name.startsWith(TEST_DATABASE_PREFIX)).toBe(true);
  });

  it('apply every checked-in migration to a freshly created database', async () => {
    const { rows } = await client.query<{
      migration_name: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
    }>(
      'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name',
    );

    expect(rows.map((row) => row.migration_name)).toEqual(checkedInMigrations());
    expect(rows.every((row) => row.finished_at !== null && row.rolled_back_at === null)).toBe(true);
  });

  it('leave the database schema up to date with the migration history', () => {
    expect(runPrisma(['migrate', 'status'], databaseUrl)).toContain(
      'Database schema is up to date',
    );
  });
});
