/** @type {import('jest').Config} */
module.exports = {
  ...require('./jest-database.config'),
  roots: ['<rootDir>/test/e2e'],
  testRegex: '.*\\.e2e-spec\\.ts$',
};
