// Shared settings for the tiers that need PostgreSQL. Each run gets its own
// freshly created database, initialized from the checked-in migrations by
// support/global-setup.ts and dropped by support/global-teardown.ts.
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  moduleNameMapper: require('../jest.config').moduleNameMapper,
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/support/silent-logs.ts'],
  globalSetup: '<rootDir>/test/support/global-setup.ts',
  globalTeardown: '<rootDir>/test/support/global-teardown.ts',
  // One database per run; keep its specs in one worker.
  maxWorkers: 1,
};
