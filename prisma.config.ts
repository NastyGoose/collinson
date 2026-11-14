import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env on its own. Variables already set in the
// environment win over .env, so tests and CI can point at their own database.
config({ quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Left undefined when unset so `prisma generate` works before .env exists;
    // migrate commands then fail with Prisma's own missing-URL error.
    url: process.env.DATABASE_URL,
  },
});
