// Optional live smoke check: sends the README examples in examples/ to a running
// server, which calls the real Open-Meteo APIs. It is not part of CI and not a PR
// gate (SPEC-05); provider outages or changed live data can make it fail.
//
// Usage: npm run start (or node dist/main), then in another terminal
//   npm run smoke:live                 # http://localhost:3000/graphql
//   SMOKE_URL=http://host:port/graphql npm run smoke:live
import { readdir, readFile } from 'node:fs/promises';

const endpoint = process.env.SMOKE_URL ?? 'http://localhost:3000/graphql';
const examplesDir = new URL('../examples/', import.meta.url);
const ACTIVITIES = ['SKIING', 'SURFING', 'OUTDOOR_SIGHTSEEING', 'INDOOR_SIGHTSEEING'];

async function post(example) {
  const body = await readFile(new URL(`${example}.json`, examplesDir));
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const json = await response.json();
  if (!response.ok || json.errors) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function checkForecast(forecast) {
  assert(
    forecast.__typename === 'ActivityForecast',
    `expected ActivityForecast, got ${forecast.__typename}`,
  );
  assert(
    JSON.stringify(forecast.activities.map((group) => group.activity)) ===
      JSON.stringify(ACTIVITIES),
    'expected the four activity groups in contract order',
  );
  for (const group of forecast.activities) {
    assert(group.days.length === 7, `${group.activity}: expected 7 days, got ${group.days.length}`);
  }
  const [atmospheric, marine] = forecast.sources;
  assert(
    atmospheric?.source === 'ATMOSPHERIC' && marine?.source === 'MARINE',
    'expected both sources',
  );
  assert(
    atmospheric.freshness !== 'UNAVAILABLE',
    `atmospheric unavailable: ${atmospheric.failureCode}`,
  );
  assert(forecast.attribution.includes('Open-Meteo'), 'expected Open-Meteo attribution');
  const outdoor = forecast.activities.find((group) => group.activity === 'OUTDOOR_SIGHTSEEING');
  return `${forecast.location.name} ${forecast.startDate}..${forecast.endDate}, sources ${atmospheric.freshness}/${marine.freshness}, best outdoor day ${outdoor.days[0].date} (${outdoor.days[0].score})`;
}

/**
 * One check per request body in examples/, keyed by file name and run in this order.
 * forecast-ambiguous must run before forecast-by-id: a location ID resolves only once
 * a search has stored it, and the Madrid search stores 3117735 on a fresh database.
 */
const checks = {
  health: ({ health }) => {
    assert(health.service === 'UP' && health.database === 'UP', `health ${JSON.stringify(health)}`);
    return 'service and database UP';
  },
  locations: ({ locations }) => {
    assert(locations.length > 1, `expected several Springfields, got ${locations.length}`);
    return `${locations.length} candidates`;
  },
  'forecast-by-city': ({ activityForecast }) => checkForecast(activityForecast),
  'forecast-ambiguous': ({ activityForecast }) => {
    assert(
      activityForecast.__typename === 'AmbiguousLocation',
      `got ${activityForecast.__typename}`,
    );
    assert(
      activityForecast.candidates.some((candidate) => candidate.id === '3117735'),
      'expected Madrid (3117735) among the candidates',
    );
    return `${activityForecast.candidates.length} candidates`;
  },
  'forecast-by-id': ({ activityForecast }) => checkForecast(activityForecast),
};

let failed = 0;
const unchecked = (await readdir(examplesDir))
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.slice(0, -'.json'.length))
  .filter((example) => !Object.hasOwn(checks, example));
for (const example of unchecked) {
  failed += 1;
  console.log(`FAIL ${example}: no check for examples/${example}.json in scripts/smoke-live.mjs`);
}
for (const [example, check] of Object.entries(checks)) {
  try {
    console.log(`ok   ${example}: ${check(await post(example))}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${example}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(
  failed === 0
    ? `All ${Object.keys(checks).length} live checks passed against ${endpoint}.`
    : `${failed} live check(s) failed.`,
);
process.exitCode = failed === 0 ? 0 : 1;
