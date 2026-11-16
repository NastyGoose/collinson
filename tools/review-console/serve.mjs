// Optional review console: a local reviewer aid, not part of the service.
// It serves index.html and forwards its requests to the running service as
// plain GraphQL POSTs, so the service needs no change (no CORS, no UI code in src/).
// It also reads a few rows from PostgreSQL to show what is stored, deletes the
// stored snapshots of one location on request (the cold/warm step) and runs a
// fixed list of npm scripts. It listens on 127.0.0.1 only and adds no dependency:
// pg is already installed for the tests.
//
//   npm run review:console      then open http://localhost:4000
//
// REVIEW_CONSOLE_PORT changes the port. See docs/engineering-notes.md (ARC-62).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const CONSOLE_PORT = Number(process.env.REVIEW_CONSOLE_PORT ?? 4000);

async function readEnv() {
  const env = {};
  try {
    const text = await readFile(resolve(root, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // No .env: fall back to the documented defaults below.
  }
  return env;
}

const env = await readEnv();
const APP_URL = `http://localhost:${env.PORT || 3000}/graphql`;
const DATABASE_URL =
  env.DATABASE_URL || 'postgresql://collinson:collinson@localhost:5432/collinson';
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
pool.on('error', () => {});

// The only commands the page may start. Nothing from the request reaches the shell.
const COMMANDS = {
  unit: 'npm test',
  integration: 'npm run test:integration',
  e2e: 'npm run test:e2e',
  structure: 'npm run lint:structure',
};

function send(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

async function forward(raw) {
  const started = performance.now();
  try {
    const response = await fetch(APP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    });
    const text = await response.text();
    const ms = Math.round(performance.now() - started);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { reachable: true, status: response.status, ms, body };
  } catch (error) {
    return {
      reachable: false,
      ms: Math.round(performance.now() - started),
      error: `The service at ${APP_URL} did not answer (${error.cause?.code ?? error.message}). Start it with: npm run start:prod`,
    };
  }
}

async function database() {
  const [locations, searches, snapshots] = await Promise.all([
    pool.query(
      `select id, name, region, country, timezone, created_at
         from locations order by created_at desc limit 12`,
    ),
    pool.query(
      `select s.query, s.country_code, s.fetched_at, s.expires_at,
              count(r.position)::int as results
         from location_searches s
         left join location_search_results r
           on r.query = s.query and r.country_code = s.country_code
        group by s.query, s.country_code, s.fetched_at, s.expires_at
        order by s.fetched_at desc limit 12`,
    ),
    pool.query(
      `select f.location_id, l.name, f.source, f.schema_version, f.fetched_at,
              f.coverage_start, f.coverage_end, f.returned_latitude, f.returned_longitude,
              jsonb_array_length(f.hourly::jsonb -> 'time') as hours,
              pg_column_size(f.hourly) as bytes
         from forecast_snapshots f join locations l on l.id = f.location_id
        order by f.fetched_at desc limit 12`,
    ),
  ]);
  return { locations: locations.rows, searches: searches.rows, snapshots: snapshots.rows };
}

function run(name) {
  return new Promise((done) => {
    const started = performance.now();
    const child = spawn(COMMANDS[name], {
      cwd: root,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' },
    });
    let output = '';
    const take = (chunk) => (output += chunk.toString('utf8'));
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('close', (code) => {
      // eslint-disable-next-line no-control-regex
      const clean = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trimEnd();
      done({
        command: COMMANDS[name],
        exitCode: code,
        ms: Math.round(performance.now() - started),
        output: clean.split(/\r?\n/).slice(-45).join('\n'),
      });
    });
    child.on('error', (error) =>
      done({ command: COMMANDS[name], exitCode: -1, ms: 0, output: String(error) }),
    );
  });
}

const HEALTH = JSON.stringify({ query: '{ health { service database } }' });

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const html = await readFile(resolve(here, 'index.html'));
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      return res.end(html);
    }
    if (req.method === 'GET' && pathname === '/api/status') {
      const answer = await forward(HEALTH);
      const health = answer.reachable ? answer.body?.data?.health : null;
      return send(res, 200, {
        endpoint: APP_URL,
        service: health?.service ?? 'DOWN',
        database: health?.database ?? 'UNKNOWN',
        ms: answer.ms,
      });
    }
    if (req.method === 'POST' && pathname === '/api/graphql') {
      const { raw } = await readBody(req);
      if (typeof raw !== 'string') return send(res, 400, { error: 'raw must be a string' });
      return send(res, 200, await forward(raw));
    }
    if (req.method === 'GET' && pathname === '/api/db') {
      return send(res, 200, await database());
    }
    if (req.method === 'POST' && pathname === '/api/reset') {
      const { locationId } = await readBody(req);
      if (!/^\d{1,12}$/.test(String(locationId)))
        return send(res, 400, { error: 'bad locationId' });
      const result = await pool.query('delete from forecast_snapshots where location_id = $1', [
        String(locationId),
      ]);
      return send(res, 200, { deleted: result.rowCount });
    }
    if (req.method === 'POST' && pathname === '/api/run') {
      const { name } = await readBody(req);
      if (!Object.hasOwn(COMMANDS, name)) return send(res, 400, { error: 'unknown command' });
      return send(res, 200, await run(name));
    }
    send(res, 404, { error: 'not found' });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

server.listen(CONSOLE_PORT, '127.0.0.1', () => {
  console.log(`Review console: http://localhost:${CONSOLE_PORT}  (service: ${APP_URL})`);
});
