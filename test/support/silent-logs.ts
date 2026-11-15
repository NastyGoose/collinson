// Jest setup file for every tier. The shared logger (src/logger) reads LOG_LEVEL,
// which the shell or .env may set for running the app; the database tiers' global
// setup loads .env too. Tests always use TEST_LOG_LEVEL instead, `silent` unless a
// run opts in, e.g. `TEST_LOG_LEVEL=warn npm run test:e2e`.
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL || 'silent';
