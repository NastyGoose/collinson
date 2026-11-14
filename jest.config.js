// Unit tier: no database, no network. Specs live next to the code as *.spec.ts.
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  // The generated Prisma Client imports its sibling .ts files with .js
  // extensions (Node ESM style); resolve them to the sources under ts-jest.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  testEnvironment: 'node',
  collectCoverageFrom: ['src/**/*.ts', '!src/generated/**', '!src/main.ts'],
  coverageDirectory: './coverage',
};
