// Unit tier: no database, no network. Unit specs live in test/unit/<folder>/,
// mirroring src/ (ADR 0006).
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  // src stays a root so the coverage report lists files that no test loads.
  roots: ['<rootDir>/src', '<rootDir>/test/unit'],
  testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  // The generated Prisma Client imports its sibling .ts files with .js
  // extensions (Node ESM style); resolve them to the sources under ts-jest.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/support/silent-logs.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/generated/**', '!src/main.ts'],
  coverageDirectory: './coverage',
};
