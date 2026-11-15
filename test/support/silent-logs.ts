// Jest setup file for every tier: the shared logger (src/logger) is silent in
// tests unless the run sets LOG_LEVEL itself, e.g. `LOG_LEVEL=debug npm test`.
process.env.LOG_LEVEL ??= 'silent';
