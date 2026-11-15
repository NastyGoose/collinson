// Module boundary rules from docs/adr/0006-module-layout-and-naming.md.
// Run with `npm run lint:structure`; there is no list of known violations.

const DOMAINS = 'location|forecast|activity|activity-forecast';
const INFRASTRUCTURE = 'clock|config|http|prisma|logger|calendar|health';
// Pure folders whose .logic files are their public API (ADR 0006).
const PUBLIC_LOGIC = '^src/(calendar|activity)/.+[.]logic[.]ts$';
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
      name: 'activity-pure',
      comment: 'ADR 0006: activity scoring imports no I/O, infrastructure or framework code.',
      severity: 'error',
      from: { path: '^src/activity/' },
      to: { path: ['^src/(prisma|http|generated|logger|clock|config)/', FRAMEWORK_PACKAGES] },
    },
    {
      name: 'pure-no-io-domains',
      comment:
        "ADR 0006: activity and calendar code never import another domain's module, service, repository or client.",
      severity: 'error',
      from: { path: '^src/(activity|calendar)/' },
      to: { path: '^src/[^/]+/.+[.](module|service|repository|client)[.]ts$' },
    },
    {
      name: 'activity-no-core',
      comment: 'ADR 0006: activity scoring imports no Node.js core module.',
      severity: 'error',
      from: { path: '^src/activity/' },
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
      from: { path: '^src/(location|forecast|activity)/' },
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
        "ADR 0006: use another domain's module, service, types, constants or errors, never its repository, client, logic or mapper. The .logic files of the pure calendar and activity folders are public.",
      severity: 'error',
      from: { path: '^src/([^/]+)/' },
      to: {
        path: '^src/[^/]+/.+[.](repository|client|logic|mapper)[.]ts$',
        pathNot: ['^src/$1/', PUBLIC_LOGIC],
      },
    },
    {
      name: 'no-test-imports-in-src',
      comment: 'ADR 0006: production code never imports from test/.',
      severity: 'error',
      from: { path: '^src/' },
      to: { path: '^test/' },
    },
    {
      name: 'no-spec-in-src',
      comment: 'ADR 0006: unit specs live in test/unit/, mirroring src/.',
      severity: 'error',
      from: { path: '^src/.+[.]spec[.]ts$' },
      to: {},
    },
    {
      name: 'no-spec-in-src-orphan',
      comment: 'ADR 0006: the same for a spec under src/ that imports nothing, which no-spec-in-src cannot see.',
      severity: 'error',
      from: { path: '^src/.+[.]spec[.]ts$', orphan: true },
      to: {},
    },
  ],
  options: {
    // Not followed rather than excluded, so imports *of* the generated Prisma
    // client still reach the purity rules.
    doNotFollow: { path: ['node_modules', '^src/generated/'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    moduleSystems: ['es6', 'cjs'],
  },
};
