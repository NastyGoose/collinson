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

const CONSOLE_PORT = Number(process.env.REVIEW_CONSOLE_PORT || 4000);
if (!Number.isInteger(CONSOLE_PORT) || CONSOLE_PORT < 1 || CONSOLE_PORT > 65535) {
  console.error('REVIEW_CONSOLE_PORT must be an integer from 1 to 65535.');
  process.exit(1);
}

/** KEY=value lines of .env: optional `export`, optional quotes, `# comment` after an unquoted value. */
async function readEnv() {
  const env = {};
  try {
    const text = await readFile(resolve(root, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const value = m[2].trim();
      const quoted = /^(["'])(.*)\1$/.exec(value);
      env[m[1]] = quoted ? quoted[2] : value.replace(/\s+#.*$/, '');
    }
  } catch {
    // No .env: fall back to the documented defaults below.
  }
  return env;
}

// Like the service, a real environment variable wins over .env.
const env = await readEnv();
const APP_URL = `http://localhost:${process.env.PORT || env.PORT || 3000}/graphql`;
const DATABASE_URL =
  process.env.DATABASE_URL ||
  env.DATABASE_URL ||
  'postgresql://collinson:collinson@localhost:5432/collinson';
const FORWARD_TIMEOUT_MS = 30_000;
const RUN_TIMEOUT_MS = 5 * 60_000;
const MAX_OUTPUT_CHARS = 200_000;
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
pool.on('error', () => {});

// The only commands the page may start. Nothing from the request reaches the shell.
const COMMANDS = {
  unit: 'npm test',
  e2e: 'npm run test:e2e',
  structure: 'npm run lint:structure',
};

function send(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

const MAX_BODY_BYTES = 1024 * 1024;

class RequestRefused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Refuses requests that do not come from the console page itself. The server can
 * delete rows and start npm scripts, so a page on another site must not be able to
 * reach it through the browser of whoever runs it:
 * - the Host header must be this server, which stops DNS rebinding;
 * - a request that changes anything must be JSON, which a cross-site form cannot
 *   send without a preflight this server never answers, and must not carry
 *   another site's Origin.
 */
function guard(req) {
  const hosts = [`localhost:${CONSOLE_PORT}`, `127.0.0.1:${CONSOLE_PORT}`];
  if (!hosts.includes(req.headers.host ?? '')) {
    throw new RequestRefused(403, 'This console only answers on localhost.');
  }
  if (req.method === 'GET') return;
  const origin = req.headers.origin;
  if (origin !== undefined && !hosts.some((host) => origin === `http://${host}`)) {
    throw new RequestRefused(403, 'Requests from another origin are refused.');
  }
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin') {
    throw new RequestRefused(403, 'Requests from another site are refused.');
  }
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
    throw new RequestRefused(415, 'Send application/json.');
  }
}

async function readBody(req) {
  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > MAX_BODY_BYTES) throw new RequestRefused(413, 'The request body is too large.');
    chunks.push(chunk);
  }
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
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
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

/** Ends a command and what it started. With `shell: true`, child.kill() alone only ends the shell. */
function killTree(child) {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']).on('error', () => {});
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

let running = false;

/** Runs one listed command at a time and returns the tail of its output. */
function run(name) {
  return new Promise((done) => {
    running = true;
    const started = performance.now();
    const child = spawn(COMMANDS[name], {
      cwd: root,
      shell: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, NO_COLOR: '1', CI: '1' },
    });
    let output = '';
    let timedOut = false;
    const take = (chunk) => {
      output = (output + chunk.toString('utf8')).slice(-MAX_OUTPUT_CHARS);
    };
    const finish = (exitCode, text) => {
      clearTimeout(timer);
      running = false;
      done({
        command: COMMANDS[name],
        exitCode,
        ms: Math.round(performance.now() - started),
        output: text,
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, RUN_TIMEOUT_MS);
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('close', (code) => {
      // eslint-disable-next-line no-control-regex
      const clean = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trimEnd();
      const tail = clean.split(/\r?\n/).slice(-45).join('\n');
      finish(
        code ?? -1,
        timedOut ? `${tail}\n\nStopped after ${RUN_TIMEOUT_MS / 60_000} minutes.` : tail,
      );
    });
    child.on('error', (error) => finish(-1, String(error)));
  });
}

const HEALTH = JSON.stringify({ query: '{ health { service database } }' });

const server = createServer(async (req, res) => {
  try {
    guard(req);
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
      if (running) return send(res, 409, { error: 'Another command is still running.' });
      return send(res, 200, await run(name));
    }
    send(res, 404, { error: 'not found' });
  } catch (error) {
    if (error instanceof RequestRefused) return send(res, error.status, { error: error.message });
    if (error instanceof SyntaxError) {
      return send(res, 400, { error: 'The request body is not valid JSON.' });
    }
    // Usually PostgreSQL: unreachable, or the migrations have not been applied.
    // A refused connection is an AggregateError with an empty message, so name the cause.
    const detail = error.message || error.errors?.[0]?.message || error.code || error.name;
    send(res, 500, {
      error: `PostgreSQL did not answer (${detail}). Start it with npm run db:up and apply the migrations with npm run db:migrate.`,
    });
  }
});

server.on('error', (error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? `Port ${CONSOLE_PORT} is in use. Set REVIEW_CONSOLE_PORT to another port.`
      : `The review console could not start: ${error.message}`,
  );
  process.exit(1);
});

server.listen(CONSOLE_PORT, '127.0.0.1', () => {
  console.log(`Review console: http://localhost:${CONSOLE_PORT}  (service: ${APP_URL})`);
});
