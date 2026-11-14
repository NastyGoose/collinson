/** @type {import('jest').Config} */
module.exports = {
  ...require('./jest-database.config'),
  roots: ['<rootDir>/test/integration'],
  testRegex: '.*\\.int-spec\\.ts$',
};
