// Module boundary rules from docs/adr/0006-module-layout-and-naming.md.
// Run with `npm run lint:structure`. Known violations that predate ADR 0006
// live in .dependency-cruiser-known-violations.json until the refactor
// empties it. Folder names are today's (locations, forecasts, activities);
// the refactor renames them here in the same change.

const DOMAINS = 'locations|forecasts|activities|activity-forecast|health';
const INFRASTRUCTURE = 'clock|config|http|prisma|logger|calendar';
const FRAMEWORK_PACKAGES = '^node_modules/(@nestjs|@prisma)/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'ADR 0006, module boundaries: no circular dependencies.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'activities-pure',
      comment: 'ADR 0006: activity scoring imports no I/O, infrastructure or framework code.',
      severity: 'error',
      from: { path: '^src/activities/' },
      to: { path: [`^src/(prisma|http|generated|logger|clock|config)/`, FRAMEWORK_PACKAGES] },
    },
    {
      name: 'activities-no-core',
      comment: 'ADR 0006: activity scoring imports no Node.js core module.',
      severity: 'error',
      from: { path: '^src/activities/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'calendar-pure',
      comment: 'ADR 0006: the calendar imports nothing else from src and no framework package.',
      severity: 'error',
      from: { path: '^src/calendar/' },
      to: { path: ['^src/', FRAMEWORK_PACKAGES], pathNot: '^src/calendar/' },
    },
    {
      name: 'calendar-no-core',
      comment: 'ADR 0006: the calendar imports no Node.js core module.',
      severity: 'error',
      from: { path: '^src/calendar/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'no-upward-imports',
      comment: 'ADR 0006: domains never import the GraphQL entry point or health.',
      severity: 'error',
      from: { path: '^src/(locations|forecasts|activities)/' },
      to: { path: '^src/(activity-forecast|health)/' },
    },
    {
      name: 'infrastructure-no-domain',
      comment: 'ADR 0006: infrastructure folders never import domain folders.',
      severity: 'error',
      from: { path: `^src/(${INFRASTRUCTURE})/` },
      to: { path: `^src/(${DOMAINS})/` },
    },
    {
      name: 'no-domain-internals',
      comment:
        "ADR 0006: use another domain's module, service, types, constants or errors, never its repository, client, logic or mapper.",
      severity: 'error',
      from: { path: '^src/([^/]+)/' },
      to: { path: '^src/[^/]+/.+[.](repository|client|logic|mapper)[.]ts$', pathNot: '^src/$1/' },
    },
    {
      name: 'no-test-imports-in-src',
      comment: 'ADR 0006: production code never imports from test/.',
      severity: 'error',
      from: { path: '^src/', pathNot: '[.]spec[.]ts$' },
      to: { path: '^test/' },
    },
    {
      name: 'no-spec-in-src',
      comment: 'ADR 0006: unit specs live in test/unit/, mirroring src/.',
      severity: 'error',
      from: { path: '^src/.+[.]spec[.]ts$' },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^src/generated/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    moduleSystems: ['es6', 'cjs'],
  },
};
